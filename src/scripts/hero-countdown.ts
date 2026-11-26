export const HERO_COUNTDOWN_TARGET_MS = Date.parse("2027-01-14T15:00:00+08:00");
export const HERO_COUNTDOWN_TODAY_START_MS = Date.parse("2027-01-14T00:00:00+08:00");
export const HERO_COUNTDOWN_AFTER_MS = Date.parse("2027-01-15T00:00:00+08:00");

export type CountdownState =
  | { state: "counting"; days: number; hours: number; minutes: number; seconds: number }
  | { state: "today" }
  | { state: "after" };

export const countdownState = (nowMs: number): CountdownState => {
  if (nowMs >= HERO_COUNTDOWN_AFTER_MS) return { state: "after" };
  if (nowMs >= HERO_COUNTDOWN_TODAY_START_MS) return { state: "today" };

  let remainingSeconds = Math.max(0, Math.floor((HERO_COUNTDOWN_TARGET_MS - nowMs) / 1000));
  const days = Math.floor(remainingSeconds / 86400);
  remainingSeconds %= 86400;
  const hours = Math.floor(remainingSeconds / 3600);
  remainingSeconds %= 3600;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  return { state: "counting", days, hours, minutes, seconds };
};
