const EMAIL = /[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+\.[^\s@<>"'(),;:]+/g;
const DIGITS = /\d+/g;
const WHITESPACE = /\s+/g;

export const MESSAGE_LIMIT = 300;

export function maskMessage(raw: unknown): string {
  const text = typeof raw === 'string' ? raw : String(raw ?? '');
  return text
    .slice(0, MESSAGE_LIMIT * 4)
    .replace(EMAIL, '<email>')
    .replace(DIGITS, '<n>')
    .replace(WHITESPACE, ' ')
    .trim()
    .slice(0, MESSAGE_LIMIT);
}
