export type GalleryTexturePhoto = {
  fine: string;
  coarse: string;
  width: number;
  height: number;
  orientation: "portrait" | "landscape";
};

type DrawStampOptions = {
  context: CanvasRenderingContext2D;
  image: HTMLImageElement;
  width: number;
  height: number;
  photoWidth: number;
  photoHeight: number;
  photoTop: number;
  radius: number;
  cover: boolean;
  hairline: number;
};

const imageCache = new Map<string, Promise<HTMLImageElement>>();

export const loadGalleryPhoto = (source: string) => {
  const cached = imageCache.get(source);
  if (cached) return cached;

  const pending = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => {
      imageCache.delete(source);
      reject(new Error(`Unable to load gallery photo: ${source}`));
    };
    image.src = source;
  });
  imageCache.set(source, pending);
  return pending;
};

const coverCrop = (
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) => {
  const imageRatio = image.naturalWidth / image.naturalHeight;
  const boxRatio = width / height;
  let sourceWidth = image.naturalWidth;
  let sourceHeight = image.naturalHeight;
  let sourceX = 0;
  let sourceY = 0;

  if (imageRatio > boxRatio) {
    sourceWidth = image.naturalHeight * boxRatio;
    sourceX = (image.naturalWidth - sourceWidth) / 2;
  } else {
    sourceHeight = image.naturalWidth / boxRatio;
    sourceY = (image.naturalHeight - sourceHeight) / 2;
  }

  return { sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height };
};

const roundedRect = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  radius: number,
) => {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(safeRadius, 0);
  context.lineTo(width - safeRadius, 0);
  context.arcTo(width, 0, width, safeRadius, safeRadius);
  context.lineTo(width, height - safeRadius);
  context.arcTo(width, height, width - safeRadius, height, safeRadius);
  context.lineTo(safeRadius, height);
  context.arcTo(0, height, 0, height - safeRadius, safeRadius);
  context.lineTo(0, safeRadius);
  context.arcTo(0, 0, safeRadius, 0, safeRadius);
  context.closePath();
};

/** Draw the common cream paper, photograph, hairline and scaled corner radius. */
const drawPolaroid = ({
  context,
  image,
  width,
  height,
  photoWidth,
  photoHeight,
  photoTop,
  radius,
  cover,
  hairline,
}: DrawStampOptions) => {
  // The window is centred: equal left and right borders.
  const photoLeft = (width - photoWidth) / 2;
  context.clearRect(0, 0, width, height);
  context.save();
  roundedRect(context, width, height, radius);
  context.clip();
  context.fillStyle = "#fbf8f1";
  context.fillRect(0, 0, width, height);
  const sheen = context.createLinearGradient(0, 0, width * 0.7, height * 0.7);
  sheen.addColorStop(0, "rgb(255 255 255 / 34%)");
  sheen.addColorStop(0.42, "rgb(255 255 255 / 0%)");
  context.fillStyle = sheen;
  context.fillRect(0, 0, width, height);

  if (cover) {
    const art = coverCrop(image, photoLeft, photoTop, photoWidth, photoHeight);
    context.drawImage(
      image,
      art.sourceX,
      art.sourceY,
      art.sourceWidth,
      art.sourceHeight,
      art.x,
      art.y,
      art.width,
      art.height,
    );
  } else {
    context.drawImage(image, photoLeft, photoTop, photoWidth, photoHeight);
  }

  context.strokeStyle = "rgb(31 47 92 / 12%)";
  context.lineWidth = hairline;
  context.strokeRect(
    photoLeft + hairline / 2,
    photoTop + hairline / 2,
    Math.max(0, photoWidth - hairline),
    Math.max(0, photoHeight - hairline),
  );
  context.restore();
};

/**
 * Transparent margin around the polaroid, as a fraction of its width, that holds its baked
 * drop shadow. Plane geometry includes this padding; projected source rects exclude it.
 */
