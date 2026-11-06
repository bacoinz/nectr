// Square crop before an image is uploaded (covers, artist and profile photos).
// `cropImage` opens the cropper (components/CropDialog.svelte, mounted once by
// the owner's app) and resolves with a small JPEG, or null when cancelled.

export interface CropJob {
  url: string;
  /** Longest side of the result, in pixels (it is never scaled up). */
  size: number;
  /** A round preview (artist and profile photos are shown in circles). */
  round: boolean;
  title: string;
  done: (blob: Blob | null) => void;
}

export const cropper = $state({ job: null as CropJob | null });

export function cropImage(file: File, size: number, opts: { round?: boolean; title?: string } = {}): Promise<Blob | null> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return Promise.reject(new Error("Usa uma imagem JPG, PNG ou WebP."));
  cropper.job?.done(null);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    cropper.job = {
      url,
      size,
      round: !!opts.round,
      title: opts.title ?? "Enquadrar a imagem",
      done: (blob) => {
        URL.revokeObjectURL(url);
        cropper.job = null;
        resolve(blob);
      },
    };
  });
}
