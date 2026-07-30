"use client";

import { useMemo, useState } from "react";
import type { Claim } from "@/lib/claims";

type Risk = { label: "Low" | "Medium" | "High"; reason: string };

const STATUSES = ["All", "Submitted", "Under Review", "Approved", "Rejected", "Paid"] as const;

const STATUS_STYLES: Record<string, string> = {
  Submitted: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",
  "Under Review": "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  Approved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  Rejected: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  Paid: "bg-neutral-200 text-neutral-800 dark:bg-neutral-700/40 dark:text-neutral-300",
};

const RISK_STYLES: Record<string, string> = {
  Low: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  Medium: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  High: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
};

const currency = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

export function ClaimsDashboard({ claims }: { claims: Claim[] }) {
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("All");
  const [search, setSearch] = useState("");
  const [risk, setRisk] = useState<Record<string, Risk>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return claims.filter((claim) => {
      const matchesStatus = status === "All" || claim.status === status;
      const matchesSearch =
        !q ||
        claim.memberName.toLowerCase().includes(q) ||
        claim.diagnosis.toLowerCase().includes(q) ||
        claim.id.toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [claims, status, search]);

  async function runTriage() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/classify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ claims: filtered }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Triage failed");
      const { results } = (await res.json()) as { results: (Risk & { id: string })[] };
      setRisk((prev) => {
        const next = { ...prev };
        for (const { id, label, reason } of results) next[id] = { label, reason };
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Triage failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Claims Dashboard</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Sample data &mdash; fictional claims for demo purposes only.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search member, diagnosis, claim ID..."
          className="w-64 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none ring-indigo-500 focus:ring-2 dark:border-neutral-700 dark:bg-neutral-900"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as (typeof STATUSES)[number])}
          className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none ring-indigo-500 focus:ring-2 dark:border-neutral-700 dark:bg-neutral-900"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          onClick={runTriage}
          disabled={loading}
          className="ml-auto rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Running AI triage..." : "Run AI Triage"}
        </button>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-2xl border border-neutral-200 dark:border-neutral-800">
        <table className="w-full min-w-[880px] text-left text-sm">
          <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
            <tr>
              {["Claim ID", "Member", "Hospital", "Amount", "Status", "Diagnosis", "AI Risk"].map((h) => (
                <th key={h} className="px-4 py-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {filtered.map((claim) => {
              const r = risk[claim.id];
              return (
                <tr key={claim.id} className="bg-white dark:bg-neutral-950">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-500">{claim.id}</td>
                  <td className="px-4 py-3">{claim.memberName}</td>
                  <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">{claim.hospital}</td>
                  <td className="whitespace-nowrap px-4 py-3">{currency.format(claim.amount)}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[claim.status]}`}>
                      {claim.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">{claim.diagnosis}</td>
                  <td className="px-4 py-3">
                    {r ? (
                      <span
                        title={r.reason}
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${RISK_STYLES[r.label]}`}
                      >
                        {r.label}
                      </span>
                    ) : (
                      <span className="text-xs text-neutral-400">&mdash;</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-neutral-500">
                  No claims match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
