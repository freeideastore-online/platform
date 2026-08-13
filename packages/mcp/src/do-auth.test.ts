import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTH_PROPS_KEY, hasIdentity, SessionAuth, type AuthStorage } from "./do-auth.js";
import type { McpProps } from "./mcp-types.js";

/**
 * Durable Object storage, minus the object.
 *
 * The point of the fake is that the map outlives the `SessionAuth` built on top
 * of it, which is exactly the relationship hibernation creates: Cloudflare
 * throws away the instance and keeps the storage.
 */
class FakeStorage implements AuthStorage {
  readonly data = new Map<string, unknown>();
  failWrites = false;
  failReads = false;

  async get<T>(key: string): Promise<T | undefined> {
    if (this.failReads) throw new Error("storage unavailable");
    return this.data.get(key) as T | undefined;
  }

  async put(key: string, value: unknown): Promise<void> {
    if (this.failWrites) throw new Error("storage unavailable");
    this.data.set(key, value);
  }
}

const CALLER: McpProps = { userId: "identity-1", token: "fis-session-token" };

describe("session auth across hibernation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("survives the Durable Object being evicted and reconstructed", async () => {
    const storage = new FakeStorage();

    // 1. A request arrives carrying a valid token; the worker hands it over.
    const live = new SessionAuth(storage);
    await live.set(CALLER);
    expect(live.current()).toEqual(CALLER);

    // 2. The session goes idle. Cloudflare evicts the object, so every field on
    //    it is gone. Only what was written to storage remains.
    const woken = new SessionAuth(storage);
    expect(woken.current()).toEqual({});

    // 3. The next request reconstructs the object, which runs init().
    await woken.rehydrate();

    // Before #26 this was `{}`, and the tool that ran next told a caller with a
    // perfectly valid token that it required re-authorization.
    expect(woken.current()).toEqual(CALLER);
    expect(hasIdentity(woken.current())).toBe(true);
  });

  it("persists the auth under a key the agents SDK does not also write", async () => {
    // The SDK stores its own `props` and overwrites it with `{}` at session
    // start, since FIS takes identity from its bearer token rather than from
    // `ctx.props`. A shared key would let that empty write erase a live
    // identity on the next wake.
    const storage = new FakeStorage();

    await new SessionAuth(storage).set(CALLER);

    expect(storage.data.get(AUTH_PROPS_KEY)).toEqual(CALLER);
    expect(storage.data.has("props")).toBe(false);
  });

  it("keeps the identity from the current request over the stored one", async () => {
    // On a wake the worker calls setAuth with the credentials on the request
    // before init() runs. Those are fresher than the copy on disk — a caller who
    // re-authenticated as a different account must not be served the old one.
    const storage = new FakeStorage();
    await new SessionAuth(storage).set(CALLER);

    const woken = new SessionAuth(storage);
    const reauthenticated: McpProps = { userId: "identity-2", token: "newer-session-token" };
    await woken.set(reauthenticated);
    await woken.rehydrate();

    expect(woken.current()).toEqual(reauthenticated);
  });

  it("reports a persistence failure instead of swallowing it", async () => {
    // The old code caught this and said nothing, reasoning that memory was
    // enough for the next tool call. It is, and for nothing after it — so a
    // storage layer refusing writes looked healthy right up until a session
    // hibernated and stopped accepting writes for no visible reason.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const storage = new FakeStorage();
    storage.failWrites = true;

    const auth = new SessionAuth(storage);
    const persisted = await auth.set(CALLER);

    expect(persisted).toBe(false);
    // The call in flight still works; only the durability is lost.
    expect(auth.current()).toEqual(CALLER);
    expect(error.mock.calls.map((call) => String(call[0])).join("\n")).toContain("storage unavailable");
  });

  it("reports a rehydration failure instead of reporting no identity", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const storage = new FakeStorage();
    await new SessionAuth(storage).set(CALLER);
    storage.failReads = true;

    const woken = new SessionAuth(storage);
    await expect(woken.rehydrate()).resolves.toBe(false);
    expect(woken.current()).toEqual({});
    expect(error.mock.calls.map((call) => String(call[0])).join("\n")).toContain("storage unavailable");
  });

  it("treats a session that never authenticated as unauthenticated", async () => {
    const woken = new SessionAuth(new FakeStorage());

    await expect(woken.rehydrate()).resolves.toBe(false);
    expect(woken.current()).toEqual({});
    expect(hasIdentity(woken.current())).toBe(false);
  });
});

describe("hasIdentity", () => {
  it("requires a non-empty token", () => {
    expect(hasIdentity(undefined)).toBe(false);
    expect(hasIdentity(null)).toBe(false);
    expect(hasIdentity({})).toBe(false);
    expect(hasIdentity({ token: "" })).toBe(false);
    expect(hasIdentity({ userId: "identity-1" })).toBe(false);
    expect(hasIdentity(CALLER)).toBe(true);
  });
});
