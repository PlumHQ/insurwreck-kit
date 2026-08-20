import { sbAll, sb, sha256, nowIso } from "../_lib.js";

// Anthropic's Admin API can't create API keys, so participants can't be given
// one each. This endpoint stands in for the Anthropic API instead: it holds
// the single real key, authenticates participants by their own proxy token,
// meters what they spend, and cuts them off at their budget.
//
// Drop-in for the SDK:
//   new Anthropic({ apiKey: <proxy token>, baseURL: "<desk>/api/llm" })

const ANTHROPIC_API = "https://api.anthropic.com";

// Second upstream, same gateway. Nothing in the kit turns text into a vector -
// Anthropic serves no embedding model - and three ideas need one. Rather than a
// separate endpoint, /api/llm/openai/... reuses the auth, budget and metering
// below, which is nearly all of this file.
const OPENAI_API = "https://api.openai.com";

// USD per million tokens. Sonnet is on introductory pricing through
// 2026-08-31; the event sits inside that window.
const PRICING = {
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
};
const DEFAULT_PRICE = { input: 5, output: 25 };

// Embeddings bill for input only. Listed explicitly because DEFAULT_PRICE is
// 250x the real rate, so an unlisted embedding model would report a wildly
// inflated spend and cut someone off long before they had spent anything.
const EMBEDDING_PRICING = {
  "text-embedding-3-small": { input: 0.02, output: 0 },
  "text-embedding-3-large": { input: 0.13, output: 0 },
  "text-embedding-ada-002": { input: 0.1, output: 0 },
};

const priceFor = (model) => {
  if (!model) return DEFAULT_PRICE;
  if (EMBEDDING_PRICING[model]) return EMBEDDING_PRICING[model];
  const exact = PRICING[model];
  if (exact) return exact;
  const prefix = Object.keys(PRICING).find((id) => model.startsWith(id));
  return prefix ? PRICING[prefix] : DEFAULT_PRICE;
};

const costUsd = (model, inTok, outTok) => {
  const p = priceFor(model);
  return (inTok / 1e6) * p.input + (outTok / 1e6) * p.output;
};

// ------------------------------------------------------------------ auth ---

function presentedToken(req) {
  const direct = req.headers["x-api-key"];
  if (direct) return String(direct).trim();
  const auth = req.headers.authorization || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

async function participantFor(token) {
  if (!token) return null;
  const rows = await sb(
    `credentials?service=eq.anthropic&revoked_at=is.null` +
      `&payload->>token_hash=eq.${sha256(token)}` +
      `&select=participant_email,payload&limit=1`
  );
  return rows.length ? rows[0] : null;
}

// "Only the people who need it" is enforced here rather than by handing the key
// out: an `openai` credentials row is the entitlement, and it carries no secret -
// just the base URL and model to point their SDK at.
async function entitledToOpenAI(email) {
  const rows = await sb(
    `credentials?participant_email=eq.${encodeURIComponent(email)}` +
      `&service=eq.openai&revoked_at=is.null&select=service&limit=1`
  );
  return rows.length > 0;
}

async function spentSoFar(email) {
  const rows = await sbAll(
    `llm_usage?participant_email=eq.${encodeURIComponent(email)}&select=cost_usd&order=id`
  );
  return rows.reduce((total, row) => total + Number(row.cost_usd || 0), 0);
}

async function record(email, model, inTok, outTok) {
  if (!inTok && !outTok) return;
  try {
    await sb("llm_usage", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: {
        participant_email: email,
        model: model || "unknown",
        input_tokens: inTok,
        output_tokens: outTok,
        cost_usd: costUsd(model, inTok, outTok),
        created_at: nowIso(),
      },
    });
  } catch (error) {
    // Never fail a participant's request because metering failed.
    console.error(`llm usage record failed for ${email}:`, error);
  }
}

// --------------------------------------------------------------- handler ---

