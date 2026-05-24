'use strict';

const MAX_AUTH_RECT_VALUE = 100000;
const MIN_DEVICE_PIXEL_RATIO = 0.25;
const MAX_DEVICE_PIXEL_RATIO = 8;

const finiteNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value);

const normalizePositiveNumber = (value) => {
  if (!finiteNumber(value) || value <= 0 || value > MAX_AUTH_RECT_VALUE) {
    return null;
  }

  return value;
};

const normalizeCoordinate = (value) => {
  if (!finiteNumber(value) || Math.abs(value) > MAX_AUTH_RECT_VALUE) {
    return null;
  }

  return value;
};

const normalizeScaleFactor = (value) => {
  if (
    !finiteNumber(value) ||
    value < MIN_DEVICE_PIXEL_RATIO ||
    value > MAX_DEVICE_PIXEL_RATIO
  ) {
    return null;
  }

  return value;
};

const normalizeDomAuthRect = (payload = {}) => {
  const rawRect = payload && typeof payload === 'object' ? payload.rect : null;
  if (!rawRect || typeof rawRect !== 'object') {
    return null;
  }

  const x = normalizeCoordinate(rawRect.x ?? rawRect.left);
  const y = normalizeCoordinate(rawRect.y ?? rawRect.top);
  const width = normalizePositiveNumber(rawRect.width);
  const height = normalizePositiveNumber(rawRect.height);
  const viewportHeight = normalizePositiveNumber(
    payload.viewportHeight ?? rawRect.viewportHeight
  );
  const devicePixelRatio = normalizeScaleFactor(
    payload.devicePixelRatio ?? rawRect.devicePixelRatio ?? 1
  );

  if (
    x === null ||
    y === null ||
    width === null ||
    height === null ||
    viewportHeight === null ||
    devicePixelRatio === null
  ) {
    return null;
  }

  return {
    x,
    y,
    width,
    height,
    viewportHeight,
    devicePixelRatio,
  };
};

const scaleRectForDevicePixels = (rect) => {
  const normalized = normalizeDomAuthRect({
    rect,
    viewportHeight: rect.viewportHeight,
  });
  if (!normalized) {
    return null;
  }

  const dpr = normalized.devicePixelRatio;
  return {
    x: Math.round(normalized.x * dpr),
    y: Math.round(normalized.y * dpr),
    width: Math.round(normalized.width * dpr),
    height: Math.round(normalized.height * dpr),
    scaleFactor: dpr,
  };
};

const domRectToAppKitRect = (payload = {}) => {
  const rect = normalizeDomAuthRect(payload);
  if (!rect) {
    return null;
  }

  const dpr = rect.devicePixelRatio;
  return {
    x: Math.round(rect.x * dpr),
    y: Math.round((rect.viewportHeight - rect.y - rect.height) * dpr),
    width: Math.round(rect.width * dpr),
    height: Math.round(rect.height * dpr),
    scaleFactor: dpr,
  };
};

module.exports = {
  domRectToAppKitRect,
  normalizeDomAuthRect,
  scaleRectForDevicePixels,
};
