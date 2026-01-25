import Fuse from 'fuse.js';
import Prism from 'prismjs';
import { languages } from 'prismjs/components.js';
import initLoadLanguage, {
  loadedLanguages,
  transformAliasToOrigin,
} from './loadLanguage';

const prism = Prism;
window.Prism = Prism;
import('prismjs/plugins/keep-markup/prism-keep-markup');

const langs: {
  name: string;
  [key: string]: string;
}[] = [];

for (const name of Object.keys(languages)) {
  const lang = languages[name];
  langs.push({
    name,
    ...lang,
  });
  if (lang.alias) {
    if (typeof lang.alias === 'string') {
      langs.push({
        name: lang.alias,
        ...lang,
      });
    } else if (Array.isArray(lang.alias)) {
      langs.push(
        ...lang.alias.map((a: string) => ({
          name: a,
          ...lang,
        }))
      );
    }
  }
}

const loadLanguage = initLoadLanguage(Prism);

function search(text: string) {
  if (!text || typeof text !== 'string') return [];

  const fuse = new Fuse(langs, {
    includeScore: true,
    keys: ['name', 'title', 'alias'],
  });

  return fuse
    .search(text)
    .map((i) => i.item)
    .slice(0, 5);
}

// Pre-load common languages for immediate syntax highlighting:
// - latex/yaml for math blocks and front matter
// - common programming languages users are likely to use
const preloadLanguages = [
  'latex',
  'yaml',
  'c',
  'cpp',
  'csharp',
  'java',
  'python',
  'ruby',
  'go',
  'rust',
  'swift',
  'kotlin',
  'typescript',
  'php',
  'sql',
  'bash',
  'json',
  'xml',
  'markdown',
];

preloadLanguages.forEach((lang) => loadLanguage(lang));

export { walkTokens } from './walkToken';
export { loadedLanguages, loadLanguage, search, transformAliasToOrigin };
export default prism;
