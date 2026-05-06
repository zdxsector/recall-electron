import { combineReducers } from 'redux';

import * as A from '../action-types';
import * as S from '../';
import { SINGLE_COLUMN_WIDTH } from '../../utils/breakpoints';
import { createWindowResizePerformanceController } from '../../utils/window-resize-performance';

///////////////////////////////////////
////  HELPERS
///////////////////////////////////////

const getTheme = () =>
  window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

const getWidth = () => window.innerWidth;
const RESIZE_DISPATCH_INTERVAL_MS = 100;
const isSmallScreenWidth = (width: number) => width <= SINGLE_COLUMN_WIDTH;

///////////////////////////////////////
////  REDUCERS
///////////////////////////////////////

const systemTheme: A.Reducer<'light' | 'dark'> = (
  state = getTheme(),
  action
) => (action.type === 'SYSTEM_THEME_UPDATE' ? action.prefers : state);

const windowWidth: A.Reducer<number> = (state = getWidth(), action) =>
  action.type === 'WINDOW_RESIZE' && action.innerWidth !== state
    ? action.innerWidth
    : state;

///////////////////////////////////////
////  COMBINED
///////////////////////////////////////

export const reducer = combineReducers({
  windowWidth,
  systemTheme,
});

export const middleware: S.Middleware = ({ dispatch }) => {
  const resizePerformance = createWindowResizePerformanceController();
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  let queuedWidth = getWidth();
  let lastDispatchedWidth = queuedWidth;
  let lastDispatchedIsSmallScreen = isSmallScreenWidth(queuedWidth);

  const flushResize = () => {
    resizeTimer = null;

    if (queuedWidth === lastDispatchedWidth) {
      return;
    }

    const nextIsSmallScreen = isSmallScreenWidth(queuedWidth);
    if (nextIsSmallScreen === lastDispatchedIsSmallScreen) {
      lastDispatchedWidth = queuedWidth;
      return;
    }

    lastDispatchedWidth = queuedWidth;
    lastDispatchedIsSmallScreen = nextIsSmallScreen;
    dispatch({
      type: 'WINDOW_RESIZE',
      innerWidth: queuedWidth,
    });
  };

  window.addEventListener('resize', () => {
    resizePerformance.handleResize();
    queuedWidth = getWidth();

    if (resizeTimer) {
      return;
    }

    resizeTimer = setTimeout(flushResize, RESIZE_DISPATCH_INTERVAL_MS);
  });

  window.matchMedia('(prefers-color-scheme: dark)').addListener(() =>
    dispatch({
      type: 'SYSTEM_THEME_UPDATE',
      prefers: getTheme(),
    })
  );

  return (next) => next;
};
