/** Arrays are here because a message tree can carry ordered prose —
 *  bullets, steps, lists — not just flat labels. */
export type MessageValue = string | MessageValue[] | { [key: string]: MessageValue };
export type Messages = Record<string, MessageValue>;
export type TranslationParams = Record<string, string | number>;

function lookupMessage(messages: Messages, key: string): string | undefined {
  const direct = messages[key];
  if (typeof direct === 'string') return direct;

  let current: MessageValue | undefined = messages;
  for (const segment of key.split('.')) {
    if (!current || typeof current === 'string') return undefined;
    // An ordered list is addressed by position: the segment is the array index.
    current = Array.isArray(current) ? current[Number(segment)] : current[segment];
  }

  return typeof current === 'string' ? current : undefined;
}

export function createTranslator(messages: Messages) {
  return (key: string, params?: TranslationParams) => {
    const template = lookupMessage(messages, key) ?? key;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (match, token) => {
      if (params[token] === undefined || params[token] === null) return match;
      return String(params[token]);
    });
  };
}
