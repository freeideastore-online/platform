import { afterEach, describe, expect, it, vi } from "vitest";
import { verifySession, type SessionPayload } from "./session.js";

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
