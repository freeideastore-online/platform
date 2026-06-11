import { expect, test } from '@playwright/test';

test('homepage loads idea cards and navigates to a dynamic idea page', async ({ page, isMobile }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Ideas in progress.' })).toBeVisible();
  if (!isMobile) {
    await expect(page.locator('nav').getByRole('link', { name: 'About', exact: true })).toBeVisible();
    await expect(page.locator('nav').getByRole('link', { name: 'Docs', exact: true })).toBeVisible();
    await expect(page.locator('nav').getByRole('link', { name: 'Contributors', exact: true })).toBeVisible();
    await expect(page.locator('nav').getByRole('link', { name: 'Console', exact: true })).toBeVisible();
  }
  const ideaCard = page.locator('article.card').first();
  await expect(ideaCard).toBeVisible();
  await expect(ideaCard.getByRole('link', { name: 'Open page' })).toBeVisible();

  await ideaCard.getByRole('link', { name: 'Open page' }).click();

  await expect(page).toHaveURL(/\/ideas\/[^/]+\/$/);
  await expect(page.getByText('Cheap public idea page')).toBeVisible();
  await expect(page.getByText('Store signals')).toBeVisible();
});

test('contributors and console pages are available', async ({ page }) => {
  await page.goto('/contributors/', { waitUntil: 'networkidle' });

  await expect(page.getByText('Contributor reputation.')).toBeVisible();
  await expect(page.getByText('Risk Finder')).toHaveCount(0);
  await expect(page.getByText('Pivot Maker')).toHaveCount(0);
  await expect(page.getByText('Evidence Hunter')).toHaveCount(0);
  await expect(page.getByText('Idea Store Seeder')).toHaveCount(0);

  await page.goto('/console/');

  await expect(page.getByRole('heading', { name: 'Put an idea into the refinery.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in with GitHub' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create idea' })).toBeVisible();
});

test('about and docs pages explain the portal', async ({ page }) => {
  await page.goto('/about/');
  await expect(page.getByRole('heading', { name: 'A public workspace for early ideas.' })).toBeVisible();
  await expect(page.getByText('What belongs here')).toBeVisible();

  await page.goto('/docs/');
  await expect(page.getByRole('heading', { name: 'FreeIdeaStore guide.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Create an idea' })).toBeVisible();
});

test('profile page offers account sign-in controls', async ({ page }) => {
  await page.goto('/profile/');

  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in with GitHub' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in with Google' })).toBeVisible();
});

test('idea detail page is readable on mobile', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile readability check only runs in the mobile project');

  await page.goto('/ideas/asx-filings-analyst/');

  await expect(page.getByRole('heading', { name: 'ASX Filings Analyst' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Research Notes' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Prototype Plan' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to store' })).toBeVisible();
});
