import { expect, test } from '@playwright/test';

test('homepage loads idea cards and navigates to a dynamic idea page', async ({ page, isMobile }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Ideas earn builders.' })).toBeVisible();
  if (!isMobile) {
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
  await expect(page.getByText('Risk Finder')).toBeVisible();

  await page.getByRole('link', { name: 'Risk Finder' }).click();
  await expect(page).toHaveURL(/\/contributors\/risk-finder\/$/);
  await expect(page.getByText('Profile strength')).toBeVisible();
  await expect(page.getByText('Contribution mix')).toBeVisible();

  await page.goto('/console/');

  await expect(page.getByRole('heading', { name: 'Put an idea into the refinery.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in with GitHub' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create idea' })).toBeVisible();
});

test('idea detail page is readable on mobile', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile readability check only runs in the mobile project');

  await page.goto('/ideas/asx-filings-analyst/');

  await expect(page.getByRole('heading', { name: 'ASX Filings Analyst' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Research Notes' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Prototype Plan' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to store' })).toBeVisible();
});
