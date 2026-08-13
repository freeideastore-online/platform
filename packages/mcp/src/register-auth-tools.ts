/**
 * `authenticate` and `complete_authentication` — the in-band half of #26.
 *
 * The sibling `freegamestore` and `proagentstore` servers expose this pair and
 * FreeIdeaStore did not, so an agent that lost write access mid-task had no
 * move available: no tool to call, no URL to hand the user, and nothing to say
 * beyond "requires re-authorization". A migration stopped between creating
 * fifteen chapter shells and filling them, and the shells — reading
 * `(chapter loading)` — sat on a live public page until a human fixed it by
 * hand. Nothing about that failure was unrecoverable except the absence of a
 * recovery path.
 *
 * The pair also answers the quieter half of the same issue: `authenticate`
 * reports `expires_at` and `expires_in_seconds` for the *current* session, so
 * the question "do I have long enough to run this migration?" is answerable
 * before the migration rather than during it.
 *
 * What this pair honestly cannot do: if the MCP client itself decides the
 * server is unauthenticated, it withdraws every tool including these two, and
 * no server-side tool can be called. That path is covered by the other half of
 * the fix — the 401 body now carries `reauthorize_url`, a page that works with
 * no prior tool call and shows a pairing code to hand back.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { hasIdentity } from "./do-auth.js";
import { text, type Env, type McpProps } from "./mcp-types.js";
import type { OAuthStore } from "./oauth-provider.js";
import {
  normalizePairingCode,
  PAIRING_TTL_SECONDS,
  readPairing,
  reauthorizeUrl,
  redeemPairing,
  secondsUntil,
  startPairing,
} from "./reauth.js";
import { MCP_SESSION_TTL_SECONDS } from "./session.js";

/**
 * What these two tools need from the Durable Object they run inside.
 *
 * The other registrars take a read-only `getProps`, because reading identity is
 * all a publishing tool ever does. These two *write* it, and they write it
 * where the rehydration fix reads it back from, so the recovered identity
 * survives the next hibernation as well.
 */
export interface AuthControls {
  /** This server's public origin, for the URL a human has to open. */
  issuer: string;
  /** The shared OAuth record store, where pairings live. */
  store: OAuthStore;
  /** Identity bound to this MCP session right now. */
  current(): McpProps;
  /** Bind an identity to this session, durably. */
  adopt(props: McpProps): Promise<void>;
  beginPairing(code: string): Promise<void>;
  pendingPairing(): Promise<string | undefined>;
  clearPairing(): Promise<void>;
}

/**
 * Below this many seconds left, `authenticate` stops saying "you are signed in"
 * and starts saying "re-authorize before you begin".
 *
 * Half an hour is not a guess about token lifetimes — it is a guess about
 * *tasks*. The migration in #26 wrote fifteen sections; the KB before it wrote
 * five pages. Neither fits in the tail end of a credential.
 */
const RENEW_BELOW_SECONDS = 1800;

const UNAVAILABLE =
  "Authentication tools are unavailable on this server instance. Re-authorize through your MCP client instead.";

function result(payload: Record<string, unknown>) {
  return text(JSON.stringify(payload, null, 2));
}

function isoOrNull(expiresAt: number | undefined): string | null {
  return typeof expiresAt === "number" && expiresAt > 0 ? new Date(expiresAt * 1000).toISOString() : null;
}

/** The identity report both tools end on, so a caller compares like with like. */
function identityReport(props: McpProps): Record<string, unknown> {
  const remaining = secondsUntil(props.expiresAt);
  return {
    authenticated: true,
    user_id: props.userId ?? null,
    expires_at: isoOrNull(props.expiresAt),
    expires_in_seconds: remaining,
    token_lifetime_seconds: MCP_SESSION_TTL_SECONDS,
  };
}

