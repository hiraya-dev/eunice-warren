export interface Invite {
  id: string;
  householdName: string;
  members: string[];
  seats: number;
}

export interface RsvpSubmission {
  inviteId: string;
  name: string;
  attending: boolean;
  guests: number;
  email: string;
  companionName?: string;
  note?: string;
}

export interface RsvpStore {
  findInvite(
    name: string,
  ): Promise<{ invite: Invite; matchedName: string } | null>;
  submit(submission: RsvpSubmission): Promise<void>;
}

export const normalizeGuestName = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();

const fixtures: Invite[] = [
  {
    id: "santos",
    householdName: "The Santos Family",
    members: ["Liza Santos"],
    seats: 2,
  },
  { id: "reyes", householdName: "Ana Reyes", members: ["Ana Reyes"], seats: 1 },
  {
    id: "cruz",
    householdName: "The Cruz Family",
    members: ["Mateo Cruz", "Sofía Cruz"],
    seats: 4,
  },
];

const pause = (duration = 180) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, duration));
const failureFixtureName = "Error Test";

export const createFakeRsvpStore = (): RsvpStore => ({
  async findInvite(name) {
    await pause();
    if (normalizeGuestName(name) === normalizeGuestName(failureFixtureName)) {
      throw new Error("fictional RSVP lookup failure");
    }
    const wanted = normalizeGuestName(name);
    for (const invite of fixtures) {
      const matchedName = invite.members.find(
        (member) => normalizeGuestName(member) === wanted,
      );
      if (matchedName) return { invite, matchedName };
    }
    return null;
  },
  async submit() {
    await pause();
  },
});
