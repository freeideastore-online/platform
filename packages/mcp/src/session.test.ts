import { afterEach, describe, expect, it, vi } from "vitest";
import { inspectSession, mintSession, verifySession, type SessionPayload } from "./session.js";

async function sign(payload: SessionPayload, keyMaterial = "test-signing-key") {
  const body = b64url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(keyMaterial),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `${body}.${b64urlBytes(new Uint8Array(sig))}`;
}

function b64url(value: string) {
  return b64urlBytes(new TextEncoder().encode(value));
}

function b64urlBytes(bytes: Uint8Array) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodePayload(token: string): SessionPayload {
  const body = token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(body.padEnd(body.length + ((4 - (body.length % 4)) % 4), "="))) as SessionPayload;
}

describe("verifySession", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepts a valid signed session token", async () => {
    vi.setSystemTime(new Date("2026-06-01T00:00:00Z"));
    const token = await sign({ uid: "user-1", roles: ["creator"], iat: 1_780_272_000, exp: 1_780_275_600 });

    await expect(verifySession(token, "test-signing-key")).resolves.toMatchObject({
      uid: "user-1",
      roles: ["creator"],
    });
  });

  it("rejects tampered or expired session tokens", async () => {
    vi.setSystemTime(new Date("2026-06-01T00:00:00Z"));
    const valid = await sign({ uid: "user-1", iat: 1_780_272_000, exp: 1_780_275_600 });
    const expired = await sign({ uid: "user-1", iat: 1, exp: 2 });

    await expect(verifySession(`${valid}x`, "test-signing-key")).resolves.toBeNull();
    await expect(verifySession(expired, "test-signing-key")).resolves.toBeNull();
    await expect(verifySession("not-a-token", "test-signing-key")).resolves.toBeNull();
  });
});

describe("inspectSession", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // The distinction #34 needed and did not have: one of these is a user who
  // waited too long, the other is two workers disagreeing about the key.
  it("tells expiry apart from a signature that does not match", async () => {
    vi.setSystemTime(new Date("2026-06-01T00:00:00Z"));
    const expired = await sign({ uid: "user-1", iat: 1, exp: 2 });
    const foreign = await sign({ uid: "user-1", iat: 1_780_272_000, exp: 1_780_275_600 }, "another-key");

    await expect(inspectSession(expired, "test-signing-key")).resolves.toEqual({ ok: false, reason: "expired" });
    await expect(inspectSession(foreign, "test-signing-key")).resolves.toEqual({ ok: false, reason: "bad_signature" });
  });

  it("reports anything unparseable as malformed rather than guessing", async () => {
    await expect(inspectSession("", "test-signing-key")).resolves.toEqual({ ok: false, reason: "malformed" });
    await expect(inspectSession("no-dot", "test-signing-key")).resolves.toEqual({ ok: false, reason: "malformed" });
    // A key this worker does not have makes every token unverifiable, which must
    // not be reported as the user's token being wrong.
    await expect(inspectSession("a.b", "")).resolves.toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects a correctly signed token with no identity in it", async () => {
    const anonymous = await sign({ iat: 1_780_272_000, exp: 4_000_000_000 } as unknown as SessionPayload);

    await expect(inspectSession(anonymous, "test-signing-key")).resolves.toEqual({ ok: false, reason: "malformed" });
  });
});

describe("mintSession", () => {
  it("round-trips through verification", async () => {
    const token = await mintSession("identity-1", "test-signing-key", { roles: ["creator"] });

    await expect(verifySession(token, "test-signing-key")).resolves.toMatchObject({
      uid: "identity-1",
      roles: ["creator"],
    });
  });

  it("defaults to the access-token lifetime and honours an explicit TTL", async () => {
    const now = 1_780_272_000;
    const standard = await mintSession("identity-1", "test-signing-key", { now });
    const brief = await mintSession("identity-1", "test-signing-key", { now, ttlSeconds: 300 });

    expect(decodePayload(standard).exp - now).toBe(86_400);
    expect(decodePayload(brief).exp - now).toBe(300);
  });

  it("refuses to sign without an identity or a key", async () => {
    await expect(mintSession("", "test-signing-key")).rejects.toThrow("uid is required");
    await expect(mintSession("identity-1", "")).rejects.toThrow("signingKey is required");
  });

  it("produces a token another key cannot verify", async () => {
    // The shape of #34: two services, two different values for one key.
    const token = await mintSession("identity-1", "one-key");

    await expect(verifySession(token, "another-key")).resolves.toBeNull();
  });
});
