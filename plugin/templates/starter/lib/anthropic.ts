import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// ANTHROPIC_API_KEY is a hackathon proxy token, not a real Anthropic key — it
// only works through ANTHROPIC_BASE_URL, which meters spend and forwards the
// call. Never point this client at api.anthropic.com directly.
export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: process.env.ANTHROPIC_BASE_URL,
});

export const MODEL = "claude-sonnet-5";
