/**
 * Durable Object auth state for one MCP session.
 *
 * A streamable-HTTP MCP session is one Durable Object, named after the session
 * id. The caller's identity arrives on the HTTP request — `Authorization:
 * Bearer <access token>` resolved to a FIS session by `authenticateRequest` —
 * and is handed to that object through `setAuth`. Every tool handler then reads
 * it back through `getProps`.
 *
 * The failure this file exists to prevent (#26): that identity was held only in
 * the object's memory. Cloudflare evicts an idle Durable Object and reconstructs
 * it on the next request, so an authoring session that paused — to read output,
 * to think, to draft — came back with no identity at all and every subsequent
 * write failed as "requires re-authorization", while the access token and the
 * session behind it were both still valid. Failures tracked idle time, not
 * elapsed time, which is why they looked like a token expiry that no TTL in the
 * codebase explained.
 *
 * Two rules follow, and both are the point of this module:
 *
 * 1. **Auth is written to Durable Object storage and read back from it.** The
 *    write on its own is not a fix; a value that is never read is a value that
 *    does not exist. `rehydrate()` is called from `init()`, which runs on every
 *    reconstruction of the object — precisely the moment the memory was lost.
 *
 * 2. **A failed write is logged, never swallowed.** This used to be a bare
 *    `catch {}` with a comment reasoning that the in-memory copy was enough for
 *    the next tool call. It is enough for the next tool call and nothing after
 *    it, and because the catch was silent, a storage layer that had stopped
 *    accepting writes would look exactly like a working one until a session
 *    hibernated.
 *
 * The storage key is FIS-owned and deliberately not `props`. The `agents` SDK
 * writes `props` itself — `_init(ctx.props)` stores `{}` at session start,
 * because FIS populates identity from its own bearer token rather than from the
 * `ctx.props` an OAuth-provider wrapper would supply — and `onStart()` assigns
 * whatever it finds there straight over `this.props`. Keeping FIS's copy under
 * its own key means the SDK's lifecycle can never overwrite a live identity with
 * an empty one.
 */

import type { McpProps } from "./mcp-types.js";

/** Where this session's resolved auth lives in Durable Object storage. */
export const AUTH_PROPS_KEY = "fis:auth-props";

/** The slice of `DurableObjectStorage` this module needs, so tests can fake it. */
export interface AuthStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
}

/**
 * Does this carry an identity, as opposed to being the empty object a tool
 * handler treats as "unauthenticated"?
 */
export function hasIdentity(props: McpProps | null | undefined): props is McpProps {
  return typeof props?.token === "string" && props.token.length > 0;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Auth for one session, held in memory and backed by Durable Object storage. */
export class SessionAuth {
  private props: McpProps | null = null;

  constructor(private readonly storage: AuthStorage) {}

  /**
   * Record the identity for this session.
   *
   * Returns whether the durable copy was written, so a caller that cares can
   * tell "authenticated and it will survive hibernation" from "authenticated
   * until this object is evicted".
   */
  async set(props: McpProps): Promise<boolean> {
    this.props = props;
    try {
      await this.storage.put(AUTH_PROPS_KEY, props);
      return true;
    } catch (error) {
      // Not silent: without this line, a storage layer refusing writes is
      // indistinguishable from a healthy one until a session hibernates and
      // every tool call starts demanding re-authorization (#26).
      console.error(
        `mcp auth: could not persist session auth to Durable Object storage — this session will lose its identity if the object hibernates (${reason(error)})`,
      );
      return false;
    }
  }

  /**
   * Restore identity after the Durable Object was reconstructed.
   *
   * A live in-memory identity always wins: on a wake the worker calls `setAuth`
   * with the credentials from the current request before the object's `init()`
   * runs, and those are fresher than anything on disk.
   */
  async rehydrate(): Promise<boolean> {
    if (hasIdentity(this.props)) return true;
    try {
      const stored = await this.storage.get<McpProps>(AUTH_PROPS_KEY);
      if (!hasIdentity(stored)) return false;
      this.props = stored;
      return true;
    } catch (error) {
      console.error(`mcp auth: could not read session auth back from Durable Object storage (${reason(error)})`);
      return false;
    }
  }

  /** What tool handlers see. Empty means unauthenticated, never undefined. */
  current(): McpProps {
    return this.props ?? {};
  }
}
