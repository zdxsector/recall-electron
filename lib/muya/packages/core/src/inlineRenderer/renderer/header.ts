import type { BeginRuleToken, ISyntaxRenderOptions } from '../types';
import type Renderer from './index';
import { CLASS_NAMES } from '../../config';

export default function header(
  this: Renderer,
  {
    h,
    cursor,
    block,
    token,
    outerClass,
  }: ISyntaxRenderOptions & { token: BeginRuleToken }
) {
  const { content } = token;
  const { start, end } = token.range;
  const isFirstBlockTitle =
    block.blockName === 'atxheading.content' && block.parent?.isFirstChild();
  const className = this.getClassName(
    outerClass,
    block,
    {
      range: {
        start,
        end: end - content.length,
      },
    } as BeginRuleToken,
    cursor
  );
  const markerVnode = this.highlight(
    h,
    block,
    start,
    end - content.length,
    token
  );
  const contentVnode = this.highlight(
    h,
    block,
    end - content.length,
    end,
    token
  );
  const spaceSelector =
    isFirstBlockTitle || className === CLASS_NAMES.MU_HIDE
      ? `span.${CLASS_NAMES.MU_HEADER_TIGHT_SPACE}.${CLASS_NAMES.MU_REMOVE}${
          isFirstBlockTitle ? '.mu-title-marker' : ''
        }`
      : `span.${CLASS_NAMES.MU_GRAY}.${CLASS_NAMES.MU_REMOVE}`;

  return [
    h(
      `span.${isFirstBlockTitle ? CLASS_NAMES.MU_HIDE : className}.${CLASS_NAMES.MU_REMOVE}${
        isFirstBlockTitle ? '.mu-title-marker' : ''
      }`,
      markerVnode
    ),
    h(spaceSelector, contentVnode),
  ];
}
