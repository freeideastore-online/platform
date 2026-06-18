import { handleAiProxy } from './ai-proxy';
import { handleApi } from './api';
import { renderConsolePage } from './console-page';
import type { Env } from './types';
import { renderContributorPage, renderContributorsPage } from './contributor-pages';
import { handleAuth } from './auth';
import { renderAccountPage } from './account-page';
import { renderIdeasCatalogPage } from './idea-catalog-page';
import { renderIdeaChapterPage } from './idea-chapter-page';
import { renderIdeaPage } from './idea-home-page';
import { json, pathId, SECURITY_HEADERS } from './http';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    const authResponse = await handleAuth(request, url);
    if (authResponse) return authResponse;

    if (url.pathname === '/api/ai/elaborate') {
      try {
        return await handleAiProxy(request, env);
      } catch (error) {
        return json({ error: 'internal error' }, { status: 500 });
      }
    }

    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (error) {
        return json({ error: 'internal error' }, { status: 500 });
      }
    }

    const ideaSectionMatch = url.pathname.match(/^\/ideas\/([^/]+)\/([^/]+)\/?$/);
    if (ideaSectionMatch) {
      try {
        const ideaId = pathId(ideaSectionMatch[1] || '');
        const sectionId = pathId(ideaSectionMatch[2] || '');
        if (!ideaId || !sectionId) return new Response('Idea not found', { status: 404, headers: SECURITY_HEADERS });
        return await renderIdeaChapterPage(env, request, ideaId, sectionId);
      } catch (error) {
        return json({ error: 'internal error' }, { status: 500 });
      }
    }

    if (url.pathname === '/ideas' || url.pathname === '/ideas/') {
      try {
        return await renderIdeasCatalogPage(env, request);
      } catch (error) {
        return json({ error: 'internal error' }, { status: 500 });
      }
    }

    const ideaPageMatch = url.pathname.match(/^\/ideas\/([^/]+)\/?$/);
    if (ideaPageMatch) {
      try {
        const ideaId = pathId(ideaPageMatch[1] || '');
        if (!ideaId) return new Response('Idea not found', { status: 404, headers: SECURITY_HEADERS });
        return await renderIdeaPage(env, request, ideaId);
      } catch (error) {
        return json({ error: 'internal error' }, { status: 500 });
      }
    }

    if (url.pathname === '/console' || url.pathname === '/console/') {
      return renderConsolePage(request);
    }

    if (url.pathname === '/contributors' || url.pathname === '/contributors/') {
      try {
        return await renderContributorsPage(env, request);
      } catch (error) {
        return json({ error: 'internal error' }, { status: 500 });
      }
    }

    if (url.pathname === '/profile' || url.pathname === '/profile/') {
      try {
        return await renderAccountPage(env, request);
      } catch (error) {
        return json({ error: 'internal error' }, { status: 500 });
      }
    }

    const contributorPageMatch = url.pathname.match(/^\/(?:contributors|users)\/([^/]+)\/?$/);
    if (contributorPageMatch) {
      try {
        const handle = pathId(contributorPageMatch[1] || '');
        if (!handle) return new Response('Contributor not found', { status: 404, headers: SECURITY_HEADERS });
        return await renderContributorPage(env, request, handle);
      } catch (error) {
        return json({ error: 'internal error' }, { status: 500 });
      }
    }

    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};
