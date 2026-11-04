import sharp from "sharp";
const invalid = (message) => Object.assign(new Error(message), { status: 422 });
export async function processSignature(buffer) {
  if (
    !Buffer.isBuffer(buffer) ||
    !buffer.length ||
    buffer.length > 4 * 1024 * 1024
  )
    throw invalid("Choose a signature image up to 4 MB.");
  let data, info;
  try {
    const input = sharp(buffer, {
      limitInputPixels: 8000000,
      failOn: "error",
      animated: false,
    });
    const metadata = await input.metadata();
    if (
      !["png", "jpeg", "webp"].includes(metadata.format) ||
      (metadata.pages || 1) > 1
    )
      throw invalid("Use a single PNG, JPEG or WebP image.");
    ({ data, info } = await input
      .rotate()
      .resize({
        width: 1200,
        height: 600,
        fit: "inside",
        withoutEnlargement: true,
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }));
  } catch (error) {
    if (error.status) throw error;
    throw invalid(
      "This image could not be decoded. Use a PNG, JPEG or WebP signature on plain light paper.",
    );
  }
  const { width, height } = info,
    edge = [];
  for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 80)))
    for (const x of [0, width - 1]) {
      const i = (y * width + x) * 4;
      if (data[i + 3] > 240) edge.push([data[i], data[i + 1], data[i + 2]]);
    }
  for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 80)))
    for (const y of [0, height - 1]) {
      const i = (y * width + x) * 4;
      if (data[i + 3] > 240) edge.push([data[i], data[i + 1], data[i + 2]]);
    }
  const median = (channel) =>
    edge.map((p) => p[channel]).sort((a, b) => a - b)[
      Math.floor(edge.length / 2)
    ] ?? 255;
  const background = [median(0), median(1), median(2)],
    bgLuma =
      background[0] * 0.2126 + background[1] * 0.7152 + background[2] * 0.0722;
  if (edge.length && bgLuma < 150)
    throw invalid(
      "Use dark ink on a plain light background, or upload an already transparent PNG.",
    );
  let minX = width,
    minY = height,
    maxX = -1,
    maxY = -1,
    inkPixels = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4,
        alpha = data[i + 3];
      if (!alpha) continue;
      const luma =
        data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
      const difference =
        Math.sqrt(
          background.reduce((n, v, c) => n + (data[i + c] - v) ** 2, 0),
        ) / 441.7;
      const ink = Math.max(1 - luma / Math.max(bgLuma, 1), difference * 0.85);
      data[i + 3] = Math.round(
        alpha * Math.max(0, Math.min(1, (ink - 0.11) / 0.19)),
      );
      if (data[i + 3] > 32) {
        inkPixels++;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  if (inkPixels < 12 || maxX - minX < 4 || maxY - minY < 2)
    throw invalid(
      "No clear signature strokes were found. Upload a clearer dark-ink signature.",
    );
  const padding = 8,
    left = Math.max(0, minX - padding),
    top = Math.max(0, minY - padding);
  const png = await sharp(data, { raw: { width, height, channels: 4 } })
    .extract({
      left,
      top,
      width: Math.min(width - 1, maxX + padding) - left + 1,
      height: Math.min(height - 1, maxY + padding) - top + 1,
    })
    .resize({
      width: 600,
      height: 240,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();
  return "data:image/png;base64," + png.toString("base64");
}
export async function validatedSignature(value) {
  if (
    typeof value !== "string" ||
    value.length > 1200000 ||
    !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  )
    throw invalid("Upload and process a valid signature image before saving.");
  return processSignature(
    Buffer.from(value.slice(value.indexOf(",") + 1), "base64"),
  );
}
