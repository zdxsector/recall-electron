export type NativeAuthOverlayRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type NativeAuthOverlayPayload = {
  noteId: string;
  rect: NativeAuthOverlayRect;
  passwordRect?: NativeAuthOverlayRect;
  viewportHeight: number;
  devicePixelRatio: number;
};

const isFiniteNumber = (value: number) => Number.isFinite(value);

export const domRectToNativeAuthPayload = (
  noteId: string,
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  viewportHeight: number,
  devicePixelRatio: number,
  passwordRect?: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'> | null
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

  const payload: NativeAuthOverlayPayload = {
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

  if (passwordRect) {
    if (
      !isFiniteNumber(passwordRect.left) ||
      !isFiniteNumber(passwordRect.top) ||
      !isFiniteNumber(passwordRect.width) ||
      !isFiniteNumber(passwordRect.height) ||
      passwordRect.width <= 0 ||
      passwordRect.height <= 0
    ) {
      return null;
    }

    payload.passwordRect = {
      x: passwordRect.left,
      y: passwordRect.top,
      width: passwordRect.width,
      height: passwordRect.height,
    };
  }

  return payload;
};
