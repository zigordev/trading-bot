import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.describe('overview', () => {
  test('renders the console shell rather than a blank document', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('navigation').first()).toBeVisible();
    expect(await page.getByRole('heading').count()).toBeGreaterThanOrEqual(4);
  });

  test('has no WCAG A or AA violations', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length} node(s) — ${v.help}`)).toEqual(
      []
    );
  });
});
