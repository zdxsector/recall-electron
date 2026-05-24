import { domRectToNativeAuthPayload } from './native-auth-rect';

describe('domRectToNativeAuthPayload', () => {
  test('valid auth rect is accepted', () => {
    expect(
      domRectToNativeAuthPayload(
        'note-1',
        { left: 10, top: 20, width: 58, height: 58 } as DOMRect,
        800,
        2
      )
    ).toEqual({
      noteId: 'note-1',
      rect: { x: 10, y: 20, width: 58, height: 58 },
      viewportHeight: 800,
      devicePixelRatio: 2,
    });
  });

  test('invalid rect with negative width or height is rejected', () => {
    expect(
      domRectToNativeAuthPayload(
        'note-1',
        { left: 10, top: 20, width: -1, height: 58 } as DOMRect,
        800,
        1
      )
    ).toBeNull();
    expect(
      domRectToNativeAuthPayload(
        'note-1',
        { left: 10, top: 20, width: 58, height: -1 } as DOMRect,
        800,
        1
      )
    ).toBeNull();
  });

  test('missing noteId is rejected', () => {
    expect(
      domRectToNativeAuthPayload(
        '',
        { left: 10, top: 20, width: 58, height: 58 } as DOMRect,
        800,
        1
      )
    ).toBeNull();
  });
});
