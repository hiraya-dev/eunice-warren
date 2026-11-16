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

const punchPerforations = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  landscape: boolean,
) => {
  const longSideHoles = landscape ? 12 : 10;
  const shortSideHoles = landscape ? 10 : 12;
  const radius = Math.min(width, height) * 0.026;

  context.save();
  context.globalCompositeOperation = "destination-out";
  for (let index = 0; index < longSideHoles; index += 1) {
    const position = (index + 0.5) / longSideHoles;
    for (const y of [radius, height - radius]) {
      context.beginPath();
      context.arc(position * width, y, radius, 0, Math.PI * 2);
      context.fill();
    }
  }
  for (let index = 0; index < shortSideHoles; index += 1) {
    const position = (index + 0.5) / shortSideHoles;
    for (const x of [radius, width - radius]) {
      context.beginPath();
      context.arc(x, position * height, radius, 0, Math.PI * 2);
      context.fill();
    }
  }
  context.restore();
};

/** Draws the same perforated-paper treatment used by Stamp.astro into a texture. */
export async function createStampCanvas(
  photo: GalleryTexturePhoto,
  longEdge: number,
): Promise<HTMLCanvasElement> {
  const image = await loadPhoto(photo.fine || photo.coarse);
  const landscape = photo.orientation === "landscape";
  const aspect = photo.width / photo.height;
  const width = landscape
    ? Math.round(longEdge)
    : Math.max(1, Math.round(longEdge * aspect));
  const height = landscape
    ? Math.max(1, Math.round(longEdge / aspect))
    : Math.round(longEdge);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Gallery textures require a 2D canvas context");

  context.clearRect(0, 0, width, height);
  context.save();
  context.shadowColor = "rgb(28 25 22 / 18%)";
  context.shadowBlur = Math.max(2, Math.round(longEdge * 0.027));
  context.shadowOffsetY = Math.max(1, Math.round(longEdge * 0.012));
  context.fillStyle = "#fbf8f1";
  context.fillRect(0, 0, width, height);
  context.restore();
  context.fillStyle = "#fbf8f1";
  context.fillRect(0, 0, width, height);

  const padding = Math.round(
    Math.min(width, height) * (landscape ? 0.056 : 0.07),
  );
  const art = coverCrop(
    image,
    padding,
    padding,
    width - padding * 2,
    height - padding * 2,
  );
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
  context.strokeStyle = "rgb(28 25 22 / 12%)";
  context.lineWidth = Math.max(1, Math.round(longEdge / 512));
  context.strokeRect(
    padding,
    padding,
    width - padding * 2,
    height - padding * 2,
  );
  punchPerforations(context, width, height, landscape);
  return canvas;
}
