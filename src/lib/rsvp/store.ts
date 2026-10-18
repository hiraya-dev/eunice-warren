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
  seats: RsvpSeat[];
  email: string;
  note?: string;
}

export interface RsvpSeat {
  original: string | null;
  name: string;
  attending: boolean;
}

export interface PreviousRsvp {
  attending: boolean;
  seats: RsvpSeat[];
}

export interface RsvpStore {
  findInvite(
    name: string,
  ): Promise<{
    invite: Invite;
    matchedName: string;
    previous: PreviousRsvp | null;
  } | null>;
  submit(submission: RsvpSubmission): Promise<void>;
}

export const normalizeGuestName = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();

export const fakeFixtures: Invite[] = [
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
    members: ["Mateo Cruz", "Sofía Cruz", "Remedios Cruz"],
    seats: 4,
  },
  {
    id: "garcia",
    householdName: "The Garcia Family",
    members: ["Paolo Garcia", "Bea Garcia"],
    seats: 3,
  },
];

const pause = (duration = 20) =>
  new Promise<void>((resolve) => setTimeout(resolve, duration));

export const createFakeRsvpStore = (): RsvpStore => {
  // Only the dedicated returning-guest fixture persists state, keeping parallel e2e fixtures isolated.
  const previous = new Map<string, PreviousRsvp>();
  return {
  async findInvite(name) {
    await pause();
    if (normalizeGuestName(name) === "error test")
      throw new Error("fictional RSVP lookup failure");
    const wanted = normalizeGuestName(name);
    for (const invite of fakeFixtures) {
      const matchedName = invite.members.find(
        (member) => normalizeGuestName(member) === wanted,
      );
      if (matchedName)
        return { invite, matchedName, previous: previous.get(invite.id) ?? null };
    }
    return null;
  },
  async submit(submission) {
    await pause();
    if (submission.inviteId === "garcia")
      previous.set(submission.inviteId, {
        attending: submission.attending,
        seats: submission.seats.map((seat) => ({ ...seat })),
      });
  },
  };
};
