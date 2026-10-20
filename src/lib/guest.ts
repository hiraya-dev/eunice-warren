export const GUEST_STORAGE_KEY = "ew-guest-v1";

export interface RememberedGuest {
  name: string;
  householdName?: string;
  seats?: number;
  at: string;
}

export interface SkippedGuest {
  skipped: true;
  at: string;
}

export type GuestState = RememberedGuest | SkippedGuest;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isGuestState = (value: unknown): value is GuestState => {
  if (!isRecord(value) || typeof value.at !== "string") return false;
  if (value.skipped === true) return true;
  return (
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    (value.householdName === undefined || typeof value.householdName === "string") &&
    (value.seats === undefined || typeof value.seats === "number")
  );
};

export const getGuest = (): GuestState | null => {
  try {
    const raw = window.localStorage.getItem(GUEST_STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    return isGuestState(value) ? value : null;
  } catch {
    return null;
  }
};

export const setGuest = (guest: RememberedGuest | SkippedGuest): boolean => {
  try {
    window.localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(guest));
    return true;
  } catch {
    return false;
  }
};

export const clearGuest = (): void => {
  try {
    window.localStorage.removeItem(GUEST_STORAGE_KEY);
  } catch {
    // Storage may be disabled; the page remains usable without it.
  }
};
