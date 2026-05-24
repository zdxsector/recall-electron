export type NativeAuthOverlayPayload = {
  noteId: string;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  viewportHeight: number;
  devicePixelRatio: number;
};

const isFiniteNumber = (value: number) => Number.isFinite(value);

export const domRectToNativeAuthPayload = (
  noteId: string,
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  viewportHeight: number,
  devicePixelRatio: number
): NativeAuthOverlayPayload | null => {
  if (!noteId || typeof noteId !== 'string') {
    return null;
  }

  if (
    !isFiniteNumber(rect.left) ||
    !isFiniteNumber(rect.top) ||
    !isFiniteNumber(rect.width) ||
    !isFiniteNumber(rect.height) ||
    !isFiniteNumber(viewportHeight) ||
    !isFiniteNumber(devicePixelRatio) ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    viewportHeight <= 0 ||
    devicePixelRatio <= 0
  ) {
    return null;
  }

  return {
    noteId,
    rect: {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    },
    viewportHeight,
    devicePixelRatio,
  };
};
