import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Locale } from './config';
import type { Messages } from './translator';

const MESSAGE_DIR_CANDIDATES = [
  path.join(process.cwd(), 'apps/web/messages'),
  path.join(process.cwd(), 'messages'),
];

async function readMessagesFile(locale: Locale): Promise<Messages | null> {
  for (const baseDir of MESSAGE_DIR_CANDIDATES) {
    try {
      const filePath = path.join(baseDir, `${locale}.json`);
      const raw = await readFile(filePath, 'utf8');
      return JSON.parse(raw) as Messages;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') continue;
      throw error;
    }
  }
  return null;
}

export async function loadLocalMessages(locale: Locale): Promise<Messages | null> {
  return readMessagesFile(locale);
}
