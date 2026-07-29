import type { Doc, JSONOpList, Path } from 'ot-json1';
import type { Muya } from '../muya';
import type { TDiff } from '../utils';
import type { IAtxHeadingState, TState } from './types';
import * as json1 from 'ot-json1';
import { deepClone } from '../utils';
import logger from '../utils/logger';
import { MarkdownToState } from './markdownToState';

import StateToMarkdown from './stateToMarkdown';

function ensureFirstBlockIsH1(states: TState[]): TState[] {
  if (states.length === 0) {
    return [{ name: 'atx-heading', meta: { level: 1 }, text: '# ' }];
  }

  const first = states[0];

  if (first.name === 'frontmatter') {
    if (states.length < 2) {
      states.push({ name: 'atx-heading', meta: { level: 1 }, text: '# ' });
    } else if (
      states[1].name !== 'atx-heading' &&
      states[1].name !== 'setext-heading'
    ) {
      if (states[1].name === 'paragraph') {
        const text = (states[1] as any).text || '';
        states[1] = {
          name: 'atx-heading',
          meta: { level: 1 },
          text: `# ${text}`,
        };
      } else {
        states.splice(1, 0, {
          name: 'atx-heading',
          meta: { level: 1 },
          text: '# ',
        });
      }
    }
    return states;
  }

  if (first.name === 'atx-heading' || first.name === 'setext-heading') {
    return states;
  }

  if (first.name === 'paragraph') {
    const text = (first as any).text || '';
    states[0] = {
      name: 'atx-heading',
      meta: { level: 1 },
      text: `# ${text}`,
    } as IAtxHeadingState;
    return states;
  }

  states.unshift({ name: 'atx-heading', meta: { level: 1 }, text: '# ' });
  return states;
}

const debug = logger('jsonState:');

class JSONState {
  static invert(op: JSONOpList) {
    return json1.type.invert(op);
  }

  static compose(op1: JSONOpList, op2: JSONOpList) {
    return json1.type.compose(op1, op2);
  }

  static transform(
    op: JSONOpList,
    otherOp: JSONOpList,
    type: 'left' | 'right'
  ) {
    return json1.type.transform(op, otherOp, type);
  }

  private _operationCache: JSONOpList[] = [];

  private _isGoing = false;

  private state: TState[] = [];

  // History only needs the document that existed immediately before an op.
  // Keep that snapshot current with immutable OT application instead of
  // deep-cloning the entire document for every keystroke.
  private historyState: TState[] = [];

  constructor(
    public muya: Muya,
    stateOrMarkdown: TState[] | string
  ) {
    this.setContent(stateOrMarkdown);
  }

  apply(op: JSONOpList) {
    this.state = json1.type.apply(
      this.state as unknown as Doc,
      op
    ) as unknown as TState[];
  }

  setContent(content: TState[] | string) {
    if (typeof content === 'object') this.setState(content);
    else this.setMarkdown(content);
  }

  setState(state: TState[]) {
    this.state = ensureFirstBlockIsH1(state);
    this.historyState = deepClone(this.state);
  }

  setMarkdown(markdown: string) {
    const {
      footnote,
      isGitlabCompatibilityEnabled,
      trimUnnecessaryCodeBlockEmptyLines,
      frontMatter,
      math,
    } = this.muya.options;

    this.state = ensureFirstBlockIsH1(
      new MarkdownToState({
        footnote,
        isGitlabCompatibilityEnabled,
        trimUnnecessaryCodeBlockEmptyLines,
        frontMatter,
        math,
      }).generate(markdown)
    );
    this.historyState = deepClone(this.state);
  }

  insertOperation(path: Path, state: TState) {
    this.muya.editor.inlineRenderer.invalidateReferenceDefinitions();
    const operation = json1.insertOp(path, state as unknown as Doc)!;

    this._operationCache.push(operation);

    this._emitStateChange();
  }

  removeOperation(path: Path) {
    this.muya.editor.inlineRenderer.invalidateReferenceDefinitions();
    const operation = json1.removeOp(path)!;

    this._operationCache.push(operation);

    this._emitStateChange();
  }

  editOperation(path: Path, diff: TDiff[]) {
    const operation = json1.editOp(path, 'text-unicode', diff)!;

    this._operationCache.push(operation);

    this._emitStateChange();
  }

  replaceOperation(path: Path, oldValue: Doc, newValue: Doc) {
    this.muya.editor.inlineRenderer.invalidateReferenceDefinitions();
    const operation = json1.replaceOp(path, oldValue, newValue)!;

    this._operationCache.push(operation);

    this._emitStateChange();
  }

  dispatch(op: JSONOpList, source = 'user' /* user, api */) {
    const prevDoc = this.historyState;
    this.apply(op);
    this.historyState = json1.type.apply(
      this.historyState as unknown as Doc,
      op
    ) as unknown as TState[];
    debug.log(JSON.stringify(op));
    this.muya.eventCenter.emit('json-change', {
      op,
      source,
      prevDoc,
      doc: this.state,
    });
  }

  getState(): TState[] {
    return deepClone(this.state);
  }

  getMarkdown() {
    this._flushPendingOperations();
    const mdGenerator = new StateToMarkdown();

    return mdGenerator.generate(this.state);
  }

  private _flushPendingOperations() {
    if (this._operationCache.length === 0) return;
    const op = this._operationCache.reduce(json1.type.compose as any);
    this.apply(op);
    this.historyState = json1.type.apply(
      this.historyState as unknown as Doc,
      op
    ) as unknown as TState[];
    this._operationCache = [];
    this._isGoing = false;
  }

  private _emitStateChange() {
    if (this._isGoing) return;

    this._isGoing = true;

    requestAnimationFrame(() => {
      if (this._operationCache.length === 0) {
        this._isGoing = false;
        return;
      }
      const op = this._operationCache.reduce(json1.type.compose as any);
      const prevDoc = this.historyState;
      this.apply(op);
      this.historyState = json1.type.apply(
        this.historyState as unknown as Doc,
        op
      ) as unknown as TState[];
      this.muya.eventCenter.emit('json-change', {
        op,
        source: 'user',
        prevDoc,
        doc: this.state,
      });
      this._operationCache = [];
      this._isGoing = false;
    });
  }
}

export default JSONState;
