export interface CompressedImageResult {
  blob: Blob;
  dataUrl: string;
  originalSize: number;
  compressedSize: number;
  format: "image/webp" | "image/jpeg";
}

/**
 * Compresses an image client-side using HTML5 Canvas.
 * Max dimension: 1280px, quality: 0.75, max size: 500KB.
 */
export async function compressImage(file: File): Promise<CompressedImageResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read image file"));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("Failed to parse image"));
      img.onload = () => {
        const MAX_DIM = 1280;
        let width = img.width;
        let height = img.height;

        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) {
            height = Math.round((height * MAX_DIM) / width);
            width = MAX_DIM;
          } else {
            width = Math.round((width * MAX_DIM) / height);
            height = MAX_DIM;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Failed to create canvas context"));

        ctx.drawImage(img, 0, 0, width, height);

        const formats: Array<"image/webp" | "image/jpeg"> = ["image/webp", "image/jpeg"];

        const tryExport = (formatIndex: number) => {
          const selectedFormat = formats[formatIndex];
          canvas.toBlob(
            (blob) => {
              if (!blob) {
                if (formatIndex < formats.length - 1) {
                  return tryExport(formatIndex + 1);
                }
                return reject(new Error("Failed to compress image to Blob"));
              }

              const MAX_BYTES = 500 * 1024; // 500KB limit
              if (blob.size > MAX_BYTES) {
                return reject(
                  new Error(
                    `ภาพมีขนาดเกิน 500KB (${Math.round(blob.size / 1024)}KB) กรุณาถ่ายหรือเลือกภาพใหม่`
                  )
                );
              }

              const dataUrl = canvas.toDataURL(selectedFormat, 0.75);

              resolve({
                blob,
                dataUrl,
                originalSize: file.size,
                compressedSize: blob.size,
                format: selectedFormat,
              });
            },
            selectedFormat,
            0.75
          );
        };

        tryExport(0);
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}
