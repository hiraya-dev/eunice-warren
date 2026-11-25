export type RsvpFindOutcome = "found" | "suggestion" | "none" | "error" | "forbidden" | "rate_limited" | "closed";

export const rsvpFindOutcome = (result: unknown, error?: unknown): RsvpFindOutcome => {
  const code = (error as { code?: string } | undefined)?.code;
  if (code) {
    if (code === "FORBIDDEN") return "forbidden";
    if (code === "TOO_MANY_REQUESTS") return "rate_limited";
    if (code === "GONE") return "closed";
    return "error";
  }
  if (error) return "error";
  const lookup = result as { invite?: unknown; suggestion?: unknown } | null | undefined;
  if (lookup?.invite) return "found";
  if (lookup?.suggestion) return "suggestion";
  return "none";
};

export const logRsvpFindTiming = (timing: {
  turnstileMs: number;
  rateLimitMs: number;
  storeMs: number;
  totalMs: number;
  queries: number;
  outcome: RsvpFindOutcome;
}) => console.log(JSON.stringify({ event: "rsvp.find.timing", ...timing }));
