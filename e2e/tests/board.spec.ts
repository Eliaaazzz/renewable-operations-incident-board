import { expect, test } from '@playwright/test';

/**
 * The journey the brief describes: find what matters, open it, change its status, record a
 * follow-up note, and ask the assistant for help. Run against the real API and a real database.
 */

const liveAi = process.env['E2E_LIVE_AI'] === '1';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Needs attention' })).toBeVisible();
});

test('ranks the most urgent alert first and explains why', async ({ page }) => {
  const queue = page.getByRole('region', { name: 'Needs attention' });
  const first = queue.getByRole('listitem').first();

  // The thermal runaway alert on the largest site outranks everything, including other
  // criticals, because severity is only one of the inputs.
  await expect(first).toContainText('Cell temperature rising rapidly');
  await expect(first).toContainText('Kestrel Flats BESS');
  await expect(first.getByText('P1')).toBeVisible();
});

test('opens an alert, changes its status and records a note', async ({ page }) => {
  await page.getByRole('button', { name: /Inverter INV-07 offline/ }).first().click();

  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText('ALT-1041');
  await expect(drawer).toContainText('Mojave Ridge Solar');
  // The ranking must be interrogable, not just asserted.
  await expect(drawer.getByText(/Why this is ranked/)).toBeVisible();

  await drawer.getByRole('textbox', { name: /follow-up note/i }).fill(
    'Called the site lead — field team is 20 minutes out.',
  );
  await drawer.getByRole('button', { name: 'Acknowledge' }).click();

  await expect(drawer.getByText('Acknowledged').first()).toBeVisible();
  await expect(drawer).toContainText('Called the site lead');
  // The status change and the note that explains it both land on the audit trail.
  await expect(drawer).toContainText('Status changed from New to Acknowledged');
});

test('adds a note without changing the status', async ({ page }) => {
  await page.getByRole('button', { name: /Ground fault detected/ }).first().click();
  const drawer = page.getByRole('dialog');

  await drawer.getByRole('textbox', { name: /follow-up note/i }).fill('Isolation confirmed on site.');
  await drawer.getByRole('button', { name: 'Add note' }).click();

  await expect(drawer).toContainText('Isolation confirmed on site.');
  await expect(drawer.getByText('New').first()).toBeVisible();
});

test('offers only the legal next statuses', async ({ page }) => {
  // ALT-1037 is resolved; the only legal move is to reopen it, and the UI must not offer
  // anything the API would reject.
  await page.getByRole('searchbox', { name: 'Search alerts' }).fill('ALT-1037');
  await page.getByRole('button', { name: /Arc fault detected/ }).first().click();

  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('button', { name: 'Reopen' })).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Acknowledge' })).toHaveCount(0);
  await expect(drawer.getByRole('button', { name: 'Resolve' })).toHaveCount(0);
});

test('filters, and keeps the filter in the URL so a board can be shared', async ({ page }) => {
  await page.getByRole('button', { name: /^Critical/ }).click();

  await expect(page).toHaveURL(/severity=critical/);
  const rows = page.getByRole('row');
  await expect(rows.filter({ hasText: 'Critical' }).first()).toBeVisible();

  // A reload restores exactly the same board — which is the point of putting it in the URL.
  await page.reload();
  await expect(page.getByRole('button', { name: /^Critical/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('KPI drilldowns do not accidentally intersect with stale filters', async ({ page }) => {
  await page.getByRole('button', { name: /^Needs attention/ }).first().click();
  await expect(page).toHaveURL(/needsAttention=true/);

  await page.getByRole('button', { name: /^Open critical/ }).click();

  await expect(page).toHaveURL(/severity=critical/);
  await expect(page).toHaveURL(/status=new%2Cacknowledged%2Cin_progress/);
  await expect(page).not.toHaveURL(/needsAttention=true/);
  await expect(page.getByRole('button', { name: /^Needs attention only/ })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  // The third open critical is already in progress, so it only appears when the KPI drilldown
  // clears the needs-attention filter.
  await expect(page.getByRole('button', { name: /Three tracker rows failed/ }).first()).toBeVisible();
});

test('says so plainly when a filter combination matches nothing', async ({ page }) => {
  await page.getByRole('searchbox', { name: 'Search alerts' }).fill('zzz-no-such-alert');

  await expect(page.getByText('No alerts match these filters')).toBeVisible();
  await page.getByRole('button', { name: 'Clear all filters' }).click();
  await expect(page.getByText('No alerts match these filters')).toHaveCount(0);
});

test('closes the drawer with Escape and returns focus to the row', async ({ page }) => {
  const trigger = page.getByRole('button', { name: /Cell temperature rising rapidly/ }).first();
  await trigger.click();
  await expect(page.getByRole('dialog')).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Without the focus return a keyboard user lands back at the top of the document and has to
  // tab through the whole board to get back to where they were reading.
  await expect(trigger).toBeFocused();
});

test('generates an assessment and labels where it came from', async ({ page }) => {
  await page.getByRole('button', { name: /Cell temperature rising rapidly/ }).first().click();
  const drawer = page.getByRole('dialog');

  await drawer.getByRole('button', { name: 'Generate assessment' }).click();

  await expect(drawer.getByText(/Suggested next actions/i)).toBeVisible({ timeout: 90_000 });
  await expect(drawer.getByText(/Generated text can be wrong/)).toBeVisible();

  if (liveAi) {
    // Against a real model: the answer must be attributed to that model, and the deterministic
    // baseline must be shown next to it.
    await expect(drawer.getByText(/llama/i)).toBeVisible();
    await expect(drawer.getByText(/Scoring rules give/)).toBeVisible();
  } else {
    // With the model disabled the fallback must announce itself rather than passing itself off
    // as the assistant.
    await expect(
      drawer.getByText('Produced by the deterministic rules engine, not the language model.', {
        exact: true,
      }),
    ).toBeVisible();
  }
});

test('@live produces a grounded model answer', async ({ page }) => {
  test.skip(!liveAi, 'Set E2E_LIVE_AI=1 with Ollama running to exercise the real model.');

  await page.getByRole('button', { name: /Cell temperature rising rapidly/ }).first().click();
  const drawer = page.getByRole('dialog');
  await drawer.getByRole('button', { name: 'Generate assessment' }).click();

  await expect(drawer.getByText(/Suggested next actions/i)).toBeVisible({ timeout: 120_000 });
  await expect(drawer.getByText(/deterministic rules engine/i)).toHaveCount(0);
  await expect(drawer.getByText(/Likely causes/i)).toBeVisible();
});
