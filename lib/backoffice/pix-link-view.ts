export function normalizePixInitPoint(
  value: string | null | undefined,
): { initPoint: string; pixCopyPasteCode: string | undefined } {
  const initPoint = value ?? "";

  return {
    initPoint,
    pixCopyPasteCode: initPoint.startsWith("000201") ? initPoint : undefined,
  };
}
