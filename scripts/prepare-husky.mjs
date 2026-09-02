import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

if (process.env.HUSKY === '0' || process.env.CI === 'true') {
  process.exit(0);
}

const gitDir = join(process.cwd(), '.git');
if (!existsSync(gitDir)) {
  process.exit(0);
}

try {
  execSync('git config core.hooksPath .husky', { stdio: 'ignore' });
} catch {
  process.exit(0);
}
