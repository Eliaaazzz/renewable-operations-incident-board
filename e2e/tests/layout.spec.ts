import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditLayout, hasHorizontalPageScroll } from './helpers/layout-audit';

/**
 * The responsive layout audit.
 *
 * The seeded portfolio deliberately contains a 55-character unbroken asset id and several long
 * machine-written descriptions, so these viewports are being asked a real question rather than
 * a rhetorical one.
 */

const SCREENSHOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../docs/screenshots');

const VIEWPORTS = [
  { name: 'desktop-wide', width: 1440, height: 900 },
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'laptop', width: 1024, height: 768 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 375, height: 812 },
] as const;

test.beforeAll(() => {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
});

for (const viewport of VIEWPORTS) {
  test(`board layout holds at ${viewport.name} (${viewport.width}px)`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Needs attention' })).toBeVisible();
    // Wait for the table or card list to settle before measuring anything.
    await expect(page.getByRole('button', { name: /Cell temperature rising rapidly/ }).first()).toBeVisible();

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/board-${viewport.name}.png`,
      fullPage: true,
    });

    expect(
      await hasHorizontalPageScroll(page),
      'the page itself must never scroll sideways',
    ).toBe(false);

    const violations = await auditLayout(page);
    expect(violations.map((violation) => `${violation.kind}: ${violation.detail}`)).toEqual([]);
  });
}

for (const viewport of [VIEWPORTS[1], VIEWPORTS[4]] as const) {
  test(`detail panel layout holds at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/');

    // ALT-1032 carries the 55-character asset id, so this is the worst case for the panel.
    await page.getByRole('searchbox', { name: 'Search alerts' }).fill('ALT-1032');
    await page.getByRole('button', { name: /String output 29% below/ }).first().click();

    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('Reported measurements')).toBeVisible();

    await page.screenshot({
      path: `${SCREENSHOT_DIR}/detail-${viewport.name}.png`,
      fullPage: false,
    });

    // Only the dialog subtree: the board behind it is legitimately covered by the backdrop,
    // and comparing text across the two would report an overlap that nobody can see.
    const violations = await auditLayout(page, '[role="dialog"]');
    expect(violations.map((violation) => `${violation.kind}: ${violation.detail}`)).toEqual([]);
  });
}

test('long unbroken asset identifiers are truncated, not spilled', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('searchbox', { name: 'Search alerts' }).fill('ALT-1032');

  const assetCell = page.getByTitle('CB-04-STR-09-INV-07-MOJAVE-RIDGE-NORTHFIELD-SECTION-B');
  await expect(assetCell).toBeVisible();

  // Clipped rather than wrapped or overflowing: the element overflows its own box, and the box
  // hides it. The audit above proves the text is not painted outside it.
  const overflowed = await assetCell.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(overflowed).toBe(true);
  expect(await assetCell.evaluate((el) => getComputedStyle(el).overflow)).toContain('hidden');
});

test('the dark theme is laid out as carefully as the light one', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Cell temperature rising rapidly/ }).first()).toBeVisible();

  await page.screenshot({ path: `${SCREENSHOT_DIR}/board-dark.png`, fullPage: true });

  const violations = await auditLayout(page);
  expect(violations.map((violation) => `${violation.kind}: ${violation.detail}`)).toEqual([]);
});
