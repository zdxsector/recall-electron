declare module 'react-test-renderer' {
  import * as React from 'react';

  export type ReactTestRenderer = any;
  export const act: (
    callback: () => void | Promise<void>
  ) => void | Promise<void>;
  export const create: (
    reactElement: React.ReactElement,
    options?: { createNodeMock?: (element: any) => any }
  ) => ReactTestRenderer;

  const renderer: {
    act: typeof act;
    create: typeof create;
  };

  export default renderer;
}
