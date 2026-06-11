import { expect, test } from '@playwright/test';

test('homepage loads idea cards and navigates to a dynamic idea page', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Ideas earn builders.' })).toBeVisible();
  const ideaCard = page.locator('article.card').first();
  await expect(ideaCard).toBeVisible();
  await expect(ideaCard.getByRole('link', { name: 'Open page' })).toBeVisible();

  await ideaCard.getByRole('link', { name: 'Open page' }).click();

  await expect(page).toHaveURL(/\/ideas\/[^/]+\/$/);
  await expect(page.getByText('Cheap public idea page')).toBeVisible();
  await expect(page.getByText('Store signals')).toBeVisible();
});

test('idea detail page is readable on mobile', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile readability check only runs in the mobile project');

  await page.goto('/ideas/asx-filings-analyst/');

  await expect(page.getByRole('heading', { name: 'ASX Filings Analyst' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Research Notes' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Prototype Plan' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to store' })).toBeVisible();
});
