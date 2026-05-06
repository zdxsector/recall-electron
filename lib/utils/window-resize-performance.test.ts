import { createWindowResizePerformanceController } from './window-resize-performance';

describe('window resize performance controller', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = '';
    document.body.className = '';
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('freezes editor image dimensions during resize and restores them after idle', () => {
    document.body.innerHTML =
      '<div class="muya-editor-root"><img style="width: 50%; max-width: 100%;" /></div>';
    const image = document.querySelector('img') as HTMLImageElement;
    Object.defineProperty(image, 'getBoundingClientRect', {
      value: () => ({ width: 320, height: 180 }),
    });

    const controller = createWindowResizePerformanceController(document);
    controller.handleResize();

    expect(document.body.classList.contains('is-window-resizing')).toBe(true);
    expect(image.style.width).toBe('320px');
    expect(image.style.height).toBe('180px');
    expect(image.style.maxWidth).toBe('none');

    jest.advanceTimersByTime(160);

    expect(document.body.classList.contains('is-window-resizing')).toBe(false);
    expect(image.style.width).toBe('50%');
    expect(image.style.height).toBe('');
    expect(image.style.maxWidth).toBe('100%');
  });

  it('keeps the original dimensions from the first resize event in a burst', () => {
    document.body.innerHTML =
      '<div class="note-list"><img class="note-list-item-thumb-img" /></div>';
    const image = document.querySelector('img') as HTMLImageElement;
    let width = 44;
    Object.defineProperty(image, 'getBoundingClientRect', {
      value: () => ({ width, height: 44 }),
    });

    const controller = createWindowResizePerformanceController(document);
    controller.handleResize();
    width = 80;
    controller.handleResize();

    expect(image.style.width).toBe('44px');

    jest.advanceTimersByTime(160);

    expect(image.style.width).toBe('');
  });
});
