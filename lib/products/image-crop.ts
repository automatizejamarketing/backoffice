export type CropOffset = {
  x: number;
  y: number;
};

export type ImageSize = {
  width: number;
  height: number;
};

export function getCoverScale(image: ImageSize, frameSize: number) {
  return Math.max(frameSize / image.width, frameSize / image.height);
}

export function clampCropOffset(
  offset: CropOffset,
  image: ImageSize,
  frameSize: number,
  zoom: number,
): CropOffset {
  const scale = getCoverScale(image, frameSize) * zoom;
  const maxX = Math.max(0, (image.width * scale - frameSize) / 2);
  const maxY = Math.max(0, (image.height * scale - frameSize) / 2);

  return {
    x: maxX === 0 ? 0 : Math.min(maxX, Math.max(-maxX, offset.x)),
    y: maxY === 0 ? 0 : Math.min(maxY, Math.max(-maxY, offset.y)),
  };
}

export function getCropSourceRect(
  image: ImageSize,
  frameSize: number,
  zoom: number,
  offset: CropOffset,
) {
  const scale = getCoverScale(image, frameSize) * zoom;
  const cropSize = frameSize / scale;

  return {
    x: (image.width - cropSize) / 2 - offset.x / scale,
    y: (image.height - cropSize) / 2 - offset.y / scale,
    size: cropSize,
  };
}
