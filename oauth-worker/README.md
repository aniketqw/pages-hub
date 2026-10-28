# OAuth worker

This is the token exchange behind **Sign in with GitHub** on `admin.html`. You sign in on
github.com (passkey, security key, or password + 2FA). The worker swaps GitHub's one-time
code for an access token and redirects back to the admin page. It runs on Cloudflare's free tier.

## One-time setup (about 5 minutes)

1. **Create a GitHub OAuth App** at <https://github.com/settings/applications/new>
   - Homepage URL: `https://aniketqw.github.io/pages-hub/`
   - Authorization callback URL: `https://pages-hub-oauth.<your-subdomain>.workers.dev/callback`
     (you get the exact host in step 2, so you can edit this afterwards)
   - Copy the **Client ID**, then **Generate a new client secret**.

2. **Deploy the worker** (needs Node and a free Cloudflare account):

   ```bash
   cd oauth-worker
   npx wrangler login
   npx wrangler secret put GITHUB_CLIENT_ID
   npx wrangler secret put GITHUB_CLIENT_SECRET
   npx wrangler deploy
   ```

   `deploy` prints the worker URL. Put `<that URL>/callback` into the OAuth App's callback field.

3. **Point the hub at it.** Set `oauthWorkerUrl` in `../config.js` to the worker URL and commit.

Until step 3 is done, the admin page only shows the token sign-in.

## Why a worker at all?

GitHub Pages only serves static files, and GitHub's OAuth flow needs a client secret.
A secret inside a public page isn't a secret, so this ~50-line worker keeps it out of the page.
The worker never stores tokens, and it only redirects to the fixed `ADMIN_URL`.
