(() => {
  // Google Workspace sign-in for the internal pages of this site.
  //
  // Deliberately library-free: DESIGN.md requires assets stay local except
  // fonts, so this talks to Supabase's auth REST endpoints directly instead of
  // pulling @supabase/supabase-js from a CDN.
  //
  // ANON_KEY below is a PUBLISHABLE key and is meant to ship in page source.
  // The project behind it holds no tables, and a before-user-created hook
  // rejects any address outside the allowed domain for every provider, so the
  // key grants nothing beyond starting a sign-in.
  const PROJECT_REF = "vqbvofchrdbqrrmnjctv";
  const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZxYnZvZmNocmRicXJybW5qY3R2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0MTkxMTYsImV4cCI6MjEwMDk5NTExNn0.QlJMP_XlnmvfP1EoSpYYds6vJSrCWgwHhWPHP1fr2fs";
  const ALLOWED_DOMAIN = "plumhq.com";

  const AUTH = `https://${PROJECT_REF}.supabase.co/auth/v1`;
  const STORE = "insurwreck:site-session";

  function readSession() {
    try {
      const s = JSON.parse(window.localStorage.getItem(STORE) || "null");
      if (!s || !s.access_token) return null;
      if (s.expires_at && Date.now() > s.expires_at) return null;
      return s;
    } catch {
      return null;
    }
  }

  function writeSession(session) {
    try {
      window.localStorage.setItem(STORE, JSON.stringify(session));
    } catch {
      // Sign-in still works for this page view without persistence.
    }
  }

  function clearSession() {
    try {
      window.localStorage.removeItem(STORE);
    } catch {
      /* nothing to do */
    }
  }

  function signIn() {
    const back = window.location.origin + window.location.pathname;
    window.location.href =
      `${AUTH}/authorize?provider=google&redirect_to=${encodeURIComponent(back)}`;
  }

  async function signOut() {
    const session = readSession();
    clearSession();
    if (session) {
      try {
        await fetch(`${AUTH}/logout`, {
          method: "POST",
          headers: { apikey: ANON_KEY, Authorization: `Bearer ${session.access_token}` },
        });
      } catch {
        // Local sign-out is what matters to the person clicking it.
      }
    }
    window.location.reload();
  }

  // Supabase returns tokens in the URL fragment. Take them, then scrub the URL
  // so a token never sits in the address bar or gets pasted into Slack.
  function captureRedirect() {
    if (!window.location.hash.includes("access_token")) return null;
    const params = new URLSearchParams(window.location.hash.slice(1));
    const access_token = params.get("access_token");
    if (!access_token) return null;
    const expiresIn = Number.parseInt(params.get("expires_in") || "3600", 10);
    const session = { access_token, expires_at: Date.now() + expiresIn * 1000 };
    writeSession(session);
    window.history.replaceState(null, "", window.location.pathname);
    return session;
  }

  async function fetchUser(session) {
    try {
      const res = await fetch(`${AUTH}/user`, {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  // The gate builds its own DOM so a page is protected by loading this file —
  // no per-page markup to keep in sync.
  function buildGate() {
    let gate = document.querySelector(".auth-gate");
    if (gate) return gate;
    gate = document.createElement("div");
    gate.className = "auth-gate";
    gate.setAttribute("role", "dialog");
    gate.setAttribute("aria-modal", "true");
    gate.setAttribute("aria-labelledby", "auth-gate-title");
    gate.innerHTML = `
      <div class="auth-gate-card">
        <img class="auth-gate-logo" src="assets/plum-logo.svg" alt="Plum" />
        <p class="eyebrow">Insurwreck 4.0</p>
        <h1 id="auth-gate-title">Sign in with your Plum account.</h1>
        <p>This is for Plum colleagues taking part in Insurwreck 4.0. Continue with
          Google using your <strong>@plumhq.com</strong> account.</p>
        <button class="button button-primary" type="button" data-auth-signin>
          Continue with Google
        </button>
        <p class="auth-gate-note" data-auth-message></p>
      </div>`;
    document.body.appendChild(gate);
    return gate;
  }

  function showGate(message) {
    document.documentElement.classList.remove("auth-ok");
    document.documentElement.classList.add("auth-blocked");
    const gate = buildGate();
    gate.querySelector("[data-auth-signin]")?.addEventListener("click", signIn);
    const note = gate.querySelector("[data-auth-message]");
    if (note && message) note.textContent = message;
  }

  function showContent(email) {
    document.documentElement.classList.remove("auth-blocked", "auth-pending");
    document.documentElement.classList.add("auth-ok");
    document.querySelector(".auth-gate")?.remove();

    // Identity chip: uses a page-provided slot when there is one, otherwise
    // pins itself out of the way.
    const slot = document.querySelector("[data-auth-slot]");
    const host = slot || document.body;
    if (host.querySelector("[data-auth-who]")) return;
    const who = document.createElement("span");
    who.className = slot ? "auth-who" : "auth-who auth-who-floating";
    who.setAttribute("data-auth-who", "");
    who.innerHTML = `<span data-auth-email></span><button type="button" data-auth-signout>Sign out</button>`;
    who.querySelector("[data-auth-email]").textContent = email;
    who.querySelector("[data-auth-signout]").addEventListener("click", signOut);
    host.appendChild(who);
  }

  async function start() {
    const error = new URLSearchParams(window.location.search).get("error_description");
    const session = captureRedirect() || readSession();

    if (!session) {
      showGate(error || null);
      return;
    }

    const user = await fetchUser(session);
    const email = (user && user.email ? user.email : "").toLowerCase();

    if (!email) {
      clearSession();
      showGate("That sign-in expired. Try again.");
      return;
    }
    if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
      clearSession();
      showGate(`${email} is not a ${ALLOWED_DOMAIN} account.`);
      return;
    }
    showContent(email);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