export default async function handler(req, res) {
  const token = presentedToken(req);
  if (!token) {
    return res.status(401).json({
      type: "error",
      error: { type: "authentication_error", message: "Missing API key." },
    });
  }

  let row;
  try {
    row = await participantFor(token);
  } catch (error) {
    return res.status(500).json({
      type: "error",
      error: { type: "api_error", message: String(error.message || error) },
    });
  }

  if (!row) {
    return res.status(401).json({
      type: "error",
      error: { type: "authentication_error", message: "Invalid API key." },
    });
  }

  const email = row.participant_email;
  const budget = Number(row.payload?.budget_usd || process.env.LLM_BUDGET_USD || 15);

  // Fail closed. If metering is unreachable we cannot enforce a budget, and an
  // unmetered proxy in front of a real Anthropic key is the exact uncapped-spend
  // risk this endpoint exists to remove.
  let spent;
  try {
    spent = await spentSoFar(email);
  } catch (error) {
    console.error(`llm metering unavailable for ${email}:`, error);
    return res.status(503).json({
      type: "error",
      error: {
        type: "api_error",
        message:
          "Model access is paused because usage metering is unavailable. Tell an organizer: the llm_usage table is missing.",
      },
    });
  }

  if (spent >= budget) {
    return res.status(429).json({
      type: "error",
      error: {
        type: "rate_limit_error",
        message:
          `You've used your $${budget.toFixed(2)} of model budget for the hackathon ` +
          `($${spent.toFixed(2)} spent). Ask an organizer to raise it.`,
      },
    });
  }

  // Rebuild the upstream path from the catch-all segments, so /api/llm/v1/messages
  // forwards to https://api.anthropic.com/v1/messages.
  const segments = [].concat(req.query?.path || []);
  const search = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";

  // /api/llm/...        -> Anthropic, unchanged.
  // /api/llm/openai/... -> OpenAI, embeddings only, entitled participants only.
  const isOpenAI = segments[0] === "openai";
  const upstreamSegments = isOpenAI ? segments.slice(1) : segments;

  if (isOpenAI) {
    // Restrict the PATH, not just the key. The event key reaches
    // /v1/chat/completions too (verified), so an open proxy would let these
    // teams run chat models on Plum's OpenAI billing - unmetered by the
    // Anthropic pricing table above, and outside the model policy everyone
    // else is held to.
    if (upstreamSegments.join("/") !== "v1/embeddings") {
      return res.status(403).json({
        error: {
          type: "invalid_request_error",
          message:
            "This gateway only proxies /v1/embeddings to OpenAI. For text generation " +
            "use the Anthropic endpoint, which is what your budget is priced for.",
        },
      });
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({
        error: {
          type: "api_error",
          message: "Embeddings aren't switched on yet. Tell an organizer that OPENAI_API_KEY is unset on the desk.",
        },
      });
    }
    let entitled;
    try {
      entitled = await entitledToOpenAI(email);
    } catch (error) {
      console.error(`openai entitlement check failed for ${email}:`, error);
      entitled = false;
    }
    if (!entitled) {
      return res.status(403).json({
        error: {
          type: "permission_error",
          message:
            "Embeddings aren't enabled for your project. Only the ideas that need vectors " +
            "have them - ask an organizer if you think yours should.",
        },
      });
    }
  }

  const upstreamUrl = `${isOpenAI ? OPENAI_API : ANTHROPIC_API}/${upstreamSegments.join("/")}${search}`;

  const body =
    req.method === "GET" || req.method === "HEAD"
      ? undefined
      : typeof req.body === "string"
        ? req.body
        : JSON.stringify(req.body ?? {});

  // Model is needed for pricing; read it off the request since a streamed
  // response may not repeat it.
  let model;
  try {
    model = (typeof req.body === "object" ? req.body : JSON.parse(body || "{}"))?.model;
  } catch {
    model = undefined;
  }

  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: isOpenAI
        ? {
            authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "content-type": "application/json",
          }
        : {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": req.headers["anthropic-version"] || "2023-06-01",
        "content-type": "application/json",
        ...(req.headers["anthropic-beta"]
          ? { "anthropic-beta": req.headers["anthropic-beta"] }
          : {}),
      },
      body,
    });
  } catch (error) {
    return res.status(502).json({
      type: "error",
      error: { type: "api_error", message: `upstream unreachable: ${error.message}` },
    });
  }

  const contentType = upstream.headers.get("content-type") || "application/json";
  res.status(upstream.status);
  res.setHeader("content-type", contentType);
  res.setHeader("x-insurwreck-budget-usd", budget.toFixed(2));
  res.setHeader("x-insurwreck-spent-usd", spent.toFixed(4));

  // Streaming: pass the SSE through untouched and read the usage numbers out
  // of the events as they go by, so metering costs the participant nothing.
  if (contentType.includes("text/event-stream") && upstream.body) {
    let inTok = 0;
    let outTok = 0;
    let buffer = "";

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        res.write(chunk);

        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          try {
            const event = JSON.parse(line.slice(5).trim());
            const usage = event?.message?.usage || event?.usage;
            if (usage?.input_tokens) inTok = usage.input_tokens;
            if (usage?.output_tokens) outTok = usage.output_tokens;
          } catch {
            // Partial or non-JSON SSE line — ignore.
          }
        }
      }
    } catch (error) {
      console.error(`llm stream relay failed for ${email}:`, error);
    }

    res.end();
    await record(email, model, inTok, outTok);
    return;
  }

  const text = await upstream.text();
  res.send(text);

  try {
    const parsed = JSON.parse(text);
    // Anthropic reports input_tokens/output_tokens; OpenAI reports
    // prompt_tokens/completion_tokens, and embeddings report only the former.
    // Reading just the Anthropic names would have metered every embedding call
    // as zero and let it slip the budget entirely.
    const usage = parsed?.usage || {};
    await record(
      email,
      parsed?.model || model,
      usage.input_tokens ?? usage.prompt_tokens ?? 0,
      usage.output_tokens ?? usage.completion_tokens ?? 0
    );
  } catch {
    // Non-JSON response (an error page, say) — nothing to meter.
  }
}
