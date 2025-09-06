# ShareThis.site

A simple project with a simple structure. It creates temporary, single‑word links that expire automatically.

## Tech

-   Astro 5 React
-   Mantine UI
-   Tailwind CSS v4
-   Firebase Admin (Firestore)

## Project structure (simple)

```
/
├── public/
├── src/
│   ├── components/        # React UI (App, LinkCreator, etc.)
│   ├── layouts/           # Astro layouts
│   ├── lib/               # Small utilities
│   │   ├── server/        # Server-only utilities
│   │   └── words.ts       # Random word generator
│   ├── pages/             # Routes
│   │   ├── index.astro    # Home page
│   │   ├── [key].ts       # Redirect handler
│   │   └── api/
│   │       ├── links.ts   # Create Links
│   │       └── links/[key].ts  # Get Links
│   └── styles/            # Global styles
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

## Environmental Variables (server)

-   SITE_URL (e.g., https://sharethis.site)
-   FIREBASE_PROJECT_ID
-   FIREBASE_CLIENT_EMAIL
-   FIREBASE_PRIVATE_KEY (use real newlines or escaped \n)

## Notes

-   Generated links are of the form: https://your-domain/{key}
-   API response includes shortUrl you can display or copy.
-   Minimal logic on purpose; easy to read and modify.
