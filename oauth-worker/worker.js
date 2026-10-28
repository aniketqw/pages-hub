// GitHub OAuth token exchange for the Pages Hub admin console.
//
// GitHub's OAuth flow needs a client secret, which can't live in a public static
// page, so this Worker holds it. It does two things:
//   GET /login?state=…     -> redirect to GitHub's authorize screen
//   GET /callback?code=…   -> swap the code for a token, hand it to ADMIN_URL
//
// Secrets/vars (wrangler secret put …): GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET,
// ADMIN_URL (e.g. https://aniketqw.github.io/pages-hub/admin.html), optional SCOPE.
// The token is only ever sent to ADMIN_URL, never to a caller-supplied address.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const state = url.searchParams.get("state") || "";
    if (!/^[0-9a-f]{32}$/.test(state)) return new Response("Bad state", { status: 400 });

    if (url.pathname === "/login") {
      const auth = new URL("https://github.com/login/oauth/authorize");
      auth.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
      auth.searchParams.set("redirect_uri", url.origin + "/callback");
      auth.searchParams.set("scope", env.SCOPE || "public_repo");
      auth.searchParams.set("state", state);
      auth.searchParams.set("allow_signup", "false");
      return Response.redirect(auth.toString(), 302);
    }

    if (url.pathname === "/callback") {
      const back = new URL(env.ADMIN_URL);
      const code = url.searchParams.get("code");
      if (!code) {
        back.hash = new URLSearchParams({ error: url.searchParams.get("error") || "no_code", state }).toString();
        return Response.redirect(back.toString(), 302);
      }
      const res = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: url.origin + "/callback",
        }),
      });
      const data = await res.json().catch(() => ({}));
      back.hash = new URLSearchParams(
        data.access_token ? { access_token: data.access_token, state } : { error: data.error || "exchange_failed", state }
      ).toString();
      return new Response(null, { status: 302, headers: { Location: back.toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
    }

    return new Response("Not found", { status: 404 });
  },
};
