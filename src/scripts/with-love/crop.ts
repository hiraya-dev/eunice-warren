export interface CropFrame {
  width: number;
  height: number;
}

export interface CropImage {
  width: number;
  height: number;
}

export interface CropTransform {
  zoom: number;
  panX: number;
  panY: number;
}

export interface SourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const clampZoom = (zoom: number) => Math.min(4, Math.max(1, zoom));

export const coverScale = (image: CropImage, frame: CropFrame) =>
  Math.max(frame.width / image.width, frame.height / image.height);

export const clampPan = (
  transform: CropTransform,
  image: CropImage,
  frame: CropFrame,
): CropTransform => {
  const scale = coverScale(image, frame) * clampZoom(transform.zoom);
  const maxX = Math.max(0, (image.width * scale - frame.width) / 2);
  const maxY = Math.max(0, (image.height * scale - frame.height) / 2);
  return {
    zoom: clampZoom(transform.zoom),
    panX: Math.min(maxX, Math.max(-maxX, transform.panX)),
    panY: Math.min(maxY, Math.max(-maxY, transform.panY)),
  };
};

export const pinchZoom = (startZoom: number, startDistance: number, distance: number) =>
  clampZoom(startZoom * (distance / Math.max(1, startDistance)));

export const sourceRect = (
  transform: CropTransform,
  image: CropImage,
  frame: CropFrame,
): SourceRect => {
  const clamped = clampPan(transform, image, frame);
  const scale = coverScale(image, frame) * clamped.zoom;
  const width = frame.width / scale;
  const height = frame.height / scale;
  const centerX = image.width / 2 - clamped.panX / scale;
  const centerY = image.height / 2 - clamped.panY / scale;
  return {
    x: Math.min(image.width - width, Math.max(0, centerX - width / 2)),
    y: Math.min(image.height - height, Math.max(0, centerY - height / 2)),
    width,
    height,
  };
};
