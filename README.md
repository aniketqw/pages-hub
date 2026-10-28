# pages-hub

One index for every page across my GitHub Pages sites, plus an admin console for publishing new ones.

**Live:** https://aniketqw.github.io/pages-hub/ · **Admin:** https://aniketqw.github.io/pages-hub/admin.html

| File | What it is |
|---|---|
| `index.html` | Public hub: every listed route, grouped and searchable, with a live up/down dot |
| `admin.html` + `assets/admin.js` | Admin console: sign in with GitHub, see all routes (hidden ones too), edit, delete, publish, discover |
| `routes.json` | The registry. Both pages read it, and the admin console commits to it |
| `pages/<slug>/` | Pages hosted by the hub itself, uploaded through the admin console |
| `config.js` | Owner, repo, branch, allowed admin logins, OAuth worker URL |
| `oauth-worker/` | Cloudflare Worker behind **Sign in with GitHub** (setup in its README) |

## Routes found at setup

| Site | Routes |
|---|---|
| `aniketqw.github.io` (portfolio) | `/`, `/admin.html` (hidden), `/ui_kits/portfolio/`, `/ui_kits/admin/`, `/preview/01…17-*.html` |
| `agentic` | `/agentic/`, `/agentic/v2/`, `/agentic/v3/` |
| `interview-prep` | `/interview-prep/` |
| `pages-hub` | `/pages-hub/pages/ml-dl-workbook/` (pending upload) |

`agentic/reader/` and `agentic/reader-v3/` are Vite sources, not built pages, so they're left out.
Other repos contain HTML files (`live-debugging-partner`, `tiktokAutomater`, `dm_eval_3`,
`webdev100xdevNotes`, …), but only an authenticated API call can tell whether Pages is enabled on
them. Use **Admin → Discover** to scan every repo and add what it finds.

## How the admin console signs in and saves

- **Sign in with GitHub** sends you to github.com, so your passkey or 2FA applies. It needs the
  worker in `oauth-worker/`. Until that's deployed, you can sign in with a fine-grained token instead.
- The console accepts only logins listed in `config.js` → `allowedUsers` that also have push access.
- Each save is **one commit** made through the GitHub Git Data API (files plus `routes.json`
  together). Pages redeploys in about a minute.
- The token stays in your browser (session storage, or local storage if you tick *keep me signed in*).

## Honest limits

This repo is public. **Hidden** routes don't appear on the hub, but they're still in `routes.json`
and reachable by URL. The admin sign-in protects *writes*, not reads. Anything confidential
belongs in a private repo, not on GitHub Pages.
