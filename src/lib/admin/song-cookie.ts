export const fakeRemovedSongsCookie = "ew-fake-removed-songs";

const maxRemovedSongIds = 64;

export function parseFakeRemovedSongIds(cookieHeader: string | null | undefined) {
  const value = cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${fakeRemovedSongsCookie}=`))
    ?.slice(fakeRemovedSongsCookie.length + 1);
  const ids = new Set<number>();
  if (!value) return ids;
  for (const item of value.split(",").slice(0, maxRemovedSongIds)) {
    if (!/^\d+$/.test(item)) continue;
    const id = Number(item);
    if (Number.isSafeInteger(id) && id > 0) ids.add(id);
  }
  return ids;
}

export function serializeFakeRemovedSongIds(ids: Set<number>) {
  return [...ids]
    .filter((id) => Number.isSafeInteger(id) && id > 0)
    .sort((a, b) => a - b)
    .slice(0, maxRemovedSongIds)
    .join(",");
}

export function fakeRemovedSongsSetCookie(ids: Set<number>) {
  return `${fakeRemovedSongsCookie}=${serializeFakeRemovedSongIds(ids)}; Path=/admin; SameSite=Lax; HttpOnly`;
}
