import { pathId } from './http';
import { ideaChapters, ideaParts, legacyFlatChapters, type IdeaChapter, type IdeaPart } from './markdown';
import type { Env } from './types';

export const CHAPTER_REDIRECT_LIMIT_PER_IDEA = 256;

type RedirectRow = {
  chapter_id: string;
};

type RedirectPlan = {
  upserts: Array<{ oldId: string; chapterId: string }>;
  repoints: Array<{ fromIds: string[]; chapterId: string }>;
  liveAliases: string[];
  liveTargets: string[];
};

function chapterBody(chapter: IdeaChapter) {
  return chapter.markdown.replace(/^##[^\n]*(?:\n\n?)?/, '').trim().replace(/\s+/g, ' ');
}

function aliases(chapter: IdeaChapter) {
  return Array.from(new Set([chapter.id, ...chapter.aliases])).filter((alias) => pathId(alias));
}

function targetForRetiredChapter(previous: IdeaChapter, nextChapters: IdeaChapter[], nextParts: IdeaPart[]) {
  const previousBody = chapterBody(previous);
  const exact = nextChapters.find((chapter) => chapterBody(chapter) === previousBody);
  if (exact) return exact;

  const sameTitle = nextChapters.find((chapter) => chapter.title === previous.title);
  if (sameTitle) return sameTitle;

  // A chapter that became a part — promoted, or a `#` the #63 rule re-read —
  // has no page any more; its prose is the part's intro, which opens on the
  // part's first chapter. That is where its old URL lands.
  const becamePart = nextParts.find((part) => part.title === previous.title && part.chapterIds.length);
  if (becamePart) {
    const first = nextChapters.find((chapter) => chapter.id === becamePart.chapterIds[0]);
    if (first) return first;
  }

  if (!previousBody) return null;
  return nextChapters.find((chapter) => chapterBody(chapter).includes(previousBody)) ?? null;
}

export function chapterRedirectPlan(
  previousBody: string,
  nextBody: string,
  previousTitle: string,
  nextTitle = previousTitle,
  options: { legacyPrevious?: boolean } = {},
): RedirectPlan {
  const previousChapters = options.legacyPrevious
    ? legacyFlatChapters(previousBody, previousTitle)
    : ideaChapters(previousBody, previousTitle);
  const nextChapters = ideaChapters(nextBody, nextTitle);
  const nextParts = ideaParts(nextBody, nextTitle);
  const liveAliases = Array.from(new Set(nextChapters.flatMap(aliases)));
  const liveAliasSet = new Set(liveAliases);
  const upserts: RedirectPlan['upserts'] = [];
  const repoints: RedirectPlan['repoints'] = [];

  for (const previous of previousChapters) {
    const target = targetForRetiredChapter(previous, nextChapters, nextParts);
    const previousAliases = aliases(previous);
    if (!target) continue;

    repoints.push({ fromIds: previousAliases, chapterId: target.id });
    for (const oldId of previousAliases) {
      if (liveAliasSet.has(oldId) || oldId === target.id) continue;
      upserts.push({ oldId, chapterId: target.id });
    }
  }

  return {
    upserts,
    repoints,
    liveAliases,
    liveTargets: liveAliases,
  };
}

/**
 * The chapter URLs the #63 part rule retired from an unchanged body: every
 * non-title `#` that used to be a chapter and is now a part. Run once per idea
 * by the metrics backfill, in the same deploy as the parser change, so the two
 * live documents whose first chapter was a `#` keep a working URL.
 */
export async function syncPartMigrationRedirects(env: Env, ideaId: string, body: string, title: string) {
  const plan = chapterRedirectPlan(body, body, title, title, { legacyPrevious: true });
  await applyRedirectPlan(env, ideaId, plan);
  return plan.upserts.length;
}

export async function syncChapterRedirects(
  env: Env,
  ideaId: string,
  previousBody: string,
  nextBody: string,
  previousTitle: string,
  nextTitle = previousTitle,
) {
  if (previousBody === nextBody && previousTitle === nextTitle) return;
  await applyRedirectPlan(env, ideaId, chapterRedirectPlan(previousBody, nextBody, previousTitle, nextTitle));
}

async function applyRedirectPlan(env: Env, ideaId: string, plan: RedirectPlan) {

  for (const repoint of plan.repoints) {
    if (!repoint.fromIds.length) continue;
    const placeholders = repoint.fromIds.map(() => '?').join(', ');
    await env.DB.prepare(
      `UPDATE chapter_redirects
       SET chapter_id = ?
       WHERE idea_id = ? AND chapter_id IN (${placeholders})`,
    )
      .bind(repoint.chapterId, ideaId, ...repoint.fromIds)
      .run();
  }

  for (const redirect of plan.upserts) {
    await env.DB.prepare(
      `INSERT INTO chapter_redirects (idea_id, old_id, chapter_id)
       VALUES (?, ?, ?)
       ON CONFLICT(idea_id, old_id) DO UPDATE SET
         chapter_id = excluded.chapter_id,
         created_at = CURRENT_TIMESTAMP`,
    )
      .bind(ideaId, redirect.oldId, redirect.chapterId)
      .run();
  }

  if (plan.liveAliases.length) {
    const placeholders = plan.liveAliases.map(() => '?').join(', ');
    await env.DB.prepare(
      `DELETE FROM chapter_redirects
       WHERE idea_id = ? AND old_id IN (${placeholders})`,
    )
      .bind(ideaId, ...plan.liveAliases)
      .run();
  }

  if (plan.liveTargets.length) {
    const placeholders = plan.liveTargets.map(() => '?').join(', ');
    await env.DB.prepare(
      `DELETE FROM chapter_redirects
       WHERE idea_id = ? AND chapter_id NOT IN (${placeholders})`,
    )
      .bind(ideaId, ...plan.liveTargets)
      .run();
  } else {
    await env.DB.prepare('DELETE FROM chapter_redirects WHERE idea_id = ?')
      .bind(ideaId)
      .run();
  }

  await env.DB.prepare(
    `DELETE FROM chapter_redirects
     WHERE idea_id = ?
       AND old_id IN (
         SELECT old_id FROM chapter_redirects
         WHERE idea_id = ?
         ORDER BY datetime(created_at) DESC, old_id DESC
         LIMIT -1 OFFSET ?
       )`,
  )
    .bind(ideaId, ideaId, CHAPTER_REDIRECT_LIMIT_PER_IDEA)
    .run();
}

export async function chapterRedirectTarget(env: Env, ideaId: string, requestedChapterId: string) {
  const row = await env.DB.prepare(
    `SELECT chapter_id
     FROM chapter_redirects
     WHERE idea_id = ? AND old_id = ?`,
  )
    .bind(ideaId, requestedChapterId)
    .first<RedirectRow>();
  return row?.chapter_id ?? null;
}
