/** Site name. Appended to every page title and used as `og:site_name`. */
export const SITE_NAME = "Eunice & Warren";
/** Fallback meta description for pages that don't set their own. */
export const SITE_DESCRIPTION =
  "Eunice and Warren are getting married on 14 January 2027 in Boracay, Philippines.";
/**
 * Canonical origin. Resolves canonical URLs, social images, and the sitemap.
 * Workers.dev origin until a custom domain is added.
 */
export const SITE_URL = "https://eunice-warren.neil-e89.workers.dev";
/** Single switch to flip when the site should appear in search. */
export const SITE_INDEXABLE = false;
/** BCP 47 locale tag used to format dates and numbers. */
export const SITE_LOCALE = "en-US";
/** Routes excluded from search and the sitemap. Surrounding slashes are ignored. */
export const NOINDEX_ROUTES: string[] = ["/404", "/style-guide"];
/** RSVP deadline shown in the invitation and confirmation flow. */
export const RSVP_DEADLINE = "2026-12-31T23:59:59+08:00";
export const RSVP_DEADLINE_LABEL = "December 31";
