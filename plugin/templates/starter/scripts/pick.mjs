#!/usr/bin/env node
// Commit the starter to one shape.
//
//   node scripts/pick.mjs dashboard
//   node scripts/pick.mjs generate
//
// The template ships both demo routes so nothing has to be assembled at copy
// time. That is right for the first five minutes and wrong for everything
// after: participants deployed to a real URL with a two-card chooser and both
// demos still on the nav, because removing the unused half was an optional step
// nobody took. This makes it one command, and the skill runs it.
//
// Removes the other route, its API handlers and its component; points the home
// page at what is left; drops the dead nav entry. Idempotent.

import fs from "node:fs";
import path from "node:path";

const shape = (process.argv[2] || "").toLowerCase();
if (!["dashboard", "generate"].includes(shape)) {
  console.error("usage: node scripts/pick.mjs <dashboard|generate>");
  process.exit(1);
}

const root = path.resolve(import.meta.dirname, "..");
const p = (...s) => path.join(root, ...s);
const drop = (rel) => {
  const target = p(rel);
  if (!fs.existsSync(target)) return false;
  fs.rmSync(target, { recursive: true, force: true });
  return true;
};

const other = shape === "dashboard" ? "generate" : "dashboard";
const removed = [
  `app/${other}`,
  `app/api/${other}`,
  other === "generate" ? "components/GenerateForm.tsx" : "components/ClaimsDashboard.tsx",
].filter(drop);

// The home page becomes the thing they built, not a menu of things we built.
const title = shape === "dashboard" ? "Dashboard" : "Generator";
fs.writeFileSync(
  p("app/page.tsx"),
  `import { redirect } from "next/navigation";

// Replace this with a real landing page when you have one. Until then the app
// opens on the thing it does, rather than on a chooser.
export default function Home() {
  redirect("/${shape}");
}
`
);

// Nav: keep only what still exists, and stop calling it a starter in public.
const navPath = p("components/Nav.tsx");
if (fs.existsSync(navPath)) {
  let nav = fs.readFileSync(navPath, "utf8");
  nav = nav.replace(
    /const links = \[[\s\S]*?\];/,
    `const links = [\n  { href: "/${shape}", label: "${title}" },\n];`
  );
  nav = nav.replace(/Insurwreck Starter/g, process.env.APP_NAME || title);
  fs.writeFileSync(navPath, nav);
}

console.log(`Kept /${shape}. Removed: ${removed.join(", ") || "nothing (already pruned)"}`);
console.log("Home now redirects to /" + shape + " - no chooser ships to your live URL.");
