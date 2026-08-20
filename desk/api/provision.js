import { sb, sha256, nowIso, readBody, organizerFor, normalizeEmail } from "./_lib.js";
import { resolveIdea, mayMint, renderPrompt, blockedMessage } from "./_resolve-idea.js";
import {
  mintResend,
  mintVercel,
  mintSupabase,
  mintAgentmail,
  mintAnthropic,
  mintN8n,
  mintGoogleAuth,
  mintKula,
  mintZendesk,
  mintClevertap,
  slugHost,
  slugForIdea,
} from "./_minters.js";

const SERVICES = [
  "vercel",
  "supabase",
  "n8n",
  "resend",
  "agentmail",
  "anthropic",
  "google_auth",
  "kula",
  "zendesk",
  "clevertap",
];

// Every service has a minter now. One that throws - usually a missing env var -
// leaves that service pending and the next provision call repairs it.
// google_auth runs last: it needs the participant's Supabase project ref and
// Vercel project name, so both of those must have minted first.
const MINTERS = {
  resend: mintResend,
  vercel: mintVercel,
  supabase: mintSupabase,
  agentmail: mintAgentmail,
  anthropic: mintAnthropic,
  n8n: mintN8n,
  google_auth: mintGoogleAuth,
  kula: mintKula,
  zendesk: mintZendesk,
  clevertap: mintClevertap,
};

// How long a claim may sit unfulfilled before another caller may retake it. A
// crash between claiming and patching would otherwise wedge one (idea, service)
// forever, and the only symptom would be a team whose Supabase never appears.
const CLAIM_STALE_MS = 90_000;

async function sessionEmail(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  const rows = await sb(
    `sessions?token_hash=eq.${sha256(token)}&expires_at=gt.${nowIso()}&select=email&limit=1`
  );
  return rows.length ? rows[0].email : null;
}

// sb() throws a message carrying the HTTP status and the Postgres error body, so
// a lost claim race is identified by the unique-violation code rather than by
// pre-checking for a row - which would be the race itself.
function isUniqueViolation(error) {
  const text = String(error?.message || "");
  return text.includes("23505") || text.includes("supabase 409");
}

const q = (value) => encodeURIComponent(value);

