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
  await expect(page.getByLabel('Search')).toBeVisible();
  await page.getByLabel('Type').selectOption('pro');
  await expect(page.locator('article.card').first().getByText('Pro candidate')).toBeVisible();
  await page.getByLabel('Search').fill('ASX');
  await expect(page.getByRole('heading', { name: 'ASX Filings Analyst' })).toBeVisible();
  await expect(page.getByText(/1 of \d+ ideas shown/)).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();

  await page.getByLabel('Search').fill('BobaDrop');
  await expect(page.locator('article.card').first().getByText('Publication')).toBeVisible();
  await expect(page.locator('article.card').first().getByText('Needs depth')).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear filters' }).click();

  const ideaCard = page.locator('article.card').first();
  await expect(ideaCard).toBeVisible();
  await expect(ideaCard.getByRole('link', { name: 'Open', exact: true })).toBeVisible();
  await expect(ideaCard.getByRole('link', { name: 'Read', exact: true })).toHaveCount(0);

  await ideaCard.getByRole('link', { name: 'Open', exact: true }).click();

  await expect(page).toHaveURL(/\/ideas\/[^/]+\/$/);
  await expect(page.locator('.book-topbar')).toBeVisible();
  await expect(page.locator('.book-topbar .top-actions')).toHaveCount(0);
  if (!isMobile) {
    await expect(page.locator('.book-topbar .reader-controls')).toBeVisible();
  }
  const topbarText = await page.locator('.book-topbar').innerText();
  expect(topbarText).not.toContain('Overview');
  expect(topbarText).not.toContain('Start reading');
  expect(topbarText).not.toContain('Store');
  expect(topbarText).not.toContain('Docs');
  expect(topbarText).not.toContain('ProIdeaStore');
  if (isMobile) {
    await expect(page.locator('.mobile-book-nav summary')).toBeVisible();
    await page.locator('.mobile-book-nav summary').click();
    await expect(page.locator('.mobile-book-nav .reader-controls')).toBeVisible();
  } else {
    await expect(page.locator('.book-sidebar')).toBeVisible();
    await expect(page.locator('.book-sidebar .chapter-link').first()).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: 'Comments' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Post comment' })).toBeVisible();
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
  await expect(page.locator('meta[name="generator"]')).toHaveAttribute('content', /zensical-/);
  await expect(page.locator('main').getByRole('heading', { name: 'FreeIdeaStore Docs' })).toBeVisible();
  await expect(page.locator('nav.md-nav--primary').getByRole('link', { name: 'Idea Pages' }).first()).toBeVisible();
  await expect(page.locator('nav.md-nav--primary').getByRole('link', { name: 'Publications' }).first()).toBeVisible();

  await page.goto('/docs/idea-pages/');
  await expect(page).toHaveURL(/\/docs\/idea-pages\/$/);
  await expect(page.locator('meta[name="generator"]')).toHaveAttribute('content', /zensical-/);
  await expect(page.locator('main').getByRole('heading', { name: 'Idea Pages' })).toBeVisible();

  await page.goto('/docs/idea-books/');
  await expect(page).toHaveURL(/\/docs\/idea-books\/$/);
  await expect(page.locator('meta[name="generator"]')).toHaveAttribute('content', /zensical-/);
  await expect(page.locator('main h1#publications')).toBeVisible();
  await expect(page.locator('main #universal-two-level-spine')).toBeVisible();
});

test('skills page publishes FIS idea playbooks', async ({ page }) => {
  await page.goto('/skills/');

  await expect(page.getByRole('heading', { name: 'Idea skills for agents and humans.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Default agent flow' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Idea Flow Orchestrator' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Idea Interviewer' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Idea Document Architect' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Idea Critic' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Competitor Finder' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Validation Planner' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Prototype Planner' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Idea Refiner' })).toBeVisible();
  await expect(page.getByText('list_idea_skills')).toBeVisible();
  await expect(page.getByText('apply_idea_skill')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Skill manifest' })).toHaveAttribute('href', '/skills/manifest.json');
  await expect(page.getByRole('link', { name: 'Open Markdown' }).first()).toBeVisible();
});

test('profile page offers account sign-in controls', async ({ page }) => {
  await page.goto('/profile/');

  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in with GitHub' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in with Google' })).toBeVisible();
});

