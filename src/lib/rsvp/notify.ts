import { RSVP_NOTIFY_FROM, SITE_URL } from "../../site-consts.ts";
import type { RsvpSubmission } from "./store.ts";

export interface SendEmailAddress {
  email: string;
  name?: string;
}

export interface SendEmailMessage {
  from: string | SendEmailAddress;
  to: Array<string | SendEmailAddress>;
  replyTo?: string | SendEmailAddress;
  subject: string;
  text: string;
  html: string;
}

export interface SendEmailBinding {
  send(message: SendEmailMessage): Promise<void>;
}

export interface RsvpNotificationData {
  householdId: string;
  householdName: string;
  respondentName: string;
  isUpdate: boolean;
  submission: RsvpSubmission;
}

export interface RsvpNotificationEnvironment {
  RSVP_STORE?: unknown;
  NOTIFY_TO?: unknown;
  RSVP_EMAIL?: unknown;
}

export interface RsvpNotificationLogger {
  error(...args: unknown[]): void;
}

export type WaitUntil = (promise: Promise<unknown>) => void;

const controls = /[\u0000-\u001f\u007f-\u009f]/g;

export const stripHeaderControls = (value: string) =>
  value.replace(controls, "").trim();

export const parseNotifyTo = (value: unknown): string[] =>
  typeof value === "string"
    ? value
        .split(",")
        .map((address) => stripHeaderControls(address))
        .filter(Boolean)
    : [];

const asBinding = (value: unknown): SendEmailBinding | undefined =>
  typeof value === "object" &&
  value !== null &&
  "send" in value &&
  typeof value.send === "function"
    ? (value as SendEmailBinding)
    : undefined;

export const getRsvpNotificationConfig = (
  environment: RsvpNotificationEnvironment,
) => {
  const to = parseNotifyTo(environment.NOTIFY_TO);
  const binding = asBinding(environment.RSVP_EMAIL);
  if (environment.RSVP_STORE === "fake" || !to.length || !binding) return null;
  return { binding, to };
};

export const rsvpNotificationEnabled = (
  environment: RsvpNotificationEnvironment,
) => getRsvpNotificationConfig(environment) !== null;

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );

const seatName = (seat: RsvpSubmission["seats"][number]) =>
  seat.name || seat.shownName || "Unnamed guest";

const seatStatus = (attending: boolean) =>
  attending ? "Attending" : "Declined";

export const buildRsvpNotification = (
  data: RsvpNotificationData,
): SendEmailMessage => {
  const subject = `${data.isUpdate ? "Updated" : "New"} RSVP: ${stripHeaderControls(data.householdName)}`;
  const dashboardUrl = `${SITE_URL}/admin/rsvps?household=${encodeURIComponent(data.householdId)}`;
  const seats = data.submission.seats.map((seat) => {
    const size = seat.slipperSize ? ` — slipper size: ${seat.slipperSize}` : "";
    return `- ${seatName(seat)} — ${seatStatus(seat.attending)}${size}`;
  });
  const note = data.submission.note ? `\nNote: ${data.submission.note}` : "";
  const text = [
    `Household: ${data.householdName}`,
    `Overall: ${seatStatus(data.submission.attending)}`,
    "Seats:",
    ...seats,
    note.trimStart(),
    `Guest email: ${data.submission.email}`,
    `Respondent: ${data.respondentName}`,
    `Dashboard: ${dashboardUrl}`,
  ]
    .filter(Boolean)
    .join("\n");
  const htmlSeats = data.submission.seats
    .map((seat) => {
      const size = seat.slipperSize
        ? ` &mdash; slipper size: ${escapeHtml(seat.slipperSize)}`
        : "";
      return `<li><strong>${escapeHtml(seatName(seat))}</strong> &mdash; ${seatStatus(seat.attending)}${size}</li>`;
    })
    .join("");
  const htmlNote = data.submission.note
    ? `<p><strong>Note:</strong> ${escapeHtml(data.submission.note)}</p>`
    : "";
  const html = [
    `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#2f2925">`,
    `<p><strong>Household:</strong> ${escapeHtml(data.householdName)}</p>`,
    `<p><strong>Overall:</strong> ${seatStatus(data.submission.attending)}</p>`,
    `<p><strong>Seats:</strong></p><ul>${htmlSeats}</ul>`,
    htmlNote,
    `<p><strong>Guest email:</strong> ${escapeHtml(data.submission.email)}</p>`,
    `<p><strong>Respondent:</strong> ${escapeHtml(data.respondentName)}</p>`,
    `<p><a href="${escapeHtml(dashboardUrl)}" style="color:#6d4b38">Open this RSVP in the dashboard</a></p>`,
    "</div>",
  ]
    .filter(Boolean)
    .join("");
  return {
    from: { email: RSVP_NOTIFY_FROM, name: "Warren & Eunice RSVP" },
    to: [],
    replyTo: stripHeaderControls(data.submission.email),
    subject,
    text,
    html,
  };
};

const safeErrorMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return stripHeaderControls(message).replace(
    /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,
    "[address]",
  );
};

export async function sendRsvpNotification(
  data: RsvpNotificationData,
  environment: RsvpNotificationEnvironment,
  logger: RsvpNotificationLogger = console,
) {
  const config = getRsvpNotificationConfig(environment);
  if (!config) return false;
  const message = buildRsvpNotification(data);
  message.to = config.to;
  try {
    await config.binding.send(message);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "UNKNOWN";
    logger.error("RSVP notification failed", {
      householdId: data.householdId,
      code,
      message: safeErrorMessage(error),
    });
  }
  return true;
}

export function scheduleRsvpNotification(
  data: RsvpNotificationData,
  environment: RsvpNotificationEnvironment,
  waitUntil?: WaitUntil,
  logger: RsvpNotificationLogger = console,
) {
  try {
    const task = sendRsvpNotification(data, environment, logger);
    if (waitUntil) waitUntil(task);
    else void task;
  } catch (error) {
    logger.error("RSVP notification scheduling failed", {
      householdId: data.householdId,
      code: "SCHEDULING_ERROR",
      message: safeErrorMessage(error),
    });
  }
}
