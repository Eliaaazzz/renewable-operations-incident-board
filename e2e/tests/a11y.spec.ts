import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Accessibility is not a separate feature here — an operations console gets used on a bad
 * monitor, in a bright site office, by someone whose hands are on a radio. Keyboard operability
 * and contrast are ordinary usability.
 *
 * The gate is zero serious or critical violations. Minor and moderate findings are surfaced in
 * the report but not failed on, so the suite stays a signal rather than a nuisance.
 */

async function scan(page: import('@playwright/test').Page, context?: string) {
  const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  const results = await (context === undefined ? builder : builder.include(context)).analyze();
  return results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
}

test('the board has no serious accessibility violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Needs attention' })).toBeVisible();

  const violations = await scan(page);
  expect(violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
});

test('the detail panel has no serious accessibility violations', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Cell temperature rising rapidly/ }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();

  const violations = await scan(page, '[role="dialog"]');
  expect(violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
});

test('the whole journey is operable from the keyboard alone', async ({ page }) => {
  await page.goto('/');

  // Tab until the first alert title button has focus, then open it with the keyboard.
  const target = page.getByRole('button', { name: /Cell temperature rising rapidly/ }).first();
  await expect(target).toBeVisible();
  for (let i = 0; i < 60; i += 1) {
    if (await target.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();

  await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();

  // Focus must be inside the dialog, not left behind on the page underneath it.
  const focusInsideDialog = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    return dialog !== null && dialog.contains(document.activeElement);
  });
  expect(focusInsideDialog).toBe(true);

  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(target).toBeFocused();
});

test('the dark theme keeps its contrast', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Cell temperature rising rapidly/ }).first()).toBeVisible();

  const violations = await scan(page);
  expect(violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
});
