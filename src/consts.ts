/** Site name. Appended to every page title and used as `og:site_name`. */
export const SITE_NAME = "Eunice & Warren";
/** Fallback meta description for pages that don't set their own. */
export const SITE_DESCRIPTION =
  "Eunice and Warren are getting married on 14 January 2027 in Boracay, Philippines.";
/**
 * Canonical origin. Resolves canonical URLs, social images, and the sitemap.
 * Placeholder until the Cloudflare domain is chosen.
 */
export const SITE_URL = "https://example.com";
/** BCP 47 locale tag used to format dates and numbers. */
export const SITE_LOCALE = "en-US";
/** Routes excluded from search and the sitemap. Surrounding slashes are ignored. */
export const NOINDEX_ROUTES: string[] = ["/404", "/style-guide"];
