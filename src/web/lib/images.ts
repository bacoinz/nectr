/**
 * Resizes an image in the browser before upload (artwork 1200 px, photos 512 px),
 * so the Worker only ever stores small JPEGs. No Cloudflare Images (paid).
 */
export async function resizeImage(file: File, max: number): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Usa uma imagem JPG, PNG ou WebP.");
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("Não foi possível ler esta imagem.");
  });
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.88));
  if (!blob) throw new Error("Não foi possível preparar a imagem.");
  return blob;
}
