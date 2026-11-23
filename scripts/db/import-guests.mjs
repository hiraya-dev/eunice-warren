#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import crypto from "node:crypto";

export const TICKET_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const MAX_SEATS = 12;

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"' && field.length === 0) quoted = true;
    else if (character === ",") { row.push(field); field = ""; }
    else if (character === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (character !== "\r") field += character;
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted field");
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function normalizeImportName(value) {
  return String(value ?? "").normalize("NFC").replace(/[\t\u00a0\s]+/g, " ").trim();
}

const normalizedForSlug = (value) => normalizeImportName(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const guestKey = (value) => normalizeImportName(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const slugify = (value) => normalizedForSlug(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
export const placeholderPattern = /^(\d+)\s+guest(?:s|\(s\))?$|^\+(\d+)$|^plus\s+one$/i;
const singleSurnameParticles = new Set(["de", "del", "dela", "delos", "della", "san", "sta", "sto", "van", "von", "da", "di"]);

export function displaySurname(name) {
  const tokens = normalizeImportName(name).split(" ").filter(Boolean);
  if (tokens.length < 2) return tokens[0] ?? "";
  const last = tokens.at(-1);
  const before = tokens.at(-2);
  const twoBefore = tokens.at(-3);
  if (twoBefore?.toLowerCase() === "de" && before?.toLowerCase() === "los") return `${twoBefore} ${before} ${last}`;
  if (before && singleSurnameParticles.has(before.toLowerCase())) return `${before} ${last}`;
  return last;
}

function randomTicket(used) {
  let ticket = "";
  do {
    const bytes = crypto.randomBytes(6);
    ticket = [...bytes].map((byte) => TICKET_ALPHABET[byte % TICKET_ALPHABET.length]).join("");
  } while (used.has(ticket));
  used.add(ticket);
  return ticket;
}

export function importRows(rows) {
  if (!rows.length || rows[0].length !== 5 || rows[0].join(",") !== "id,household,members,seats,notes") throw new Error("Invalid header: expected id,household,members,seats,notes");
  const households = [];
  const usedIds = new Map();
  const requestedIds = new Set(
    rows.slice(1)
      .map(([rawId = ""]) => normalizeImportName(rawId).toLowerCase())
      .filter(Boolean),
  );
  const usedTickets = new Set();
  const errors = [];
  const warnings = [];
  const skipped = [];
  const changes = [];
  const generatedIds = [];
  const placeholderConversions = [];
  let placeholderSeats = 0;
  let normalizedNames = 0;
  for (let index = 1; index < rows.length; index += 1) {
    const [rawId = "", rawHousehold = "", rawMembers = "", rawSeats = "", rawNotes = ""] = rows[index];
    if (![rawId, rawHousehold, rawMembers, rawSeats, rawNotes].some((value) => String(value).trim())) continue;
    if (/^(sample:|test:)/i.test(normalizeImportName(rawNotes))) { skipped.push({ row: index + 1, id: rawId }); continue; }
    const members = [];
    let placeholders = 0;
    for (const splitMember of rawMembers.split(",")) {
      const rawMember = splitMember.startsWith(" ") ? splitMember.slice(1) : splitMember;
      const member = normalizeImportName(rawMember);
      if (!member) continue;
      const match = member.match(placeholderPattern);
      if (match) {
        const count = Number(match[1] ?? match[2] ?? 1);
        placeholders += count;
        placeholderSeats += count;
        placeholderConversions.push({ row: index + 1, text: member, seats: count });
        continue;
      }
      members.push(member);
      if (member !== rawMember) { normalizedNames += 1; changes.push({ row: index + 1, from: rawMember, to: member }); }
    }
    if (!members.length) { errors.push({ row: index + 1, message: "household has no named member" }); continue; }
    const seats = rawSeats.trim() === "" ? 2 : Number(rawSeats.trim());
    if (!Number.isInteger(seats) || seats < 1 || seats > MAX_SEATS || seats < members.length + placeholders) {
      errors.push({ row: index + 1, message: `seats must be a whole number from 1 to ${MAX_SEATS} and fit every named member and placeholder` });
      continue;
    }
    const requestedId = normalizeImportName(rawId).toLowerCase();
    const baseId = requestedId || slugify(members[0]);
    let id = baseId;
    const numberedBase = baseId.match(/^(.*)-(\d+)$/);
    if (requestedId && numberedBase && usedIds.has(id)) {
      const prefix = numberedBase[1];
      const width = numberedBase[2].length;
      let nextNumber = Number(numberedBase[2]) + 1;
      do {
        id = `${prefix}-${String(nextNumber).padStart(width, "0")}`;
        nextNumber += 1;
      } while (requestedIds.has(id) || usedIds.has(id));
    } else {
      let suffix = 1;
      while (usedIds.has(id)) id = `${baseId}-${++suffix}`;
    }
    if (id !== baseId) warnings.push({ row: index + 1, message: `duplicate id ${baseId}; imported as ${id}` });
    usedIds.set(id, true);
    if (!requestedId) generatedIds.push({ row: index + 1, id });
    const label = normalizeImportName(rawHousehold) || (seats === 1 ? members[0] : `${members[0]} +${seats - 1}`);
    if (label.length > 80) errors.push({ row: index + 1, message: `label exceeds 80 characters: ${label}` });
    const familyPlace = label.match(/^([^_]+)_[^_]+$/);
    const lead = members[0];
    const displayName = seats === 1 ? lead : familyPlace ? `${normalizeImportName(familyPlace[1])} Family` : `${displaySurname(lead)} Family`;
    const differentSurnames = new Set(members.map((member) => member.split(" ").at(-1)?.toLowerCase())).size > 1;
    const risky = differentSurnames || members.some((member) => /\b(?:de|del|dela|delos|de los|della|san|sta|sto|van|von|da|di)\b/i.test(member));
    if (risky) warnings.push({ row: index + 1, message: `risky display name derived for ${label} (lead: ${lead})` });
    if (displayName.length > 40) errors.push({ row: index + 1, message: `display name exceeds 40 characters: ${displayName}` });
    households.push({ id, label, displayName, lead, members, seats, placeholders, ticketCode: randomTicket(usedTickets), risky });
  }
  return { households, errors, warnings, skipped, changes, generatedIds, placeholderConversions, placeholderSeats, normalizedNames };
}

export function seedSql(report, replace = false) {
  const quote = (value) => value === null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;
  const now = "strftime('%Y-%m-%dT%H:%M:%fZ')";
  const statements = [];
  if (replace) statements.push("DELETE FROM invite_seats;", "DELETE FROM households;");
  for (const household of report.households) {
    statements.push(`INSERT INTO households (id,label,display_name,ticket_code,created_at,updated_at) VALUES (${quote(household.id)},${quote(household.label)},${quote(household.displayName)},${quote(household.ticketCode)},${now},${now});`);
    for (let slot = 1; slot <= household.seats; slot += 1) {
      const member = household.members[slot - 1] ?? null;
      const key = member ? guestKey(member) : null;
      const surname = key?.split(" ").at(-1) ?? null;
      statements.push(`INSERT INTO invite_seats (household_id,kind,slot,status,invited_name,name_key,surname_key,name,created_at,updated_at) VALUES (${quote(household.id)},${quote(member ? "member" : "plus_one")},${slot},'active',${quote(member)},${quote(member ? key : null)},${quote(member ? surname : null)},${quote(member)},${now},${now});`);
    }
  }
  return `${statements.join("\n")}\n`;
}

export function formatReport(report) {
  const named = report.households.reduce((sum, household) => sum + household.members.length, 0);
  const seats = report.households.reduce((sum, household) => sum + household.seats, 0);
  return [
    `Households: ${report.households.length}`,
    `Seats: ${seats} (named ${named}, blank plus-ones ${seats - named})`,
    `Skipped: ${report.skipped.length}`,
    `Normalized names: ${report.normalizedNames}`,
    `Placeholder seats: ${report.placeholderSeats}`,
    ...report.placeholderConversions.map((conversion) => `- row ${conversion.row}: ${conversion.text} -> ${conversion.seats} blank seats`),
    "Normalized changes:",
    ...report.changes.map((change) => `- row ${change.row}: ${change.from} -> ${change.to}`),
    "Generated ids:",
    ...report.generatedIds.map((generated) => `- row ${generated.row}: ${generated.id}`),
    `Ticket codes: ${report.households.length}`,
    `Warnings: ${report.warnings.length}`,
    `Errors: ${report.errors.length}`,
    "Derived display names:",
    ...report.households.map((household) => `- ${household.displayName} <- ${household.label} (lead: ${household.lead})${household.risky ? " [risky]" : ""}`),
    ...report.warnings.map((warning) => `Warning row ${warning.row}: ${warning.message}`),
    ...report.errors.map((error) => `Error row ${error.row}: ${error.message}`),
  ].join("\n");
}

async function main() {
  const [, , input, ...args] = process.argv;
  if (!input) { console.error("Usage: import-guests.mjs <guests.csv> [--write seed.sql] [--replace]"); process.exitCode = 2; return; }
  try {
    const report = importRows(parseCsv(await readFile(input, "utf8")));
    console.log(formatReport(report));
    const writeAt = args.indexOf("--write");
    if (writeAt >= 0 && !args[writeAt + 1]) throw new Error("--write requires an output path");
    if (writeAt >= 0 && report.errors.length === 0) await writeFile(args[writeAt + 1], seedSql(report, args.includes("--replace")));
    if (report.errors.length) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
