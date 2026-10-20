import { authIdentityIdFor } from './auth';
import { json } from './http';
import type { Env } from './types';

/**
 * Who may call `/api/admin/*` (#105).
 *
 * The admin routes re-read every idea body or every contribution and rewrite
 * store-wide state. They used to check only that the caller was signed in, so
 * anyone who signed in with GitHub could run them in a loop and spend the
 * store's D1 and R2 quota.
 *
 * Admins are listed by **identity id** in the `ADMIN_IDENTITY_IDS` secret
 * (comma- or whitespace-separated), not by handle. The id is what a session is
 * signed for and nobody can claim one by signing up; a handle is a display
 * name, and near-identical handles across GitHub and Google have already
 * produced wrong-account confusion here.
 *
 * Fails closed: with the secret unset or empty, every admin route answers 403.
 */
export function adminIdentityIds(env: Env): Set<string> {
  return new Set((env.ADMIN_IDENTITY_IDS || '').split(/[\s,]+/).filter(Boolean));
}

/**
 * Null when the caller is an admin; otherwise the response to send instead —
 * 401 for no valid session, 403 for anyone else, and a 403 that says so when
 * no admin is configured at all.
 */
export async function adminRefusal(request: Request, env: Env): Promise<Response | null> {
  const identityId = await authIdentityIdFor(request, env);
  if (!identityId) return json({ error: 'authentication required' }, { status: 401 });
  const admins = adminIdentityIds(env);
  if (!admins.size) {
    return json({ error: 'admin routes are disabled: ADMIN_IDENTITY_IDS is not configured' }, { status: 403 });
  }
  if (!admins.has(identityId)) return json({ error: 'admin only' }, { status: 403 });
  return null;
}
