export type CropOffset = {
  x: number;
  y: number;
};

export type ImageSize = {
  width: number;
  height: number;
};

export type FrameSize = {
  width: number;
  height: number;
};

export type CropSourceRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function normalizeFrame(frame: number | FrameSize): FrameSize {
  if (typeof frame === "number") {
    return { width: frame, height: frame };
  }

  return frame;
}

export function getCoverScale(image: ImageSize, frame: number | FrameSize) {
  const normalized = normalizeFrame(frame);
  return Math.max(
    normalized.width / image.width,
    normalized.height / image.height,
  );
}

export function clampCropOffset(
  offset: CropOffset,
  image: ImageSize,
  frame: number | FrameSize,
  zoom: number,
): CropOffset {
  const normalized = normalizeFrame(frame);
  const scale = getCoverScale(image, normalized) * zoom;
  const maxX = Math.max(0, (image.width * scale - normalized.width) / 2);
  const maxY = Math.max(0, (image.height * scale - normalized.height) / 2);

  return {
    x: maxX === 0 ? 0 : Math.min(maxX, Math.max(-maxX, offset.x)),
    y: maxY === 0 ? 0 : Math.min(maxY, Math.max(-maxY, offset.y)),
  };
}

export function getCropSourceRect(
  image: ImageSize,
  frame: number | FrameSize,
  zoom: number,
  offset: CropOffset,
): CropSourceRect {
  const normalized = normalizeFrame(frame);
  const scale = getCoverScale(image, normalized) * zoom;
  const cropWidth = normalized.width / scale;
  const cropHeight = normalized.height / scale;

  return {
    x: (image.width - cropWidth) / 2 - offset.x / scale,
    y: (image.height - cropHeight) / 2 - offset.y / scale,
    width: cropWidth,
    height: cropHeight,
  };
}
