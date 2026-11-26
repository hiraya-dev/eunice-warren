# 0012: Worker config lives in `wrangler.jsonc`, and previews run the fake store

- **Status:** accepted
- **Date:** 2026-11-26

## Context

`wrangler.jsonc` and `astro.config.mjs` set how the Worker serves the site, which
store it uses and what it may send. Before ADR 0002 the reasons lived as comments
in both files.

## Decision

### Vars and bindings (`wrangler.jsonc`)

- `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` point at the Cloudflare Access "Guest
  ledger" app on `thefisheswedding.com/admin` (and `www`). They are set in this
  file, not in the dashboard, because a deploy overwrites dashboard vars.
- `send_email` (`RSVP_EMAIL`) can send only to verified Email Routing
  destinations on the free plan. The recipients come from the `NOTIFY_TO` secret
  (`src/lib/rsvp/notify.ts`).
- The `ratelimits` bindings take an options object, `limit({ key })`, not a bare
  key. `RateLimiter` in `src/lib/rsvp/logic.ts` types it that way, and the fake in
  `rsvp-unit.test.ts` throws on a bare string (ADR 0004).
- The custom domain is attached in the Cloudflare dashboard (2026-11-24), not with
  a `routes` entry.

### `assets.run_worker_first`

With `not_found_handling: "404-page"`, a browser navigation to a path with no
asset gets `404.html` without reaching the Worker, which would hide `/admin`.
A pattern list also sends every other unlisted POST to the asset service (405
locally). So the list names every route the Worker owns: `/admin`, `/admin/*`,
`/_actions/*` and `/api/*`. A new server route is added to it.

### Previews

- Previews share the Worker's production bindings. `previews.vars` therefore sets
  `RSVP_STORE` and `PUBLIC_RSVP_STORE` to `fake`, so a branch published by
  `npx wrangler preview` never writes to D1 and reviewers can try the forms.
- `previews.vars` blanks `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`, so preview
  `/admin` shows the sample host for Local review even if previews inherit the
  production `ADMIN_HOSTS` secret.

### `astro.config.mjs`

The integration that adds `X-Robots-Tag: noindex` to `_headers` while
`SITE_INDEXABLE` is `false` reads `dist/client/_headers` or the build's own
`_headers`, ignoring a missing one: the Cloudflare adapter and this integration
can run in either order.

## Consequences

- Moving a var into the dashboard loses it on the next deploy.
- A new server route that is not in `run_worker_first` works locally for GET but
  404s or 405s on Cloudflare.
- Removing the fake store from `previews.vars` makes every preview write to the
  production database.
