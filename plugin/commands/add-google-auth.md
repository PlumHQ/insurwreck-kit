---
description: Add Google (Plum Workspace) sign-in to your Insurwreck app
---

Add Google sign-in, restricted to `@plumhq.com` accounts, to the participant's app. Their Supabase project is the auth authority — they never handle OAuth credentials.

The credential desk base URL is `https://insurwreck-desk.preview.plumhq.com` (call it `$DESK`).

## Step 1 — Find their setup

Read `~/.insurwreck/credentials.json`. If it does not exist, tell them to run `/insurwreck:start` first and stop.

Look at `services.google_auth`:

- **Missing, or has `"incomplete": true` with `pending_parts` containing `google_console_registration`** → go to Step 2 to refresh.
- **Present and complete** → skip to Step 3.

## Step 2 — Refresh the bundle

Google sign-in is configured by the desk, not on this machine, so refresh their bundle. Explain that briefly, then re-verify (sessions are deliberately not stored on disk):

```
curl -s -X POST $DESK/api/otp -H "Content-Type: application/json" -d '{"email":"<their email>"}'
```

Ask for the six-digit code, then:

```
curl -s -X POST $DESK/api/verify -H "Content-Type: application/json" -d '{"email":"<email>","code":"<code>"}'
```

With the returned token (never display it):

```
curl -s --max-time 280 -X POST $DESK/api/provision \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"agent":"claude-code"}'
```

Write the response to `~/.insurwreck/credentials.json` (mode 600), replacing the old file.

## Step 3 — Wire it into their app

Report what is now true of their project: Google sign-in is enabled on their own Supabase project, and only `@plumhq.com` accounts can complete it — enforced both by the Internal Google app and by a `before_user_created` hook inside their database.

Then give them the code for their stack. The snippet is in `services.google_auth.sign_in_snippet`; present it in context, for example:

```js
// Sign in
const { error } = await supabase.auth.signInWithOAuth({
  provider: 'google',
  options: {
    queryParams: { hd: 'plumhq.com' },
    redirectTo: window.location.origin,
  },
})

// Read the signed-in user
const { data: { user } } = await supabase.auth.getUser()

// Sign out
await supabase.auth.signOut()
```

They need their Supabase URL and **anon** key (both in `services.supabase`) to create the client — never the service_role key in browser code. If their project has no Supabase client yet, offer to scaffold one and install `@supabase/supabase-js`.

Mention that their app URL is already on the redirect allow list (`services.google_auth.redirect_allow_list`), covering `localhost` for local development and their Vercel deployments. If they plan to serve on a different host, tell them to ask the AI pod to add it.

## Step 4 — If console registration is still pending

If `pending_parts` still contains `google_console_registration`, be straight with them: their app's Google callback URL has not yet been added to the shared Google OAuth client, so the sign-in button will error with `redirect_uri_mismatch` until an organizer does it. This is a manual step Google offers no API for. Show them their callback URL from `services.google_auth.callback_url`, tell them to ping the AI pod, and note that everything else is ready — they can build the rest of the flow now and the button will start working with no code change on their side.

Do not attempt to register the callback yourself.
