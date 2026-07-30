import "server-only";
import { Resend } from "resend";

export const FROM = process.env.RESEND_FROM ?? "Insurwreck <noreply@example.com>";

// Built lazily, only when a request actually sends mail — the Resend SDK
// throws in its own constructor if the key is missing, and `next build`
// imports every route module, so an unset RESEND_API_KEY must not crash it.
export function getResend() {
  if (!process.env.RESEND_API_KEY) return null;
  return new Resend(process.env.RESEND_API_KEY);
}