test('dynamic ideas publish multi-page knowledge-base chapters', async ({ page, isMobile }) => {
  await page.goto('/ideas/bobadrop/');

  await expect(page.getByRole('heading', { name: 'BobaDrop' })).toBeVisible();
  if (isMobile) {
    await page.locator('.mobile-book-nav summary').click();
    await expect(page.locator('.mobile-book-nav .chapter-link[href="/ideas/bobadrop/competitors/"]')).toBeVisible();
    await expect(page.locator('.mobile-book-nav a[href="/ideas/bobadrop/snapshot/"]').first()).toBeVisible();
  } else {
    await expect(page.locator('.book-sidebar .chapter-link[href="/ideas/bobadrop/competitors/"]')).toBeVisible();
    await expect(page.locator('.book-sidebar a[href="/ideas/bobadrop/snapshot/"]').first()).toBeVisible();
  }

  await page.goto('/ideas/bobadrop/competitors/');

  await expect(page).toHaveURL(/\/ideas\/bobadrop\/competitors\/$/);
  await expect(page.locator('.book-topbar')).toBeVisible();
  await expect(page.locator('.book-topbar .top-actions')).toHaveCount(0);
  if (!isMobile) {
    await expect(page.locator('.book-topbar .reader-controls')).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: 'Competitors And Similar Services' })).toBeVisible();
  if (isMobile) {
    await page.locator('.mobile-book-nav summary').click();
    await expect(page.locator('.mobile-book-nav .reader-controls')).toBeVisible();
  }
  await expect(page.getByRole('link', { name: /Prototype Plan/ })).toBeVisible();
  if (isMobile) {
    await expect(page.locator('.mobile-book-nav')).toBeVisible();
  } else {
    await expect(page.locator('.book-sidebar')).toBeVisible();
  }
});

test('idea reader switches dark and light themes', async ({ page, isMobile }) => {
  await page.goto('/ideas/bobadrop/user/');
  await page.evaluate(() => localStorage.removeItem('fis:reader-theme'));
  await page.reload();
  if (isMobile) {
    await page.locator('.mobile-book-nav summary').click();
    await expect(page.locator('.mobile-book-nav .reader-controls')).toBeVisible();
  } else {
    await expect(page.locator('.book-topbar > .reader-controls')).toBeVisible();
  }

  await page.getByRole('button', { name: 'Dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-reader-theme', 'dark');
  await expect(page.locator('[data-reader-theme-option="dark"]').first()).toHaveAttribute('aria-pressed', 'true');
  const darkColors = await page.evaluate(() => ({
    body: getComputedStyle(document.body).backgroundColor,
    panel: getComputedStyle(document.querySelector('.chapter-body') || document.body).backgroundColor,
  }));
  expect(darkColors.body).not.toBe('rgb(248, 250, 252)');
  expect(darkColors.panel).not.toBe('rgb(255, 255, 255)');

  await page.getByRole('button', { name: 'Light mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-reader-theme', 'light');
  await expect(page.locator('[data-reader-theme-option="light"]').first()).toHaveAttribute('aria-pressed', 'true');
  const lightColors = await page.evaluate(() => ({
    stored: localStorage.getItem('fis:reader-theme'),
    body: getComputedStyle(document.body).backgroundColor,
    panel: getComputedStyle(document.querySelector('.chapter-body') || document.body).backgroundColor,
    systemButtons: document.querySelectorAll('[data-reader-theme-option="system"]').length,
  }));
  expect(lightColors.stored).toBe('light');
  expect(lightColors.body).toBe('rgb(248, 250, 252)');
  expect(lightColors.panel).toBe('rgb(255, 255, 255)');
  expect(lightColors.systemButtons).toBe(0);
});

test('idea detail page is readable on mobile', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile readability check only runs in the mobile project');

  await page.goto('/ideas/asx-filings-analyst/');

  await expect(page.getByRole('heading', { name: 'ASX Filings Analyst' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Existing Competitors' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Data And Licensing' })).toBeVisible();
  await expect(page.locator('.book-topbar')).toBeVisible();
  const layout = await page.evaluate(() => ({
    viewport: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewport + 1);
  await page.locator('.mobile-book-nav summary').click();
  await expect(page.locator('.mobile-book-nav').getByRole('link', { name: 'Snapshot' })).toBeVisible();
  await expect(page.locator('.mobile-book-nav').getByRole('link', { name: 'Start reading' })).toHaveCount(0);
});
