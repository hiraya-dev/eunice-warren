const isHeicFile = (file: File) =>
  /image\/(heic|heif)/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);

export const processPhoto = async (file: File): Promise<File> => {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    let quality = 0.82;
    let blob: Blob;
    do {
      blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("encode"))), "image/jpeg", quality),
      );
      quality -= 0.08;
    } while (blob.size > 400_000 && quality >= 0.5);
    return new File([blob], "polaroid.jpg", { type: "image/jpeg" });
  } catch (error) {
    if (!isHeicFile(file)) throw error;
    const { heicTo } = await import("heic-to");
    const converted = await heicTo({ blob: file, type: "image/jpeg", quality: 0.82 });
    return processPhoto(new File([converted], "polaroid.jpg", { type: "image/jpeg" }));
  }
};

export { isHeicFile };
