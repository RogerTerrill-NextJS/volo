<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project workflow

- Use `feature/` for every new feature branch.
- Use Netlify Deploy Previews for pre-release review and `main` for production.
  VOLO does not use a separate staging environment.
- Keep Netlify automatic production publishing locked. Merge reviewed tickets
  into `main`, then publish a batch only when the user requests a release.
  A merge is not proof that a change is live; record preview verification and
  production release verification separately. Keep PR Deploy Previews automatic.
