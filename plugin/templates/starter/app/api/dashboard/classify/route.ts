import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { anthropic, MODEL } from "@/lib/anthropic";

type ClaimInput = {
  id: string;
  amount: number;
  status: string;
  diagnosis: string;
};

type ClassifyResult = { id: string; label: "Low" | "Medium" | "High"; reason: string };

// Native tool-use forces structured JSON out of the model — no markdown-fence
// stripping or best-effort parsing of free text.
const CLASSIFY_TOOL: Anthropic.Tool = {
  name: "classify_claims",
  description: "Return a triage label and one-line reason for each claim, in the same order given.",
  input_schema: {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            label: { type: "string", enum: ["Low", "Medium", "High"] },
            reason: { type: "string" },
          },
          required: ["id", "label", "reason"],
        },
      },
    },
    required: ["results"],
  },
};

export async function POST(request: Request) {
  const { claims } = (await request.json()) as { claims: ClaimInput[] };

  if (!Array.isArray(claims) || claims.length === 0) {
    return NextResponse.json({ error: "claims array is required" }, { status: 400 });
  }

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: "tool", name: "classify_claims" },
    system:
      "You triage health insurance claims for a human reviewer. For each claim, " +
      "assign a risk label (Low, Medium, High) and a one-sentence reason, weighing " +
      "the claim amount, current status, and diagnosis. Higher amounts, ambiguous " +
      "diagnoses, or exclusion-prone procedures should skew the label higher.",
    messages: [
      {
        role: "user",
        content: JSON.stringify(claims.map(({ id, amount, status, diagnosis }) => ({ id, amount, status, diagnosis }))),
      },
    ],
  });

  const toolUse = message.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
  const results = (toolUse?.input as { results?: ClassifyResult[] } | undefined)?.results ?? [];

  return NextResponse.json({ results });
}
