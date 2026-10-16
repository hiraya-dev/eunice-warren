import { configFromEnv, sheetsFetch } from "../rsvp/sheets.ts";

export interface LoveNote {
  id: string;
  submittedAt: string;
  name: string;
  city: string;
  message: string;
  photoKey: string;
  hidden: boolean;
}

export interface LoveNoteInput {
  id: string;
  submittedAt: string;
  name: string;
  city: string;
  message: string;
  photoKey: string;
}

export interface LovePhotoStore {
  listNotes(): Promise<LoveNote[]>;
  addNote(note: LoveNoteInput, photo: Uint8Array): Promise<void>;
  getPhoto(key: string): Promise<Uint8Array | null>;
}

type KvNamespace = {
  put(key: string, value: ArrayBuffer | Uint8Array, options?: { metadata?: unknown }): Promise<void>;
  delete(key: string): Promise<void>;
  get(key: string, type: "arrayBuffer"): Promise<ArrayBuffer | null>;
};

const parseHidden = (value: unknown) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  return value === true || normalized === "true" || normalized === "yes" || normalized === "1";
};

export const parseNoteRows = (rows: unknown[][]): LoveNote[] =>
  rows.flatMap((row) => {
    const [id, submittedAt, name, city, message, photoKey, hidden] = row;
    if (!String(id ?? "").trim() || !String(photoKey ?? "").trim()) return [];
    return [{
      id: String(id).trim(),
      submittedAt: String(submittedAt ?? "").trim(),
      name: String(name ?? "").trim(),
      city: String(city ?? "").trim(),
      message: String(message ?? "").trim(),
      photoKey: String(photoKey).trim(),
      hidden: parseHidden(hidden),
    }];
  });

export const sortVisibleNotes = (notes: LoveNote[], max = 100) =>
  notes
    .filter((note) => !note.hidden)
    .sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt))
    .slice(0, max);

const fakeNotes: LoveNote[] = [
  {
    id: "hidden-test-note",
    submittedAt: "2026-01-01T00:00:00.000Z",
    name: "Hidden Guest",
    city: "",
    message: "This note should never appear.",
    photoKey: "notes/hidden-test-note.jpg",
    hidden: true,
  },
];
const fakePhotos = new Map<string, Uint8Array>();

export const createFakeLoveStore = (): LovePhotoStore => ({
  async listNotes() {
    return fakeNotes.map((note) => ({ ...note }));
  },
  async addNote(note, photo) {
    fakeNotes.unshift({ ...note, hidden: false });
    fakePhotos.set(note.photoKey, photo);
  },
  async getPhoto(key) {
    return fakePhotos.get(key) ?? null;
  },
});

export const createSheetsLoveStore = (env: Record<string, unknown>): LovePhotoStore => {
  const config = configFromEnv(env);
  const photos = env.WITH_LOVE_PHOTOS as KvNamespace | undefined;
  if (!photos) throw new Error("With Love photo storage is missing");
  return {
    async listNotes() {
      if (!cachedNotes || cachedNotes.expiresAt <= Date.now()) {
        const response = await sheetsFetch(config, "values/Notes!A2:G");
        const data = (await response.json()) as { values?: unknown[][] };
        cachedNotes = { expiresAt: Date.now() + 60_000, rows: data.values ?? [] };
      }
      return parseNoteRows(cachedNotes.rows);
    },
    async addNote(note, photo) {
      await photos.put(note.photoKey, photo, { metadata: { contentType: "image/jpeg" } });
      try {
        await sheetsFetch(config, "values/Notes!A:G:append?valueInputOption=RAW&insertDataOption=OVERWRITE", {
          method: "POST",
          body: JSON.stringify({ values: [[note.id, note.submittedAt, note.name, note.city, note.message, note.photoKey, false]] }),
        });
      } catch (error) {
        try { await photos.delete(note.photoKey); } catch { /* Best effort cleanup. */ }
        throw error;
      }
      cachedNotes = undefined;
    },
    async getPhoto(key) {
      const value = await photos.get(key, "arrayBuffer");
      return value ? new Uint8Array(value) : null;
    },
  };
};

let selectedStore: LovePhotoStore | undefined;
let cachedNotes: { expiresAt: number; rows: unknown[][] } | undefined;
export const getLoveStore = (env: Record<string, unknown>) => {
  if (!selectedStore) {
    selectedStore = env.RSVP_STORE === "fake" ? createFakeLoveStore() : createSheetsLoveStore(env);
  }
  return selectedStore;
};
