'use strict';

const {
  domRectToAppKitRect,
  normalizeDomAuthRect,
} = require('../native-auth-geometry');

describe('native auth geometry', () => {
  test('valid auth rect is accepted', () => {
    const rect = normalizeDomAuthRect({
      rect: { x: 10, y: 20, width: 58, height: 58 },
      viewportHeight: 800,
      devicePixelRatio: 1,
    });

    expect(rect).toEqual({
      x: 10,
      y: 20,
      width: 58,
      height: 58,
      viewportHeight: 800,
      devicePixelRatio: 1,
    });
  });

  test('invalid rect with negative width or height is rejected', () => {
    expect(
      normalizeDomAuthRect({
        rect: { x: 10, y: 20, width: -1, height: 58 },
        viewportHeight: 800,
        devicePixelRatio: 1,
      })
    ).toBeNull();

    expect(
      normalizeDomAuthRect({
        rect: { x: 10, y: 20, width: 58, height: -1 },
        viewportHeight: 800,
        devicePixelRatio: 1,
      })
    ).toBeNull();
  });

  test('top-left DOM coordinate converts to AppKit-compatible coordinate', () => {
    const rect = domRectToAppKitRect({
      rect: { x: 10, y: 20, width: 58, height: 30 },
      viewportHeight: 800,
      devicePixelRatio: 1,
    });

    expect(rect).toEqual({
      x: 10,
      y: 750,
      width: 58,
      height: 30,
      scaleFactor: 1,
    });
  });

  test('retina devicePixelRatio is applied to coordinates and dimensions', () => {
    const rect = domRectToAppKitRect({
      rect: { x: 10.25, y: 20.25, width: 58.4, height: 30.4 },
      viewportHeight: 800,
      devicePixelRatio: 2,
    });

    expect(rect).toEqual({
      x: 21,
      y: 1499,
      width: 117,
      height: 61,
      scaleFactor: 2,
    });
  });
});
