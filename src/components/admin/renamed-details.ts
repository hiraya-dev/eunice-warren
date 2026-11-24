import { renameNote } from "../../lib/admin/presentation.ts";

interface RenamedSeat {
  name: string;
  invitedName: string | null;
  namedBy?: string | null;
  namedAt?: string | null;
}

export function renamedDetails(seat: RenamedSeat, hosts: Record<string, string>) {
  if (!seat.namedBy || !seat.namedAt) return "renamed";
  const invitedName = seat.invitedName ?? seat.name;
  const first = seat.name.trim().split(/\s+/)[0] ?? seat.name;
  const prefix = `${first} invited as ${invitedName}, `;
  return renameNote(seat.name, invitedName, seat.namedBy, seat.namedAt, hosts)
    .slice(prefix.length);
}
