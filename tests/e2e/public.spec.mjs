import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.supabase = window.supabase || {
      createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: null }, error: null }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
        }
      })
    };
  });
});

test('loads the secure sign-in screen without exposing the application', async ({ page }) => {
  const applicationErrors = [];
  page.on('pageerror', error => applicationErrors.push(error.message));
  await page.goto('/');

  await expect(page).toHaveTitle(/MG Bayan Lepas.*Monthly Charges/i);
  await expect(page.locator('#loginView')).toBeVisible();
  await expect(page.locator('#app')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
  await expect(page.getByText(/sign up/i)).toHaveCount(0);
  expect(applicationErrors).toEqual([]);
});

test('loads every production module in the required order', async ({ page }) => {
  const failedResponses = [];
  page.on('response', response => {
    if (response.url().startsWith('http://127.0.0.1:4173') && response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
  });
  await page.goto('/');

  const scripts = await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => node.getAttribute('src')));
  expect(scripts.indexOf('app-navigation.js')).toBeGreaterThan(-1);
  expect(scripts.indexOf('app-pages.js')).toBeGreaterThan(-1);
  expect(scripts.indexOf('app-navigation.js')).toBeLessThan(scripts.indexOf('app.js'));
  expect(scripts.indexOf('app-pages.js')).toBeLessThan(scripts.indexOf('app.js'));
  expect(scripts).toContain('finance-reporting.js');
  expect(scripts).toContain('month-end-control.js');
  expect(scripts).toContain('management-analytics.js');
  expect(failedResponses).toEqual([]);
});

test('keeps the sign-in form usable on mobile screens', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile-only layout check');
  await page.goto('/');
  const card = page.locator('#loginView .login');
  await expect(card).toBeVisible();
  const box = await card.boundingBox();
  const viewport = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
});