export const polaroidPadding = (landscape: boolean) =>
  landscape ? 0.1 : 0.125;

type PopupText = {
  index: number;
  total: number;
  fontFamily: string;
};

/** Draw a popup polaroid with fixed fractional paper borders and optional handwritten metadata. */
export const drawPopupPolaroid = (
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  cssWidth: number,
  cssHeight: number,
  pixelRatio: number,
  text?: PopupText,
) => {
  canvas.width = Math.max(1, Math.round(cssWidth * pixelRatio));
  canvas.height = Math.max(1, Math.round(cssHeight * pixelRatio));
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Gallery popup requires a 2D canvas context");
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  const side = cssWidth * 0.06;
  const strip = cssWidth * 0.2;
  const photoWidth = Math.max(1, cssWidth - side * 2);
  const photoHeight = Math.max(1, cssHeight - side - strip);
  drawPolaroid({
    context,
    image,
    width: cssWidth,
    height: cssHeight,
    photoWidth,
    photoHeight,
    photoTop: side,
    radius: 2,
    cover: false,
    hairline: 1,
  });
  if (text) {
    const fontSize = cssWidth * 0.075;
    context.font = `400 ${fontSize}px ${text.fontFamily || "cursive"}`;
    context.textBaseline = "middle";
    context.fillStyle = "#1f2f5c";
    context.textAlign = "left";
    context.fillText(
      `No. ${String(text.index + 1).padStart(3, "0")}`,
      side,
      side + photoHeight + strip / 2,
    );
    context.fillStyle = "#5b6788";
    context.textAlign = "right";
    context.fillText(
      `of ${text.total}`,
      cssWidth - side,
      side + photoHeight + strip / 2,
    );
  }
};

/** Draw the polaroid paper and baked shadow used as each WebGL plane texture. */
export async function createPolaroidCanvas(
  photo: GalleryTexturePhoto,
  longEdge: number,
  far = false,
): Promise<HTMLCanvasElement> {
  const image = await loadGalleryPhoto(photo.fine || photo.coarse);
  const landscape = photo.orientation === "landscape";
  const width = landscape ? Math.round(longEdge) : Math.round(longEdge * 0.8);
  const height = landscape ? Math.round(longEdge * 0.8) : Math.round(longEdge);
  const photoWidth = width * 0.88;
  const photoTop = width * 0.06;
  const photoHeight = landscape ? width * 0.57 : width * 0.92;

  const polaroid = document.createElement("canvas");
  polaroid.width = width;
  polaroid.height = height;
  const polaroidContext = polaroid.getContext("2d");
  if (!polaroidContext)
    throw new Error("Gallery textures require a 2D canvas context");

  drawPolaroid({
    context: polaroidContext,
    image,
    width,
    height,
    photoWidth,
    photoHeight,
    photoTop,
    radius: Math.max(1, Math.round(width * 2 / 416)),
    cover: true,
    hairline: Math.max(1, Math.round(longEdge / 512)),
  });

  const pad = Math.round(width * polaroidPadding(landscape));
  const canvas = document.createElement("canvas");
  canvas.width = width + pad * 2;
  canvas.height = height + pad * 2;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Gallery textures require a 2D canvas context");

  if (far) {
    context.filter = `blur(${((longEdge / 90) * 1.2).toFixed(1)}px)`;
    context.drawImage(polaroid, pad, pad);
    return canvas;
  }

  const unit = longEdge / 290;
  const shadows: Array<[string, number, number]> = [
    ["rgb(31 47 92 / 14%)", 14 * unit, 8 * unit],
    ["rgb(31 47 92 / 18%)", 1 * unit, 1 * unit],
  ];
  for (const [color, blur, offset] of shadows) {
    context.shadowColor = color;
    context.shadowBlur = blur;
    context.shadowOffsetY = offset;
    context.drawImage(polaroid, pad, pad);
  }
  return canvas;
}
