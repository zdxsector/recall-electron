import { sanitizeHtml } from './sanitize-html';

const enableCheckboxInputsInHtml = (html: string): string =>
  String(html ?? '').replace(/<input\b[^>]*>/gi, (tag) => {
    // Only touch checkbox inputs. We want rendered task-list checkboxes to be
    // clickable in the note preview (we toggle them by rewriting markdown).
    if (!/\btype=(?:"checkbox"|'checkbox')/i.test(tag)) {
      return tag;
    }
    return tag.replace(
      /\sdisabled(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi,
      ''
    );
  });

const enableCheckboxes = {
  type: 'output',
  regex: '<input type="checkbox" disabled',
  replace: '<input type="checkbox" ',
};

const removeLineBreaks = {
  type: 'output',
  regex: '>\n',
  replace: '>',
};

export const renderNoteToHtml = (content: string) => {
  const transformedContent = String(content ?? '').replace(
    /([ \t\u2000-\u200a]*)\u2022(\s)/gm,
    '$1-$2'
  ); // normalize bullets

  // Prefer Muya's markdown renderer so advanced blocks (diagram/math/mermaid) can render.
  return import(/* webpackChunkName: 'muya-render' */ '@muyajs/core')
    .then(({ MarkdownToHtml }) =>
      new MarkdownToHtml(transformedContent)
        .renderHtml()
        .then(enableCheckboxInputsInHtml)
    )
    .catch(() =>
      // Fallback to showdown + app sanitizer for robustness.
      import(/* webpackChunkName: 'showdown' */ 'showdown').then(
        ({ default: showdown }) => {
          showdown.extension('enableCheckboxes', enableCheckboxes);
          showdown.extension('removeLineBreaks', removeLineBreaks);
          const markdownConverter = new showdown.Converter({
            extensions: ['enableCheckboxes', 'removeLineBreaks'],
          });
          markdownConverter.setFlavor('github');
          markdownConverter.setOption('ghMentions', false);
          markdownConverter.setOption('literalMidWordUnderscores', true);
          markdownConverter.setOption('simpleLineBreaks', false); // override GFM
          markdownConverter.setOption('smoothLivePreview', true);
          markdownConverter.setOption('splitAdjacentBlockquotes', true);
          markdownConverter.setOption('strikethrough', true); // ~~strikethrough~~
          markdownConverter.setOption('tables', true); // table syntax

          return sanitizeHtml(
            enableCheckboxInputsInHtml(
              markdownConverter.makeHtml(transformedContent)
            )
          );
        }
      )
    );
};
