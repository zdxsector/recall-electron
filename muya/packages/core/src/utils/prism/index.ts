import Fuse from 'fuse.js';
import Prism from 'prismjs';
import { languages } from 'prismjs/components.js';
import initLoadLanguage, {
  loadedLanguages,
  transformAliasToOrigin,
} from './loadLanguage';

const prism = Prism;
window.Prism = Prism;

// Track if keep-markup plugin is loaded
let keepMarkupLoaded = false;

// Load keep-markup plugin and track its status
import('prismjs/plugins/keep-markup/prism-keep-markup')
  .then(() => {
    keepMarkupLoaded = true;
  })
  .catch((err) => {
    console.warn('Failed to load Prism keep-markup plugin:', err);
  });

// Export function to check if keep-markup is ready
export const isKeepMarkupReady = () => keepMarkupLoaded;

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
// NOTE: Languages are loaded sequentially to respect dependencies
// (e.g., cpp depends on c, which depends on clike)
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

// Load languages sequentially to ensure dependencies are loaded first
(async () => {
  for (const lang of preloadLanguages) {
    try {
      await loadLanguage(lang);
    } catch (err) {
      console.warn(`Failed to preload Prism language "${lang}":`, err);
    }
  }
})();

export { walkTokens } from './walkToken';
export { loadedLanguages, loadLanguage, search, transformAliasToOrigin };
export default prism;
