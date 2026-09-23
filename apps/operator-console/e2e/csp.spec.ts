import { expect, test, type Page } from '@playwright/test';

type Violation = { directive: string; blocked: string };

async function recordViolations(page: Page) {
  await page.addInitScript(() => {
    const seen: { directive: string; blocked: string }[] = [];
    Object.assign(window, { __violations: seen });
    document.addEventListener('securitypolicyviolation', (event) => {
      seen.push({ directive: event.effectiveDirective, blocked: event.blockedURI });
    });
  });
}

const violations = (page: Page) =>
  page.evaluate(() => (window as unknown as { __violations: Violation[] }).__violations);

test('the overview opens its ops socket within its own policy', async ({ page }) => {
  await recordViolations(page);
  const socket = page.waitForEvent('websocket');
  await page.goto('/');
  expect(new URL((await socket).url()).pathname).toBe('/ws/ops');
  await page.waitForLoadState('networkidle');
  expect(await violations(page)).toEqual([]);
});

for (const path of [
  '/backtesting',
  '/execution',
  '/execution/paper',
  '/configuration',
  '/configuration/pairs',
]) {
  test(`${path} breaks none of its own content security policy`, async ({ page }) => {
    await recordViolations(page);
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    expect(await violations(page)).toEqual([]);
  });
}

test('an inline script the page did not vouch for is still reported', async ({ page }) => {
  await recordViolations(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = 'window.__injected = true;';
    document.body.append(script);
  });
  await expect
    .poll(() => violations(page))
    .toEqual([{ directive: 'script-src-elem', blocked: 'inline' }]);
});
