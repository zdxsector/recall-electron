import type Format from '../block/base/format';
import type ParagraphContent from '../block/content/paragraphContent';
import type { Muya } from '../muya';
import type { ICursor } from '../selection/types';
import type { IParagraphState, TContainerState, TState } from '../state/types';
import type { IHighlight, Labels } from './types';
import logger from '../utils/logger';
import { tokenizer } from './lexer';
import Renderer from './renderer';
import { beginRules } from './rules';

const debug = logger('inlineRenderer:');

class InlineRenderer {
  public labels: Labels = new Map();
  public renderer: Renderer;
  private referenceDefinitionsDirty = true;

  constructor(public muya: Muya) {
    this.renderer = new Renderer(muya, this);
  }

  tokenizer(block: Format, highlights: IHighlight[]) {
    const { options } = this.muya;
    const { text } = block;
    const { labels } = this;

    // TODO: different content block should have different rules.
    // eg: atxheading.content has no soft|hard line break
    // setextheading.content has no heading rules.
    const hasBeginRules =
      /thematicbreak\.content|paragraph\.content|atxheading\.content/.test(
        block.blockName
      );

    return tokenizer(text, { hasBeginRules, labels, options, highlights });
  }

  patch(block: Format, cursor?: ICursor, highlights: IHighlight[] = []) {
    if (this.referenceDefinitionsDirty) {
      this.collectReferenceDefinitions();
    }
    const { domNode } = block;
    if (block.isParent()) debug.error('Patch can only handle content block');

    const tokens = this.tokenizer(block, highlights);
    const html = this.renderer.output(
      tokens,
      block,
      cursor && cursor.block === block ? cursor : {}
    );
    domNode!.innerHTML = html;
  }

  invalidateReferenceDefinitions() {
    this.referenceDefinitionsDirty = true;
  }

  collectReferenceDefinitions() {
    const labels = new Map();

    const scrollPage = this.muya.editor.scrollPage;
    if (scrollPage) {
      scrollPage.breadthFirstTraverse((node) => {
        if (node.blockName !== 'paragraph.content') return;
        const { label, info } = this.getLabelInfo(node as any);
        if (label && info) labels.set(label, info);
      });
    } else {
      // The editor tree is not available during the first block's constructor.
      // This fallback runs at most once during initialization.
      const state = this.muya.editor.jsonState.getState();
      const travel = (sts: TState[]) => {
        if (!Array.isArray(sts)) return;
        for (const st of sts) {
          if (st.name === 'paragraph') {
            const { label, info } = this.getLabelInfo(st);
            if (label && info) labels.set(label, info);
          } else if ((st as TContainerState).children) {
            travel((st as TContainerState).children);
          }
        }
      };

      travel(state);
    }

    this.labels = labels;
    this.referenceDefinitionsDirty = false;
    return labels.size;
  }

  getLabelInfo(blockOrState: ParagraphContent | IParagraphState) {
    const { text } = blockOrState;
    const tokens = beginRules.reference_definition.exec(text);
    let label = null;
    let info = null;
    if (tokens) {
      label = (tokens[2] + tokens[3]).toLowerCase();
      info = {
        href: tokens[6],
        title: tokens[10] || '',
      };
    }

    return { label, info };
  }
}

export default InlineRenderer;