export function registerAuthTools(
  server: McpServer,
  _env: Env,
  _getProps: () => McpProps,
  controls?: AuthControls,
) {
  server.tool(
    "authenticate",
    "Check or renew this MCP session's FreeIdeaStore authorization. Returns the authenticated user and `expires_at` / `expires_in_seconds` when already signed in — call it BEFORE a long multi-write task, such as creating a book's chapters, so you find out you are short of time before you have published half of one. When it returns an authorization_url, give that URL to the user, wait for them to sign in, then call complete_authentication.",
    {
      force: z
        .boolean()
        .optional()
        .describe(
          "Start a fresh sign-in even if this session is already authorized — use it to renew a credential that is about to expire, or to switch to a different account.",
        ),
    },
    async (input) => {
      if (!controls) return result({ error: UNAVAILABLE });
      const props = controls.current();
      const remaining = secondsUntil(props.expiresAt);

      if (hasIdentity(props) && !input.force) {
        const low = remaining !== null && remaining < RENEW_BELOW_SECONDS;
        return result({
          ...identityReport(props),
          renew_recommended: low,
          next_step: low
            ? `This authorization has less than ${Math.round(RENEW_BELOW_SECONDS / 60)} minutes left. Call authenticate with force: true and complete the sign-in before starting a long multi-write task, so it cannot stop part-way through.`
            : "You are signed in and can write. Compare expires_in_seconds against the work you are about to do; if it is short, call authenticate with force: true first.",
          reauthorize_url: reauthorizeUrl(controls.issuer),
        });
      }

      const code = await startPairing(controls.store);
      await controls.beginPairing(code);
      return result({
        authenticated: false,
        authorization_url: reauthorizeUrl(controls.issuer, code),
        pairing_code: code,
        pairing_expires_in_seconds: PAIRING_TTL_SECONDS,
        next_step:
          "Give authorization_url to the user and ask them to sign in with GitHub or Google. Then call complete_authentication — no arguments needed; this session remembers the pairing code. Check the user_id it returns matches the account that owns the documents you are about to write to.",
      });
    },
  );

  server.tool(
    "complete_authentication",
    "Finish a sign-in started by `authenticate`, and bind the resulting FreeIdeaStore identity to this MCP session. Call it once the user says they have signed in. Takes no arguments in the normal case — this session remembers its own pairing code; pass pairing_code only when the user started at the reauthorize page themselves and is reading a code back to you.",
    {
      pairing_code: z
        .string()
        .optional()
        .describe(
          "The FIS-XXXX-XXXX-XXXX code shown after sign-in. The full reauthorize URL is accepted too. Omit it to use the code this session started.",
        ),
    },
    async (input) => {
      if (!controls) return result({ error: UNAVAILABLE });

      const pending = await controls.pendingPairing();
      const supplied = normalizePairingCode(input.pairing_code);
      const code = supplied ?? pending;

      if (!code) {
        return result({
          error: "No sign-in is in progress for this session.",
          next_step: "Call authenticate first to get an authorization_url and a pairing code.",
        });
      }
      // A code this session did not start is a code somebody else is waiting on.
      // Redeeming it here would move their identity onto this session.
      if (pending && supplied && supplied !== pending) {
        return result({
          error: "That pairing code was not started by this session.",
          next_step: "Call authenticate to start a sign-in this session can complete, or omit pairing_code to use the one already in progress.",
        });
      }

      const record = await readPairing(controls.store, code);
      if (!record) {
        await controls.clearPairing();
        return result({
          error: `Pairing code ${code} is unknown or has expired. Codes are valid for ${Math.round(PAIRING_TTL_SECONDS / 60)} minutes.`,
          next_step: "Call authenticate to start a new sign-in.",
        });
      }
      if (record.status !== "ready") {
        return result({
          authenticated: false,
          status: "waiting_for_sign_in",
          authorization_url: reauthorizeUrl(controls.issuer, code),
          next_step:
            "The user has not finished signing in yet. Ask them to open authorization_url and complete it, then call complete_authentication again.",
        });
      }

      const identity = await redeemPairing(controls.store, code);
      if (!identity) {
        return result({
          error: `Pairing code ${code} could not be redeemed. It may have been used already.`,
          next_step: "Call authenticate to start a new sign-in.",
        });
      }

      const props: McpProps = {
        userId: identity.uid,
        token: identity.session,
        expiresAt: identity.expiresAt,
      };
      await controls.adopt(props);
      await controls.clearPairing();

      return result({
        ...identityReport(props),
        next_step:
          "Writes are available again on this session. Confirm user_id owns the documents you are about to change — near-identical handles across GitHub and Google have produced silent wrong-account writes here before.",
      });
    },
  );
}
