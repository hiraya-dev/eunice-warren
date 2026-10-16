export const stripControls = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
export const isJpeg = (bytes: Uint8Array) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
export const isWithinLength = (value: string, max: number) => value.length > 0 && value.length <= max;
export const manilaDate = (date: Date | string = new Date()) => {
  const value = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
};
export const isTodayInManila = (iso: string, now = new Date()) => manilaDate(iso) === manilaDate(now);
