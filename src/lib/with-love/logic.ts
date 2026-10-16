export const sampleFillCount = (visibleNotes: number, sampleCount: number) =>
  visibleNotes < 3 ? Math.min(sampleCount, Math.max(0, 6 - visibleNotes)) : 0;
