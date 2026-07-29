import { type as textType } from 'ot-text-unicode';
import { textChangeToTextOp } from './index';

describe('textChangeToTextOp', () => {
  test.each([
    ['prefix', 'alpha', 'alpha beta'],
    ['middle', 'alpha beta', 'alpha gamma beta'],
    ['delete', 'alpha beta', 'alpha'],
    ['unicode', 'before 😀 after', 'before 😀 added after'],
  ])('%s edits apply to the expected text', (_name, oldText, newText) => {
    const operation = textChangeToTextOp(oldText, newText);

    expect(textType.apply(oldText, operation as any)).toBe(newText);
  });
});
