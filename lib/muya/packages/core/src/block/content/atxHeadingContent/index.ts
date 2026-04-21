import type { Muya } from '../../../muya';
import type { ICursor } from '../../../selection/types';
import type AtxHeading from '../../commonMark/atxHeading';
import Format from '../../base/format';
import { ScrollPage } from '../../scrollPage';

class AtxHeadingContent extends Format {
  public override parent: AtxHeading | null = null;

  static override blockName = 'atxheading.content';

  static create(muya: Muya, text: string) {
    const content = new AtxHeadingContent(muya, text);

    return content;
  }

  constructor(muya: Muya, text: string) {
    super(muya, text);
    this.classList = [...this.classList, 'mu-atxheading-content'];
    this.createDomNode();
  }

  override getAnchor() {
    return this.parent;
  }

  override update(cursor: ICursor, highlights = []) {
    const result = this.inlineRenderer.patch(this, cursor, highlights);
    const contentAfterMarker = this.text.replace(/^#{1,6}\s*/, '').trim();
    if (!contentAfterMarker && this.parent?.isFirstChild()) {
      this.domNode?.setAttribute('data-placeholder', 'No Title');
    } else {
      this.domNode?.removeAttribute('data-placeholder');
    }
    return result;
  }

  override enterHandler(event: Event) {
    const { start, end } = this.getCursor()!;
    const { level } = this.parent!.meta;

    if (start.offset === end.offset && start.offset <= level + 1) {
      const newNodeState = {
        name: 'paragraph',
        text: '',
      };

      const newParagraphBlock = ScrollPage.loadBlock(newNodeState.name).create(
        this.muya,
        newNodeState
      );
      this.parent!.parent!.insertBefore(newParagraphBlock, this.parent);
      this.setCursor(start.offset, end.offset, true);
    } else {
      super.enterHandler(event as KeyboardEvent);
    }
  }

  override backspaceHandler(event: Event) {
    const { start, end } = this.getCursor()!;
    const isFirstBlock = this.parent?.isFirstChild();

    if (start.offset === 0 && end.offset === 0) {
      event.preventDefault();
      if (isFirstBlock) return;
      this.text = this.text.replace(/^ {0,3}#{1,6} */, '');
      this.convertToParagraph();
    } else if (start.offset === 1 && end.offset === 1 && this.text === '#') {
      event.preventDefault();
      if (isFirstBlock) {
        this.text = '# ';
        this.setCursor(2, 2, true);
        return;
      }
      this.text = '';
      this.setCursor(0, 0);
      this.convertToParagraph();
    } else {
      super.backspaceHandler(event);
    }
  }
}

export default AtxHeadingContent;
