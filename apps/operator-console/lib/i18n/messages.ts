import en from '@/messages/en.json';
import es from '@/messages/es.json';

export type Language = 'en' | 'es';

type MessageTree = Record<string, unknown>;

const dictionaries: Record<Language, MessageTree> = { en, es };

const lookup = (tree: MessageTree, key: string): string | undefined => {
  let current: unknown = tree;
  for (const segment of key.split('.')) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as MessageTree)[segment];
  }
  return typeof current === 'string' ? current : undefined;
};

export const translate = (
  language: Language,
  key: string,
  params: Record<string, string | number> = {},
) => {
  const template =
    lookup(dictionaries[language], key) ?? lookup(dictionaries.en, key) ?? key;
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    String(params[name] ?? `{{${name}}}`),
  );
};
