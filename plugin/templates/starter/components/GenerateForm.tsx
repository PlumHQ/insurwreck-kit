"use client";

import { useState } from "react";

const KINDS = ["Approval Letter", "Rejection Letter", "Information Request", "Status Update"];

export function GenerateForm() {
  const [kind, setKind] = useState(KINDS[0]);
  const [recipientName, setRecipientName] = useState("");
  const [context, setContext] = useState("");
  const [instructions, setInstructions] = useState("");

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [to, setTo] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  async function compose() {
    setComposing(true);
    setError(null);
    setSent(null);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, recipientName, context, instructions }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Generation failed");
      setSubject(data.subject);
      setBody(data.body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setComposing(false);
    }
  }

  function download() {
    const blob = new Blob([`Subject: ${subject}\n\n${body}`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${kind.toLowerCase().replace(/\s+/g, "-")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function send() {
    setSending(true);
    setError(null);
    setSent(null);
    try {
      const res = await fetch("/api/generate/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to, subject, body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Send failed");
      setSent(`Sent to ${to}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4 rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
        <label className="block text-sm font-medium">
          Document type
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none ring-indigo-500 focus:ring-2 dark:border-neutral-700 dark:bg-neutral-950"
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm font-medium">
          Recipient name
          <input
            value={recipientName}
            onChange={(e) => setRecipientName(e.target.value)}
            placeholder="e.g. Priya Sharma"
            className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none ring-indigo-500 focus:ring-2 dark:border-neutral-700 dark:bg-neutral-950"
          />
        </label>

        <label className="block text-sm font-medium">
          Context
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            rows={3}
            placeholder="Claim ID, amount, diagnosis, whatever the letter needs to reference"
            className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none ring-indigo-500 focus:ring-2 dark:border-neutral-700 dark:bg-neutral-950"
          />
        </label>

        <label className="block text-sm font-medium">
          Extra instructions <span className="font-normal text-neutral-500">(optional)</span>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={2}
            placeholder="Tone, specific points to include, anything else"
            className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none ring-indigo-500 focus:ring-2 dark:border-neutral-700 dark:bg-neutral-950"
          />
        </label>

        <button
          onClick={compose}
          disabled={composing || !recipientName}
          className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {composing ? "Composing..." : "Compose with AI"}
        </button>

        {error && (
          <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </p>
        )}
      </div>

      <div className="space-y-4 rounded-2xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
        <label className="block text-sm font-medium">
          Subject
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Appears once you compose"
            className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none ring-indigo-500 focus:ring-2 dark:border-neutral-700 dark:bg-neutral-950"
          />
        </label>

        <label className="block text-sm font-medium">
          Body
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={12}
            placeholder="Appears once you compose. Editable before you send."
            className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none ring-indigo-500 focus:ring-2 dark:border-neutral-700 dark:bg-neutral-950"
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={download}
            disabled={!body}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            Download .txt
          </button>
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="recipient@email.com"
            className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none ring-indigo-500 focus:ring-2 dark:border-neutral-700 dark:bg-neutral-950"
          />
          <button
            onClick={send}
            disabled={sending || !body || !to}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            {sending ? "Sending..." : "Send via email"}
          </button>
        </div>

        {sent && <p className="text-sm text-emerald-600 dark:text-emerald-400">{sent}</p>}
      </div>
    </div>
  );
}
