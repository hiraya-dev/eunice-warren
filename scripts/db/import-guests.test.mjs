import test from "node:test";
import assert from "node:assert/strict";
import { displaySurname, formatReport, importRows, parseCsv, seedSql } from "./import-guests.mjs";

test("parses RFC 4180 quoted commas, escaped quotes, and CRLF", () => {
  assert.deepEqual(parseCsv('id,household,members,seats,notes\r\nabc,"Family, Place","Ana ""A"" Cruz, 1 Guest",2,"ok"\r\n'), [
    ["id", "household", "members", "seats", "notes"],
    ["abc", "Family, Place", 'Ana "A" Cruz, 1 Guest', "2", "ok"],
  ]);
});

test("imports names, placeholders, defaults, display-name rules, slugs, and unique tickets", () => {
  const report = importRows([
    ["id", "household", "members", "seats", "notes"],
    ["", "Santos_Manila", " Liza\tSantos , +1", "", ""],
    ["family", "Foster_Manila", "Ana Reyes", "2", ""],
    ["DUP", "Toledo_Sabang", "Ana Toledo", "1", ""],
    ["dup", "Other", "Bea Reyes", "2", ""],
    ["", "", "Fatima Marie Oba", "1", ""],
  ]);
  assert.equal(report.households[0].id, "liza-santos");
  assert.equal(report.households[0].displayName, "Santos Family");
  assert.equal(report.households[0].seats, 2);
  assert.equal(report.households[0].placeholders, 1);
  assert.equal(report.households[1].displayName, "Foster Family");
  assert.equal(report.households[2].displayName, "Ana Toledo");
  assert.equal(report.households[3].id, "dup-2");
  assert.equal(report.households[4].id, "fatima-marie-oba");
  assert.equal(new Set(report.households.map((household) => household.ticketCode)).size, 5);
  assert.equal(report.normalizedNames, 1);
  assert.deepEqual(report.generatedIds.map(({ row, id }) => ({ row, id })), [{ row: 2, id: "liza-santos" }, { row: 6, id: "fatima-marie-oba" }]);
  assert.deepEqual(report.placeholderConversions, [{ row: 2, text: "+1", seats: 1 }]);
  assert.match(formatReport(report), /Derived display names:/);
  assert.match(formatReport(report), /Ticket codes: 5/);
  assert.match(formatReport(report), /Generated ids:\n- row 2: liza-santos/);
});

test("skips sample and test rows and reports every invalid rule", () => {
  const report = importRows([
    ["id", "household", "members", "seats", "notes"],
    ["sample", "Sample", "Nobody", "2", "SAMPLE: fixture"],
    ["test", "Test", "Nobody", "2", "TEST: fixture"],
    ["empty", "No names", "1 Guest", "1", ""],
    ["bad", "Too few", "A Person, B Person", "1", ""],
    ["bad2", "Too many", "A Person", "13", ""],
    ["bad3", "Long", "A Person", "not a number", ""],
  ]);
  assert.equal(report.skipped.length, 2);
  assert.equal(report.errors.length, 4);
  assert.match(report.errors[0].message, /no named member/);
});

test("marks risky surname particles and emits replace-safe seed SQL", () => {
  const report = importRows([["id", "household", "members", "seats", "notes"], ["one", "", "Obi Delos Reyes, Emma De Ocampo", "2", ""]]);
  assert.equal(report.warnings.length, 1);
  assert.equal(report.households[0].displayName, "Delos Reyes Family");
  assert.equal(displaySurname("Emma De Ocampo"), "De Ocampo");
  const sql = seedSql(report, true);
  assert.match(sql, /DELETE FROM invite_seats;/);
  assert.match(sql, /INSERT INTO households/);
  assert.doesNotMatch(sql, /PRAGMA|BEGIN;|COMMIT;/);
});

test("imports numbered duplicate ids using the next free padded number", () => {
  const report = importRows([
    ["id", "household", "members", "seats", "notes"],
    ["Malaluan-01", "One", "Ana Malaluan", "2", ""],
    ["Malaluan-01", "Two", "Bea Malaluan", "2", ""],
    ["Malaluan-02", "Three", "Cia Malaluan", "2", ""],
  ]);
  assert.deepEqual(report.households.map(({ id }) => id), [
    "malaluan-01",
    "malaluan-03",
    "malaluan-02",
  ]);
  assert.match(report.warnings[0].message, /duplicate id malaluan-01; imported as malaluan-03/);
});

test("keeps non-numbered duplicate ids on the existing suffix behavior", () => {
  const report = importRows([
    ["id", "household", "members", "seats", "notes"],
    ["dup", "One", "Ana Dup", "1", ""],
    ["dup", "Two", "Bea Dup", "1", ""],
  ]);
  assert.deepEqual(report.households.map(({ id }) => id), ["dup", "dup-2"]);
});

test("keeps generated slug duplicates on the existing suffix behavior", () => {
  const report = importRows([
    ["id", "household", "members", "seats", "notes"],
    ["", "One", "Ana Dup", "1", ""],
    ["", "Two", "Ana Dup", "1", ""],
  ]);
  assert.deepEqual(report.households.map(({ id }) => id), ["ana-dup", "ana-dup-2"]);
});

test("reports a label over 80 characters before seed execution", () => {
  const label = "F".repeat(81);
  const report = importRows([["id", "household", "members", "seats", "notes"], ["long", label, "Nia Fictional", "1", ""]]);
  assert.match(report.errors.find((error) => error.row === 2)?.message ?? "", /label exceeds 80 characters/);
});

test("reports only meaningful normalization and never accepts zero seats", () => {
  const report = importRows([
    ["id", "household", "members", "seats", "notes"],
    ["clean", "", "Fiona Larra Toledo, Marco Toledo", "2", ""],
    ["changed", "", "Ana\tReyes, Bea\u00a0  Reyes", "2", ""],
    ["zero", "", "Nia Zero", "0", ""],
    ["one", "", "Solo Guest", "1", ""],
  ]);
  assert.deepEqual(report.changes.map(({ from, to }) => ({ from, to })), [
    { from: "Ana\tReyes", to: "Ana Reyes" },
    { from: "Bea\u00a0  Reyes", to: "Bea Reyes" },
  ]);
  assert.match(report.errors.find((error) => error.row === 4)?.message ?? "", /whole number from 1 to 12/);
  assert.equal(report.households.find((household) => household.id === "one")?.label, "Solo Guest");
});

test("treats seats zero as an import error instead of the two-seat default", () => {
  const report = importRows([["id", "household", "members", "seats", "notes"], ["zero", "Zero_Test", "Nia Zero", "0", ""]]);
  assert.equal(report.households.length, 0);
  assert.equal(report.errors.length, 1);
  assert.match(report.errors[0].message, /whole number from 1 to 12/);
});

test("refuses to import a household with no named member seat", () => {
  const report = importRows([["id", "household", "members", "seats", "notes"], ["open", "Open_Test", "2 guests", "2", ""]]);
  assert.equal(report.households.length, 0);
  assert.equal(report.errors[0].message, "household has no named member");
});

test("rejects a malformed header and unterminated quoted CSV", () => {
  assert.throws(() => importRows([["wrong"]]), /Invalid header/);
  assert.throws(() => parseCsv('id,household,members,seats,notes\n"oops'), /unterminated/);
});
