import { findNearGuestName } from "./logic.ts";
import { normalizeGuestName } from "./store.ts";
import type { Invite, InviteLookup } from "./store.ts";

/**
 * Shared exact/near lookup rules for the fake and D1 stores. An exact name is
 * usable only when it identifies one household and one seat; this prevents a
 * duplicate name from accidentally selecting the first invite returned by SQL.
 */
export function lookupInvite(name: string, invites: Invite[]): InviteLookup {
  const wanted = normalizeGuestName(name);
  const nameCounts = new Map<string, number>();
  for (const invite of invites) {
    for (const member of invite.members) {
      const normalized = normalizeGuestName(member);
      nameCounts.set(normalized, (nameCounts.get(normalized) ?? 0) + 1);
    }
  }
  const duplicateNames = [...nameCounts]
    .filter(([, count]) => count > 1)
    .map(([normalized]) => normalized);
  const exact = invites.flatMap((invite) =>
    invite.seatList
      ?.filter((seat) => seat.kind === "member" && seat.invitedName && normalizeGuestName(seat.invitedName) === wanted)
      .map((seat) => ({ invite, seat })) ?? [],
  );
  const householdIds = [...new Set(exact.map(({ invite }) => invite.id))];
  if (exact.length === 1 && householdIds.length === 1) {
    return {
      invite: exact[0].invite,
      householdId: exact[0].invite.id ?? exact[0].invite.ticketCode,
      matchedName: exact[0].seat.invitedName!,
      previous: null,
    };
  }
  const suggestion = findNearGuestName(name, invites, [], duplicateNames);
  return suggestion ? { invite: null, suggestion } : null;
}

export function inviteCandidates(name: string, invites: Invite[]): Invite[] {
  const wanted = normalizeGuestName(name);
  const surname = wanted.split(" ").at(-1) ?? wanted;
  return invites.filter((invite) =>
    invite.members.some((member) => normalizeGuestName(member).split(" ").at(-1) === surname),
  );
}