/** The credential rows for a scope, as a service->row map. */
async function readCredentials(scope) {
  const filter = scope.ideaId
    ? `idea_id=eq.${scope.ideaId}`
    : `participant_email=eq.${q(scope.email)}&idea_id=is.null`;
  const rows = await sb(
    `credentials?${filter}&revoked_at=is.null&select=service,payload,minted_live,claimed_at`
  );
  return new Map(rows.map((row) => [row.service, row]));
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const body = readBody(req);
    // Organizers can repair a participant's setup without making them
    // re-verify. Any organizer counts, not just a holder of the shared admin
    // key: an ORGANIZER_EMAILS address that has verified by OTP is a stronger
    // identity than a secret four people paste into a browser, and requiring
    // the key left Repair unusable for whoever was actually on the floor.
    // Provisioning is additive and idempotent, so the cost of being wrong is a
    // re-mint of something already missing.
    const organizer = await organizerFor(req);
    const email = body.email && organizer ? normalizeEmail(body.email) : await sessionEmail(req);
    if (!email) {
      return res.status(401).json({ error: "invalid or expired session — verify your email again" });
    }

    const patch = { provisioned_at: nowIso() };
    if (body.name) patch.name = String(body.name).slice(0, 120);
    if (body.idea_brief) patch.idea_brief = String(body.idea_brief).slice(0, 2000);
    if (body.agent) patch.agent = String(body.agent).slice(0, 40);
    // The short name they picked for their site, which becomes their public
    // hostname. Sanitised here rather than at use, so what is stored is exactly
    // what the URL will read - an organizer looking at the row sees the truth.
    if (body.site_name) {
      const clean = slugHost(body.site_name);
      if (clean) patch.site_name = clean;
    }

    // ---------------------------------------------------------- the roster ---
    // A snapshot in this database, refreshed by scripts/refresh-idea-teams.mjs.
    // Deliberately not a live read of the hub: onboarding for 136 people must
    // not depend on another project being reachable at 9am on the day.
    const memberships = await sb(
      `idea_teams?member_email=eq.${q(email)}&select=idea_id,role,idea_title,published_at`
    );

    const existingRow = (
      await sb(`participants?email=eq.${q(email)}&select=idea_id&limit=1`)
    )[0];
    let pinned = existingRow?.idea_id || null;

    // An answer to the "which idea are you building?" prompt. Validated against
    // the roster, never trusted: the session proves who they are, but without
    // this check a verified participant could POST any idea_id and be handed
    // that team's database, hosting and inbox.
    if (body.idea_id) {
      const chosen = String(body.idea_id);
      if (!memberships.some((m) => m.idea_id === chosen)) {
        return res.status(403).json({
          error: "that idea is not one of yours",
          detail: "You can only pick an idea you are on the team for.",
        });
      }
      pinned = chosen;
      patch.idea_id = chosen;
    }

    const updated = await sb(`participants?email=eq.${q(email)}`, { method: "PATCH", body: patch });
    const participant = updated[0] || { email };

    const resolution = resolveIdea(memberships, pinned);

    // Nothing is minted until they choose. Returning 200 with a discriminator
    // rather than a 4xx: needing input is not an error, and a non-2xx here is
    // easy for a shell client to swallow.
    if (resolution.kind === "must_ask") {
      return res.status(200).json({
        ok: false,
        status: "needs_choice",
        prompt: renderPrompt(resolution.options),
        options: resolution.options.map((o) => ({
          idea_id: o.idea_id,
          title: o.idea_title,
          you_are_captain: o.role === "owner",
        })),
        participant: { name: participant.name, email: participant.email },
      });
    }

    const scope =
      resolution.kind === "solo"
        ? { email, ideaId: null }
        : { email, ideaId: resolution.ideaId };
    const idea = memberships.find((m) => m.idea_id === scope.ideaId) || null;

    let byService = await readCredentials(scope);

    // ------------------------------------------------------- the captain gate ---
    // A member who starts before their captain is told to wait rather than
    // minting a second Supabase project for the same team. Organizers bypass
    // this: they are the manual path for a team whose captain cannot start.
    const canMint = mayMint(resolution) || Boolean(organizer);
    // Count only rows that actually hold a credential. A claim placeholder is
    // not a bundle: if the captain claimed one service and then crashed, a
    // member arriving inside the 90s window would otherwise pass this gate and
    // be handed status:"ok" with nothing in it, which reads as "your team is set
    // up" while none of it exists.
    const realRows = [...byService.values()].filter((row) => !row.payload?.claiming);
    if (!canMint && realRows.length === 0) {
      // A claim with no payload means the captain started and stopped, which is
      // a different instruction than never having started - they have to run it
      // again, and nothing tells them so unless we do.
      const partial = byService.size > 0;
      const captain = await sb(
        `idea_teams?idea_id=eq.${scope.ideaId}&role=eq.owner&select=member_email&limit=1`
      );
      return res.status(200).json({
        ok: false,
        status: "waiting_for_captain",
        captain_started: partial,
        idea: { id: scope.ideaId, title: idea?.idea_title },
        captain: captain[0]?.member_email || null,
        message: blockedMessage(idea?.idea_title || "your idea", captain[0]?.member_email, partial),
      });
    }

    if (canMint) {
      // The team's resource name. Derived from the idea so all three teammates
      // get iw-meridian-7e1c rather than one member's name; minters read it from
      // the context under a reserved key so the solo path keeps using slugFor.
      const slug = scope.ideaId ? slugForIdea(scope.ideaId, idea?.idea_title || "") : null;

      for (const [service, minter] of Object.entries(MINTERS)) {
        const row = byService.get(service);
        if (row && !row.payload?.incomplete && !row.payload?.claiming) continue;

        // Stale-claim recovery. A claim younger than the timeout belongs to
        // somebody still working, so leave it alone and let them finish.
        if (row?.payload?.claiming) {
          const age = Date.now() - new Date(row.claimed_at || 0).getTime();
          if (age < CLAIM_STALE_MS) continue;
        }

        // CLAIM BEFORE MINTING. The insert is the lock: whoever lands it calls
        // the provider, and everyone else takes the unique violation and reads
        // the winner's row. Minting first would create the project and only
        // then discover it was not this caller's job.
        if (!row) {
          try {
            await sb("credentials", {
              method: "POST",
              headers: { Prefer: "return=minimal" },
              body: {
                participant_email: email,
                idea_id: scope.ideaId,
                service,
                payload: { claiming: true },
                claimed_at: nowIso(),
              },
            });
          } catch (error) {
            if (!isUniqueViolation(error)) throw error;
            // Someone else claimed it between our read and our insert. Their
            // bundle is the team's bundle - nothing more to do for this service.
            continue;
          }
        }

        try {
          const context = Object.fromEntries(
            [...byService.values()]
              .filter((entry) => !entry.payload?.claiming)
              .map((entry) => [entry.service, entry.payload])
          );
          if (slug) context.__slug = slug;
          const payload = await minter(email, row?.payload?.claiming ? {} : row?.payload || {}, context);
          const filter = scope.ideaId
            ? `idea_id=eq.${scope.ideaId}&service=eq.${service}`
            : `participant_email=eq.${q(email)}&idea_id=is.null&service=eq.${service}`;
          await sb(`credentials?${filter}`, {
            method: "PATCH",
            body: { payload, minted_live: true, claimed_at: null },
          });
          byService.set(service, { service, payload, minted_live: true });
        } catch (error) {
          // Failures never sink the whole provision - the service stays pending
          // and the next call repairs it. The claim is released so the next
          // caller can retry immediately rather than waiting out the timeout.
          console.error(`mint ${service} failed for ${email} (idea ${scope.ideaId}):`, error);
          const filter = scope.ideaId
            ? `idea_id=eq.${scope.ideaId}&service=eq.${service}`
            : `participant_email=eq.${q(email)}&idea_id=is.null&service=eq.${service}`;
          await sb(`credentials?${filter}`, {
            method: "PATCH",
            headers: { Prefer: "return=minimal" },
            body: { claimed_at: null },
          }).catch(() => {});
        }
      }

      // Re-read rather than trusting the in-memory map: a teammate racing this
      // call may have filled in services we skipped as already-claimed.
      byService = await readCredentials(scope);
    }

    const services = Object.fromEntries(
      [...byService.values()]
        .filter((row) => !row.payload?.claiming)
        .map((row) => [row.service, row.payload])
    );
    const pending = SERVICES.filter((service) => !services[service]);
    return res.status(200).json({
      ok: true,
      status: "ok",
      participant: {
        name: participant.name,
        email: participant.email,
        idea_brief: participant.idea_brief,
        agent: participant.agent,
      },
      idea: scope.ideaId ? { id: scope.ideaId, title: idea?.idea_title, captain: resolution.captain } : null,
      shared_with_team: Boolean(scope.ideaId),
      services,
      pending,
    });
  } catch (error) {
    return res.status(500).json({ error: String(error.message || error) });
  }
}
