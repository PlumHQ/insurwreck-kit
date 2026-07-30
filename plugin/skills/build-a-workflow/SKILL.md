---
description: Build or edit an n8n automation - scheduled jobs, inbound email triggers, webhooks, multi-step integrations. Use when the participant says "automate this", "run it every morning", "when an email arrives", "trigger a workflow", or mentions n8n. Also use before touching any existing workflow, because the n8n instance is shared with ~25 other people.
---

# Build an n8n workflow

The `n8n` MCP server is already connected. It reaches a **shared** hackathon n8n
instance - every participant is writing into the same workspace, as the same n8n
user. There is no per-person isolation, so the rules below are what keep one
person's afternoon from deleting another's.

## Before you create anything

Work out the participant's slug from `~/.insurwreck/credentials.json`:

```bash
node -e 'console.log(require(require("os").homedir()+"/.insurwreck/credentials.json").services.vercel.project_name)'
```

That yields something like `iw-harish-n-cb6a`. Use it as their prefix.

## The rules

1. **Name every workflow `<slug> · <what it does>`.** For example
   `iw-harish-n-cb6a · claim escalation digest`. Never create an unprefixed
   workflow - an unnamed one is indistinguishable from someone else's.
2. **Tag it with the slug too**, if the n8n tools expose tags.
3. **Never modify or delete a workflow whose name doesn't start with this
   participant's slug.** If a task seems to need editing someone else's, stop and
   say so - do not guess. Duplicate it under their own prefix instead.
4. **List before you create.** Search for the slug first; if a workflow for this
   purpose already exists, edit theirs rather than adding a near-duplicate.
5. **Deactivate rather than delete** when something is no longer wanted. Deletion
   on a shared instance is unrecoverable and may not be theirs to make.

## The order the server actually requires

This is n8n's official MCP server, and it enforces a sequence. Skipping a step
gets your workflow rejected, so don't improvise:

1. `get_workflow_best_practices` - a required planning step.
2. `get_sdk_reference` - **required before you write any SDK code.** The server
   says so in its own instructions; guessing the SDK shape wastes turns.
3. `search_nodes` / `get_node_types` to find the right nodes and their exact
   parameter names, and `validate_node_config` as you write each one.
4. `validate_workflow` - **required before create or update.**
5. `create_workflow_from_code`, then `test_workflow` with pin data before
   `publish_workflow`.

`prepare_test_pin_data` and `test_workflow` let you prove a workflow works
without hitting real external services. Use them - a workflow that only "works"
when published is a demo that fails live.

This is a dedicated hackathon n8n instance, so nothing here can disturb Plum's
production automations. But team projects are off on it
(`teamProjectsEnabled: false`) and there is exactly one project, so every
participant's workflows land in the same place, created by the same account.
Create workflows without a `projectId`. The naming rules above are the only
boundary between 25 people.

`list_credentials` shows credentials the shared user can reach. Read it to find
an existing credential ID; never create one containing a participant's own keys.

## Building

Ask what should *start* it - a schedule, an inbound email, a webhook, or a manual
run - before designing the steps. Most hackathon ideas want one of:

- **Schedule → fetch → summarise → send.** Their Resend key sends the mail; their
  AgentMail inbox receives replies.
- **Inbound email → parse → classify → write to Supabase.** Their AgentMail
  address is the trigger; their own Supabase project is the store.
- **Webhook → transform → call their Vercel app.**

Keep it to the fewest nodes that demonstrate the idea. A workflow with four nodes
that runs beats twelve that half-work at demo time.

## When something needs a credential

The shared instance already holds what the event provisioned. If a workflow needs
a credential that isn't there, don't paste keys into a node where 24 other people
can read them - tell the participant to ask an organizer, and use their own
Supabase or Vercel app for that step instead.

## If the n8n server won't answer

Check `N8N_TOKEN` is in `~/.claude/settings.json`. If it's missing, re-run
`/insurwreck:status` to refresh the bundle, then restart Claude Code. Two failed
attempts is the point to get an organizer, not to keep retrying.
