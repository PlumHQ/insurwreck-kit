#!/usr/bin/env bash
# PreToolUse hook (Write|Edit): no application code until there is a brief.
#
# The default behaviour without this is to read the idea brief and produce a
# whole application in one turn. It demos, and the participant cannot explain it
# on stage or steer it afterwards - which inverts the point of the day. The
# project CLAUDE.md asks for a short product conversation first; this is what
# makes that more than a suggestion, because instructions lose to momentum.
#
# Deliberately narrow:
#   * Only fires in a project carrying OUR CLAUDE.md marker, so it cannot affect
#     the kit repo, an organizer's checkout, or any unrelated work.
#   * Only source files. Markdown, JSON, CSS and config stay writable, so
#     BRIEF.md itself is never blocked and nothing about setup is impeded.
#   * Goes quiet permanently the moment BRIEF.md exists.
#   * Copying the provided starter template with `cp -r` is NOT blocked. Using
#     the scaffold is fine; inventing a bespoke system unprompted is the thing
#     worth interrupting.
#
# Fail-open by design: only the explicit JSON "deny" blocks, and any internal
# error exits 0. A hook bug must never cost someone their build day.

raw="$(cat)"

get() {
  printf '%s' "$raw" | node -e "
    let d='';process.stdin.on('data',c=>d+=c);
    process.stdin.on('end',()=>{
      let j={}; try { j = JSON.parse(d); } catch (e) {}
      const path = '$1'.split('.');
      let v = j; for (const k of path) v = v && v[k];
      process.stdout.write(String(v || ''));
    });" 2>/dev/null
}

file="$(get tool_input.file_path)"
cwd="$(get cwd)"
[ -n "$file" ] || exit 0
[ -n "$cwd" ] || exit 0

# Already briefed - nothing to do, ever again.
[ -f "$cwd/BRIEF.md" ] && exit 0

# Only act where we planted the contract. The marker is a line from the
# CLAUDE.md that go.sh writes into a participant's project folder.
grep -q "Brainstorm first, and only about the product" "$cwd/CLAUDE.md" 2>/dev/null || exit 0

# Never interfere with dependencies or build output.
case "$file" in
  */node_modules/*|*/.next/*|*/dist/*|*/build/*|*/.git/*) exit 0 ;;
esac

# Source files only. Everything else - docs, config, styles, data - is fine.
case "$file" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.py|*.go|*.rs|*.rb|*.php|*.java|*.vue|*.svelte) ;;
  *) exit 0 ;;
esac

node -e '
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: process.argv[1]
    }
  }));
' "No application code yet - there is no BRIEF.md in this project.

Have the product conversation first, then build. Ask 3 to 5 questions in ONE
message, about the problem and the people rather than the implementation: who has
this problem and what do they do today, what decision should it make easier, what
would they look at first thing in the morning, what does success look like in one
sentence, what is the smallest useful version. Do not ask them about frameworks,
databases, schemas or libraries - those are your call, and the stack is already
provisioned.

Then write BRIEF.md here (problem, who it is for, what the first slice does, what
is out of scope for this build) and start building that first slice. Writing BRIEF.md
lifts this block permanently.

If they have said 'just build it' or 'you decide', that is a valid answer: write
BRIEF.md from your best reading, state your assumption in one line, and go." 2>/dev/null

exit 0
