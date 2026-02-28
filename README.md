# ShareThis.site

A simple project with a simple objective. It creates temporary, single‑word links that expire automatically.

## Tech

-   Astro & React
-   Mantine UI
-   Tailwind CSS
-   Firebase Admin (Firestore)

## Project structure

```
/
├── public/
├── src/
│   ├── components/             # React components
│   ├── layouts/                # Astro layouts
│   ├── lib/                    # Small utilities
│   │   ├── server/             # Server-only utilities
│   │   └── words.ts            # Random word generator
│   ├── pages/                  # Routes
│   │   ├── index.astro         # Home page
│   │   ├── [key].ts            # Redirect handler
│   │   └── api/
│   │       ├── links.ts        # Create Links
│   │       └── links/[key].ts  # Get Links
│   └── styles/                 # Global styles
│       └── global.css
├── astro.config.mjs
├── package.json
└── README.md
```

## Quick start

```
# install dependencies
bun i

# dev
bun run dev

# build + start
bun run build
bun run start
```

## Environmental Variables

-   SITE_URL (e.g., https://sharethis.site)
-   FIREBASE_PROJECT_ID
-   FIREBASE_CLIENT_EMAIL
-   FIREBASE_PRIVATE_KEY (use real newlines or escaped \n)

## Notes

-   Generated links are of the form: https://your-domain/{key}
-   API response includes shortUrl you can display or copy.
-   Minimal logic on purpose; easy to read and modify.
-   A Convex cron job (`convex/crons.ts`) runs daily at 08:00 UTC to delete expired or inactive links automatically.

## Deploying on Dokploy via Railpack

1. Push this repo to a Git host (GitHub/GitLab/etc.).
2. In Dokploy, create a project + application that points to your repo/branch and choose **Railpack** as the builder.
3. The repo ships with `railpack.json`, which pins Node 22 + Bun, runs `bun install --frozen-lockfile && bun run build`, prunes dev dependencies via `bun prune --production`, and publishes the `dist/` output plus production `node_modules`.
4. Dokploy will start the server with `bun run start`, which runs the standalone Astro adapter server (listening on `PORT`, default 8080).
5. Set required environment variables in Dokploy (e.g., `SITE_URL`, Convex + Firebase secrets, `CONVEX_URL`, `CONVEX_DEPLOYMENT`).
6. Enable auto-deploy if you want Dokploy to redeploy whenever `main` changes.
