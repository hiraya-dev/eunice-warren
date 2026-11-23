import { check, integer, index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { desc, sql } from "drizzle-orm";

const audit = {
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by"),
};

export const households = sqliteTable("households", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  displayName: text("display_name").notNull(),
  ticketCode: text("ticket_code").notNull(),
  status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
  archivedAt: text("archived_at"),
  archivedBy: text("archived_by"),
  notes: text("notes"),
  ...audit,
}, (table) => [
  uniqueIndex("households_ticket_code_idx").on(table.ticketCode),
  check("households_label_length", sql`length(label) <= 80`),
  check("households_display_name_length", sql`length(display_name) <= 40`),
  check("households_status_check", sql`status IN ('active', 'archived')`),
]);

export const inviteSeats = sqliteTable("invite_seats", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  householdId: text("household_id").notNull().references(() => households.id),
  kind: text("kind", { enum: ["member", "plus_one"] }).notNull(),
  slot: integer("slot"),
  status: text("status", { enum: ["active", "retired"] }).notNull().default("active"),
  retiredAt: text("retired_at"),
  retiredBy: text("retired_by"),
  invitedName: text("invited_name"),
  nameKey: text("name_key"),
  surnameKey: text("surname_key"),
  name: text("name"),
  namedByKind: text("named_by_kind", { enum: ["guest", "host"] }),
  namedBy: text("named_by"),
  namedAt: text("named_at"),
  namedInResponseId: integer("named_in_response_id").references(() => responses.id),
  ...audit,
}, (table) => [
  uniqueIndex("invite_seats_household_slot_idx").on(table.householdId, table.slot),
  index("invite_seats_name_key_idx").on(table.nameKey),
  index("invite_seats_surname_key_idx").on(table.surnameKey),
  index("invite_seats_kind_status_name_idx").on(table.kind, table.status, table.name),
  index("invite_seats_status_household_idx").on(table.status, table.householdId),
  check("invite_seats_slot_range", sql`slot BETWEEN 1 AND 12 OR slot IS NULL`),
  check("invite_seats_kind_check", sql`kind IN ('member', 'plus_one')`),
  check("invite_seats_status_check", sql`status IN ('active', 'retired')`),
  check("invite_seats_active_slot_check", sql`(status = 'active' AND slot IS NOT NULL) OR (status = 'retired' AND slot IS NULL)`),
  check("invite_seats_member_fields_check", sql`(kind = 'member' AND invited_name IS NOT NULL AND name_key IS NOT NULL AND surname_key IS NOT NULL AND name IS NOT NULL) OR (kind = 'plus_one' AND invited_name IS NULL AND name_key IS NULL AND surname_key IS NULL)`),
  check("invite_seats_named_by_kind_check", sql`named_by_kind IS NULL OR named_by_kind IN ('guest', 'host')`),
]);

export const responses = sqliteTable("responses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  householdId: text("household_id").notNull().references(() => households.id, { onDelete: "restrict" }),
  submittedAt: text("submitted_at").notNull(),
  respondentName: text("respondent_name").notNull(),
  attending: integer("attending", { mode: "boolean" }).notNull(),
  guestCount: integer("guest_count").notNull(),
  email: text("email").notNull(),
  note: text("note"),
  source: text("source", { enum: ["guest", "host"] }).notNull().default("guest"),
  editedBy: text("edited_by"),
}, (table) => [
  index("responses_household_submitted_idx").on(table.householdId, desc(table.submittedAt), desc(table.id)),
  index("responses_submitted_idx").on(table.submittedAt),
  check("responses_source_check", sql`source IN ('guest', 'host')`),
  check("responses_source_editor_check", sql`(source = 'guest' AND edited_by IS NULL) OR (source = 'host' AND edited_by IS NOT NULL)`),
]);

export const responseSeats = sqliteTable("response_seats", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  responseId: integer("response_id").notNull().references(() => responses.id),
  seatId: integer("seat_id").references(() => inviteSeats.id, { onDelete: "set null" }),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  attending: integer("attending", { mode: "boolean" }).notNull(),
  slipperSize: text("slipper_size"),
}, (table) => [uniqueIndex("response_seats_response_seat_idx").on(table.responseId, table.seatId)]);

export const songs = sqliteTable("songs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  nameKey: text("name_key").notNull(),
  song: text("song").notNull(),
  artist: text("artist"),
  dedication: text("dedication"),
  spotifyTrackId: text("spotify_track_id"),
  coverUrl: text("cover_url"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("songs_name_key_idx").on(table.nameKey)]);

export const seatingTables = sqliteTable("seating_tables", {
  id: integer("id").primaryKey({ autoIncrement: true }), name: text("name").notNull(),
  kind: text("kind", { enum: ["head", "round"] }).notNull(), capacity: integer("capacity").notNull(),
  sortOrder: integer("sort_order").notNull(), ...audit,
}, () => [
  check("seating_tables_kind_check", sql`kind IN ('head', 'round')`),
  check("seating_tables_capacity_check", sql`capacity > 0`),
]);

export const seatAssignments = sqliteTable("seat_assignments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tableId: integer("table_id").notNull().references(() => seatingTables.id, { onDelete: "cascade" }),
  seatId: integer("seat_id").notNull().references(() => inviteSeats.id), position: integer("position").notNull(), ...audit,
}, (table) => [uniqueIndex("seat_assignments_table_position_idx").on(table.tableId, table.position), uniqueIndex("seat_assignments_seat_idx").on(table.seatId)]);

export const reminders = sqliteTable("reminders", {
  id: integer("id").primaryKey({ autoIncrement: true }), householdId: text("household_id").notNull().references(() => households.id),
  channel: text("channel", { enum: ["email", "messenger"] }).notNull(), sentAt: text("sent_at").notNull(), sentBy: text("sent_by").notNull(), note: text("note"),
}, (table) => [
  index("reminders_household_sent_idx").on(table.householdId, table.sentAt),
  check("reminders_channel_check", sql`channel IN ('email', 'messenger')`),
]);

export type Household = typeof households.$inferSelect;
export type InviteSeat = typeof inviteSeats.$inferSelect;
