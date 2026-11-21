import musicCover from "@/assets/images/gallery/img-2509.jpg";

/** Site name. Appended to every page title and used as `og:site_name`. */
export const SITE_NAME = "Warren & Eunice";
/** Fallback meta description for pages that don't set their own. */
export const SITE_DESCRIPTION =
  "Warren and Eunice are getting married on 14 January 2027 in Boracay, Philippines.";
/**
 * Canonical origin. Resolves canonical URLs, social images, and the sitemap.
 * Workers.dev origin until a custom domain is added.
 */
export const SITE_URL = "https://eunice-warren.warren-and-eunice.workers.dev";
/** Single switch to flip when the site should appear in search. */
export const SITE_INDEXABLE = false;
/** BCP 47 locale tag used to format dates and numbers. */
export const SITE_LOCALE = "en-US";
/** Routes excluded from search and the sitemap. Surrounding slashes are ignored. */
export const NOINDEX_ROUTES: string[] = ["/404", "/style-guide"];
/** Swap the song by replacing its file and updating this title, artist, and cover. */
export const BACKGROUND_MUSIC = {
  enabled: true,
  src: "/audio/our-song.mp3",
  title: "Man I Need",
  artist: "Olivia Dean",
  cover: musicCover,
} as const;
/** RSVP deadline shown in the invitation and confirmation flow. */
export const RSVP_DEADLINE = "2026-12-12T23:59:59+08:00";
export const RSVP_DEADLINE_LABEL = "December 12";
export const WEDDING_CALENDAR_PATH = "/eunice-warren-wedding.ics";
export const MESSAGE_US_HREF = "sms:+639362300525";
export const CHURCH_MAP_URL = "https://maps.app.goo.gl/hdagou9oAemHt2Mu5";
export const BELMONT_MAP_URL = "https://maps.app.goo.gl/zRcdZnfr5m5LzGYE9";
export const SAVOY_MAP_URL = "https://maps.app.goo.gl/fsWi3VsXBAkcK5DBA";
