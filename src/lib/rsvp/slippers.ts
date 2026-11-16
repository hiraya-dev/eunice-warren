export const SLIPPER_SIZES = [
  "W 5", "W 5.5", "W 6", "W 6.5", "W 7", "W 7.5", "W 8", "W 8.5", "W 9", "W 9.5", "W 10", "W 10.5", "W 11",
  "M 6", "M 6.5", "M 7", "M 7.5", "M 8", "M 8.5", "M 9", "M 9.5", "M 10", "M 10.5", "M 11", "M 11.5", "M 12", "M 12.5", "M 13",
] as const;

export type SlipperSize = (typeof SLIPPER_SIZES)[number];
