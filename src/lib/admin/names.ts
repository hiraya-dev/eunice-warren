export const singleSurnameParticles = new Set([
  "de",
  "del",
  "dela",
  "delos",
  "della",
  "san",
  "sta",
  "sto",
  "van",
  "von",
  "da",
  "di",
]);

export const placeholderPattern =
  /^(\d+)\s+guest(?:s|\(s\))?$|^\+(\d+)$|^plus\s+one$/i;

export function normalizeName(value: string) {
  return value
    .normalize("NFC")
    .replace(/[\t\u00a0\s]+/g, " ")
    .trim();
}

export function duplicateNameKey(value: string) {
  return normalizeName(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();
}

export function displaySurname(name: string) {
  const tokens = normalizeName(name).split(" ").filter(Boolean);
  if (tokens.length < 2) return tokens[0] ?? "";
  const last = tokens.at(-1)!;
  const before = tokens.at(-2)!;
  const twoBefore = tokens.at(-3);
  if (twoBefore?.toLowerCase() === "de" && before.toLowerCase() === "los")
    return `${twoBefore} ${before} ${last}`;
  if (singleSurnameParticles.has(before.toLowerCase()))
    return `${before} ${last}`;
  return last;
}

export function parsePlusOne(value: string) {
  const clean = normalizeName(value);
  const match = clean.match(placeholderPattern);
  if (!match && clean.toLocaleLowerCase() !== "guest") return 0;
  return Number(match?.[1] ?? match?.[2] ?? 1) || 1;
}

const given = (name: string) => normalizeName(name).split(" ")[0] ?? "";
const firstWords = (name: string) =>
  normalizeName(name).split(" ").slice(0, 2).join(" ");

export function suggestInvitationName(names: string[]) {
  const values = names.map(normalizeName).filter(Boolean);
  if (!values.length) return "";
  if (values.length === 1) return values[0].slice(0, 40);
  const surnames = values.map((value) =>
    value.includes(" ") ? displaySurname(value) : "",
  );
  const counts = new Map<string, number>();
  for (const surname of surnames) {
    if (!surname) continue;
    counts.set(
      duplicateNameKey(surname),
      (counts.get(duplicateNameKey(surname)) ?? 0) + 1,
    );
  }
  const [commonKey, commonCount] = [...counts.entries()].sort(
    (a, b) => b[1] - a[1],
  )[0] ?? ["", 0];
  const common =
    surnames.find((surname) => duplicateNameKey(surname) === commonKey) ?? "";
  if (
    commonCount === values.length ||
    (values.length >= 3 && commonCount > values.length / 2)
  )
    return `${common} Family`.slice(0, 40);
  if (values.length === 2) {
    const full = `${values[0]} & ${values[1]}`;
    if (full.length <= 40) return full;
    const short = `${given(values[0])} & ${given(values[1])}`;
    if (short.length <= 40) return short;
    return `${firstWords(values[0])} & ${firstWords(values[1])}`.slice(0, 40);
  }
  const full = `${values[0]} & family`;
  if (full.length <= 40) return full;
  const short = `${given(values[0])} & family`;
  if (short.length <= 40) return short;
  return `${firstWords(values[0])} & family`.slice(0, 40);
}

export function slugifyName(value: string) {
  return duplicateNameKey(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// The host ID is a short slug of the invitation name: "The Toledo Family" →
// "toledo", "Jay R Nearents & family" → "jay-r-nearents". A taken ID (compared
// without case) gets -02, -03…. Suffixes use at least two digits.
export function generateHostId(
  invitationName: string,
  taken: Iterable<string> = [],
) {
  const core = normalizeName(invitationName)
    .replace(/^the\s+/i, "")
    .replace(/\s*&\s*family$/i, "")
    .replace(/\s+family$/i, "");
  const base = slugifyName(core).slice(0, 72).replace(/-+$/, "") || "household";
  const used = new Set([...taken].map((value) => value.toLowerCase()));
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${String(suffix).padStart(2, "0")}`)) suffix += 1;
  return `${base}-${String(suffix).padStart(2, "0")}`;
}
