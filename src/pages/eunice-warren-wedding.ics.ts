import type { APIRoute } from "astro";
import { calendarIcs } from "@/lib/rsvp/event";

export const prerender = true;

export const GET: APIRoute = () =>
  new Response(calendarIcs(), {
    headers: { "Content-Type": "text/calendar; charset=utf-8" },
  });
