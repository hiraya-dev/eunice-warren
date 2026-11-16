export type GalleryTexturePhoto = {
  fine: string;
  coarse: string;
  width: number;
  height: number;
  orientation: "portrait" | "landscape";
};

const loadPhoto = (source: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error(`Unable to load gallery photo: ${source}`));
    image.src = source;
  });

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

/**
 * Perforations match Stamp.astro: bites centred on the edge (half circles), hole radius 2.6% of
 * the short side, 10 holes across the 4:5 short side and 12 down the long side (landscape swaps).
 * Corners stay square because the hole centres sit mid-tile.
 */
const punchPerforations = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  landscape: boolean,
) => {
  const acrossHoles = landscape ? 12 : 10;
  const downHoles = landscape ? 10 : 12;
  const radius = Math.min(width, height) * 0.026;

  context.save();
  context.globalCompositeOperation = "destination-out";
  context.fillStyle = "#000";
  context.beginPath();
  for (let index = 0; index < acrossHoles; index += 1) {
    const x = ((index + 0.5) / acrossHoles) * width;
    for (const y of [0, height]) {
      context.moveTo(x + radius, y);
      context.arc(x, y, radius, 0, Math.PI * 2);
    }
  }
  for (let index = 0; index < downHoles; index += 1) {
    const y = ((index + 0.5) / downHoles) * height;
    for (const x of [0, width]) {
      context.moveTo(x + radius, y);
      context.arc(x, y, radius, 0, Math.PI * 2);
    }
  }
  context.fill();
  context.restore();
};

/**
 * Transparent margin around the stamp, as a fraction of the stamp's width, that holds the baked
 * drop shadow. Sprites are scaled by this so the stamp itself keeps its design size.
 */
export const stampPadding = (landscape: boolean) => (landscape ? 0.1 : 0.125);

/**
 * Draws the same perforated-paper treatment used by Stamp.astro into a texture, padded for its
 * soft shadow (near/mid stamps) or blurred and shadowless (far stamps).
 */
export async function createStampCanvas(
  photo: GalleryTexturePhoto,
  longEdge: number,
  far = false,
): Promise<HTMLCanvasElement> {
  const image = await loadPhoto(photo.fine || photo.coarse);
  const landscape = photo.orientation === "landscape";
  const width = landscape ? Math.round(longEdge) : Math.round(longEdge * 0.8);
  const height = landscape ? Math.round(longEdge * 0.8) : Math.round(longEdge);

  const stamp = document.createElement("canvas");
  stamp.width = width;
  stamp.height = height;
  const stampContext = stamp.getContext("2d");
  if (!stampContext)
    throw new Error("Gallery textures require a 2D canvas context");

  stampContext.fillStyle = "#fbf8f1";
  stampContext.fillRect(0, 0, width, height);
  const sheen = stampContext.createLinearGradient(0, 0, width * 0.7, height * 0.7);
  sheen.addColorStop(0, "rgb(255 255 255 / 34%)");
  sheen.addColorStop(0.42, "rgb(255 255 255 / 0%)");
  stampContext.fillStyle = sheen;
  stampContext.fillRect(0, 0, width, height);

  const padding = Math.round(width * (landscape ? 0.056 : 0.07));
  const art = coverCrop(
    image,
    padding,
    padding,
    width - padding * 2,
    height - padding * 2,
  );
  stampContext.drawImage(
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
  const hairline = Math.max(1, Math.round(longEdge / 512));
  stampContext.strokeStyle = "rgb(31 47 92 / 12%)";
  stampContext.lineWidth = hairline;
  stampContext.strokeRect(
    padding + hairline / 2,
    padding + hairline / 2,
    width - padding * 2 - hairline,
    height - padding * 2 - hairline,
  );
  punchPerforations(stampContext, width, height, landscape);

  const pad = Math.round(width * stampPadding(landscape));
  const canvas = document.createElement("canvas");
  canvas.width = width + pad * 2;
  canvas.height = height + pad * 2;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Gallery textures require a 2D canvas context");
  context.clearRect(0, 0, canvas.width, canvas.height);

  if (far) {
    // Paper: far stamps are shadowless with a slight blur.
    context.filter = `blur(${((longEdge / 90) * 1.2).toFixed(1)}px)`;
    context.drawImage(stamp, pad, pad);
    return canvas;
  }

  // Paper: drop-shadow(0 1px 1px dark-900 @18%) drop-shadow(0 8px 14px dark-900 @14%),
  // scaled from a ~290px long edge to the texture size. drawImage shadows follow the bites.
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
