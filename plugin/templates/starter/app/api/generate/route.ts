import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { anthropic, MODEL } from "@/lib/anthropic";

type ComposeInput = {
  kind: string;
  recipientName: string;
  context: string;
  instructions: string;
};

const COMPOSE_TOOL: Anthropic.Tool = {
  name: "compose_document",
  description: "Return a subject line and body for the requested document.",
  input_schema: {
    type: "object",
    properties: {
      subject: { type: "string" },
      body: { type: "string" },
    },
    required: ["subject", "body"],
  },
};

export async function POST(request: Request) {
  const { kind, recipientName, context, instructions } = (await request.json()) as ComposeInput;

  if (!kind || !recipientName) {
    return NextResponse.json({ error: "kind and recipientName are required" }, { status: 400 });
  }

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    tools: [COMPOSE_TOOL],
    tool_choice: { type: "tool", name: "compose_document" },
    system:
      "You draft short, professional insurance correspondence. Write directly to " +
      "the recipient, plain language, no filler, no placeholder brackets left unfilled.",
    messages: [
      {
        role: "user",
        content:
          `Document type: ${kind}\n` +
          `Recipient: ${recipientName}\n` +
          `Context: ${context || "none given"}\n` +
          `Extra instructions: ${instructions || "none"}`,
      },
    ],
  });

  const toolUse = message.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
  const result = toolUse?.input as { subject?: string; body?: string } | undefined;

  if (!result?.body) {
    return NextResponse.json({ error: "model returned no document" }, { status: 502 });
  }

  return NextResponse.json({ subject: result.subject ?? kind, body: result.body });
}
