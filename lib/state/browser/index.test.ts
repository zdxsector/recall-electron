import { middleware } from './index';

const setInnerWidth = (innerWidth: number) => {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: innerWidth,
  });
};

describe('browser state', () => {
  let resizeHandler: EventListener | null = null;
  let addEventListenerSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    setInnerWidth(1024);
    resizeHandler = null;

    addEventListenerSpy = jest
      .spyOn(window, 'addEventListener')
      .mockImplementation((type, listener) => {
        if (type === 'resize') {
          resizeHandler = listener as EventListener;
        }
      });

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: jest.fn(() => ({
        addListener: jest.fn(),
        matches: false,
      })),
    });
  });

  afterEach(() => {
    addEventListenerSpy.mockRestore();
    jest.useRealTimers();
  });

  it('coalesces resize events into one width update per burst', () => {
    const dispatch = jest.fn();

    middleware({ dispatch } as any)(jest.fn());

    setInnerWidth(900);
    resizeHandler?.(new Event('resize'));
    setInnerWidth(800);
    resizeHandler?.(new Event('resize'));
    setInnerWidth(700);
    resizeHandler?.(new Event('resize'));

    expect(dispatch).not.toHaveBeenCalled();

    jest.advanceTimersByTime(100);

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'WINDOW_RESIZE',
      innerWidth: 700,
    });
  });

  it('does not dispatch while resizing within the same layout breakpoint', () => {
    const dispatch = jest.fn();

    middleware({ dispatch } as any)(jest.fn());

    setInnerWidth(980);
    resizeHandler?.(new Event('resize'));
    setInnerWidth(860);
    resizeHandler?.(new Event('resize'));
    setInnerWidth(780);
    resizeHandler?.(new Event('resize'));
    jest.advanceTimersByTime(100);

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does not dispatch when the coalesced width is unchanged', () => {
    const dispatch = jest.fn();

    middleware({ dispatch } as any)(jest.fn());

    setInnerWidth(1024);
    resizeHandler?.(new Event('resize'));
    jest.advanceTimersByTime(100);

    expect(dispatch).not.toHaveBeenCalled();
  });
});
