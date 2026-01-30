import type { ITurnoverOptions } from './types';
import { DEFAULT_TURNDOWN_CONFIG } from '../config';
import TurndownService, { usePluginsAddRules } from '../utils/turndownService';

const DEBUG_PERSIST =
  typeof globalThis !== 'undefined' &&
  (globalThis as { __RECALL_DEBUG_PERSIST?: boolean }).__RECALL_DEBUG_PERSIST ===
    true;

const summarizeNewlines = (value: string) => {
  const text = String(value ?? '');
  const total = (text.match(/\n/g) || []).length;
  const leadingMatch = text.match(/^\n+/);
  const trailingMatch = text.match(/\n+$/);
  let maxRun = 0;
  let current = 0;
  for (const ch of text) {
    if (ch === '\n') {
      current += 1;
      if (current > maxRun) {
        maxRun = current;
      }
    } else {
      current = 0;
    }
  }
  return {
    length: text.length,
    totalNewlines: total,
    leadingNewlines: leadingMatch ? leadingMatch[0].length : 0,
    trailingNewlines: trailingMatch ? trailingMatch[0].length : 0,
    maxConsecutiveNewlines: maxRun,
  };
};

// Just because turndown change `\n`(soft line break) to space, So we add `span.ag-soft-line-break` to workaround.
function turnSoftBreakToSpan(html: string) {
  const inputStats = DEBUG_PERSIST ? summarizeNewlines(html) : null;
  const parser = new DOMParser();
  const doc = parser.parseFromString(
    `<x-mt id="turn-root">${html}</x-mt>`,
    'text/html'
  );
  const root = doc.querySelector('#turn-root');
  const travel = (childNodes: NodeListOf<ChildNode>) => {
    for (const node of childNodes) {
      if (
        node.nodeType === Node.TEXT_NODE &&
        node.parentElement?.tagName !== 'CODE'
      ) {
        let startLen = 0;
        let endLen = 0;
        const text = String(node.nodeValue ?? '')
          .replace(/^(\n+)/, (_, p) => {
            startLen = p.length;

            return '';
          })
          .replace(/(\n+)$/, (_, p) => {
            endLen = p.length;

            return '';
          });
        if (/\n/.test(text)) {
          const tokens = text.split('\n');
          const params = [];
          let i = 0;
          const len = tokens.length;

          for (; i < len; i++) {
            let text = tokens[i];
            if (i === 0 && startLen !== 0) text = '\n'.repeat(startLen) + text;
            else if (i === len - 1 && endLen !== 0)
              text = text + '\n'.repeat(endLen);

            params.push(document.createTextNode(text));
            if (i !== len - 1) {
              const softBreak = document.createElement('span');
              softBreak.classList.add('mu-soft-line-break');
              params.push(softBreak);
            }
          }
          node.replaceWith(...params);
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        travel(node.childNodes);
      }
    }
  };
  travel(root!.childNodes);

  const output = root!.innerHTML.trim();
  if (DEBUG_PERSIST) {
    // eslint-disable-next-line no-console
    console.log('[html->md:soft-breaks]', {
      inputStats,
      outputStats: summarizeNewlines(output),
    });
  }
  return output;
}

export default class HtmlToMarkdown {
  private options: ITurnoverOptions;

  constructor(options = {}) {
    this.options = Object.assign(
      {},
      DEFAULT_TURNDOWN_CONFIG as ITurnoverOptions,
      options
    );
  }

  generate(html: string): string {
    // turn html to markdown
    const { options } = this;
    const turndownService = new TurndownService(options);
    usePluginsAddRules(turndownService);

    // fix #752, but I don't know why the &nbsp; vanished.
    html = html.replace(/<span>&nbsp;<\/span>/g, String.fromCharCode(160));

    html = turnSoftBreakToSpan(html);
    const markdown = turndownService.turndown(html);

    if (DEBUG_PERSIST) {
      // eslint-disable-next-line no-console
      console.log('[html->md]', {
        htmlStats: summarizeNewlines(html),
        markdownStats: summarizeNewlines(markdown),
      });
    }

    return markdown;
  }
}
