# RSVP backend

The RSVP UI remains a prerendered static Astro page. Its browser script calls two
Astro actions running in the Cloudflare Worker. The actions validate input, enforce
the Manila deadline, verify Turnstile, rate-limit invite lookups, sign short-lived
invite tokens, and use either the server-side fake store or Google Sheets store.
RSVP_STORE=fake is for local development and Playwright; production is configured
with RSVP_STORE=sheets, and missing Sheets credentials fail rather than falling
back to fixtures.

## Sheet layout

Keep these header rows on the existing tabs:

- Guests: id | household | members | seats | notes. Members are comma-separated;
  blank seats means 2. Notes are never read.
- Responses: submitted_at | invite_id | name | attending | guests | email |
  companion_name | note. Responses append with RAW values.
- Songs, Latest RSVPs, Summary, and How to use are not modified.

## Production setup

1. Create a Google Cloud project, enable the Google Sheets API, create a service
   account, and create/download a JSON key.
2. Share the spreadsheet with the service account's client_email as an Editor.
3. Create a Cloudflare Turnstile widget for the production hostname and note its
   public site key.
4. Add the secrets with Wrangler: wrangler secret put
   GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_SHEET_ID, RSVP_TOKEN_SECRET, and
   TURNSTILE_SECRET_KEY.
5. No Workers Builds variables are needed. The committed Wrangler config
   defaults to RSVP_STORE=sheets, and the production Turnstile site key
   (0x4AAAAAAFYIhA_8zh_lLnm8, public) is the fallback in Rsvp.astro. Set
   PUBLIC_TURNSTILE_SITE_KEY at build time only to use a different widget.
   Preview/local runs override the store with fake.
6. Build and deploy with npm run build followed by npx wrangler deploy. With the
   adapter, this command still works unchanged: Wrangler uses
   @astrojs/cloudflare/entrypoints/server from main and the adapter's generated
   asset configuration. If Workers Builds currently runs only npx wrangler deploy,
   no dashboard deploy-command change is needed; it must still run npm run build
   first.

## Local development

Copy .dev.vars.example to .dev.vars (the example values are non-secret test
values), then run npm run dev. The fake fixtures include Liza Santos, Ana Reyes,
Mateo Cruz, Sofía Cruz, and the intentional Error Test failure path. The fake
store skips Turnstile network verification and the Turnstile script. Playwright
sets the same fake-store values for its production-build preview.
