export type GalleryTexturePhoto = {
  fine: string;
  coarse: string;
  width: number;
  height: number;
  orientation: "portrait" | "landscape";
};

type Perforation =
  | { mode: "proportional"; landscape: boolean }
  | { mode: "fixed"; radius: number; step: number };

type DrawStampOptions = {
  context: CanvasRenderingContext2D;
  image: HTMLImageElement;
  width: number;
  height: number;
  margin: number;
  perforation: Perforation;
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

const edgePositions = (length: number, step: number) => {
  const count = Math.max(1, Math.round(length / step));
  const positions: number[] = [];
  for (let index = 0; index < count; index += 1)
    positions.push(((index + 0.5) / count) * length);
  return positions;
};

/** Draw the perforation bites shared by the WebGL textures and popup canvas. */
const punchPerforations = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  perforation: Perforation,
) => {
  const radius =
    perforation.mode === "fixed"
      ? perforation.radius
      : Math.min(width, height) * 0.026;
  const across =
    perforation.mode === "fixed"
      ? edgePositions(width, perforation.step)
      : edgePositions(width, width / (perforation.landscape ? 12 : 10));
  const down =
    perforation.mode === "fixed"
      ? edgePositions(height, perforation.step)
      : edgePositions(height, height / (perforation.landscape ? 10 : 12));

  context.save();
  context.globalCompositeOperation = "destination-out";
  context.fillStyle = "#000";
  context.beginPath();
  for (const x of across) {
    context.moveTo(x + radius, 0);
    context.arc(x, 0, radius, 0, Math.PI * 2);
    context.moveTo(x + radius, height);
    context.arc(x, height, radius, 0, Math.PI * 2);
  }
  for (const y of down) {
    context.moveTo(radius, y);
    context.arc(0, y, radius, 0, Math.PI * 2);
    context.moveTo(width + radius, y);
    context.arc(width, y, radius, 0, Math.PI * 2);
  }
  context.fill();
  context.restore();
};

/** Draw the common cream paper, photograph, hairline and perforated edge. */
const drawStamp = ({
  context,
  image,
  width,
  height,
  margin,
  perforation,
  cover,
  hairline,
}: DrawStampOptions) => {
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#fbf8f1";
  context.fillRect(0, 0, width, height);
  const sheen = context.createLinearGradient(0, 0, width * 0.7, height * 0.7);
  sheen.addColorStop(0, "rgb(255 255 255 / 34%)");
  sheen.addColorStop(0.42, "rgb(255 255 255 / 0%)");
  context.fillStyle = sheen;
  context.fillRect(0, 0, width, height);

  const artWidth = Math.max(1, width - margin * 2);
  const artHeight = Math.max(1, height - margin * 2);
  if (cover) {
    const art = coverCrop(image, margin, margin, artWidth, artHeight);
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
    context.drawImage(image, margin, margin, artWidth, artHeight);
  }

  context.strokeStyle = "rgb(31 47 92 / 12%)";
  context.lineWidth = hairline;
  context.strokeRect(
    margin + hairline / 2,
    margin + hairline / 2,
    Math.max(0, artWidth - hairline),
    Math.max(0, artHeight - hairline),
  );
  punchPerforations(context, width, height, perforation);
};

/**
 * Transparent margin around the stamp, as a fraction of the stamp's width, that holds its baked
 * drop shadow. Plane geometry includes this padding; projected source rects exclude it.
 */
export const stampPadding = (landscape: boolean) => (landscape ? 0.1 : 0.125);

/** Draw a popup stamp using fixed CSS-pixel paper and perforation dimensions. */
export const drawPopupStamp = (
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  cssWidth: number,
  cssHeight: number,
  pixelRatio: number,
) => {
  canvas.width = Math.max(1, Math.round(cssWidth * pixelRatio));
  canvas.height = Math.max(1, Math.round(cssHeight * pixelRatio));
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Gallery popup requires a 2D canvas context");
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  drawStamp({
    context,
    image,
    width: cssWidth,
    height: cssHeight,
    margin: 14,
    perforation: { mode: "fixed", radius: 7, step: 22 },
    cover: false,
    hairline: 1,
  });
};

/** Draw the perforated paper and baked shadow used as each WebGL plane texture. */
export async function createStampCanvas(
  photo: GalleryTexturePhoto,
  longEdge: number,
  far = false,
): Promise<HTMLCanvasElement> {
  const image = await loadGalleryPhoto(photo.fine || photo.coarse);
  const landscape = photo.orientation === "landscape";
  const width = landscape ? Math.round(longEdge) : Math.round(longEdge * 0.8);
  const height = landscape ? Math.round(longEdge * 0.8) : Math.round(longEdge);

  const stamp = document.createElement("canvas");
  stamp.width = width;
  stamp.height = height;
  const stampContext = stamp.getContext("2d");
  if (!stampContext)
    throw new Error("Gallery textures require a 2D canvas context");

  drawStamp({
    context: stampContext,
    image,
    width,
    height,
    margin: Math.round(width * (landscape ? 0.056 : 0.07)),
    perforation: { mode: "proportional", landscape },
    cover: true,
    hairline: Math.max(1, Math.round(longEdge / 512)),
  });

  const pad = Math.round(width * stampPadding(landscape));
  const canvas = document.createElement("canvas");
  canvas.width = width + pad * 2;
  canvas.height = height + pad * 2;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Gallery textures require a 2D canvas context");

  if (far) {
    context.filter = `blur(${((longEdge / 90) * 1.2).toFixed(1)}px)`;
    context.drawImage(stamp, pad, pad);
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
    context.drawImage(stamp, pad, pad);
  }
  return canvas;
}
