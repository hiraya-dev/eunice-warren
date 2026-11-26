import musicCover from "@/assets/images/gallery/img-2509.jpg";
export { RSVP_NOTIFY_FROM } from "./site-consts.ts";

export const SITE_NAME = "Warren & Eunice";
export const SITE_DESCRIPTION =
  "Warren and Eunice are getting married on 14 January 2027 in Boracay, Philippines.";
export { SITE_URL } from "./site-consts.ts";
export const SITE_INDEXABLE = false;
export const SITE_LOCALE = "en-US";
export const NOINDEX_ROUTES: string[] = ["/404", "/style-guide"];
export const BACKGROUND_MUSIC = {
  enabled: true,
  src: "/audio/our-song.mp3",
  title: "Islands in the Stream",
  artist: "Music Travel Love & Marsha Milan",
  cover: musicCover,
} as const;
export const RSVP_DEADLINE = "2026-12-12T23:59:59+08:00";
export const RSVP_DEADLINE_LABEL = "December 12";
export const WEDDING_CALENDAR_PATH = "/eunice-warren-wedding.ics";
export const MESSAGE_US_HREF = "sms:+639362300525";
export const CHURCH_MAP_URL = "https://maps.app.goo.gl/hdagou9oAemHt2Mu5";
export const BELMONT_MAP_URL = "https://maps.app.goo.gl/zRcdZnfr5m5LzGYE9";
export const SAVOY_MAP_URL = "https://maps.app.goo.gl/fsWi3VsXBAkcK5DBA";
