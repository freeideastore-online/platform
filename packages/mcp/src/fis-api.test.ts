import { afterEach, describe, expect, it, vi } from "vitest";
import { apiErrorMessage, fisApi } from "./fis-api.js";
import type { Env } from "./mcp-types.js";

const env = { FIS_API_BASE: "https://fis.test" } as unknown as Env;
const answer = (body: string, status = 200) =>
  vi.stubGlobal("fetch", async () => new Response(body, { status }));

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * #104. Every tool handler tests `"error" in res.data`. That throws on a JSON
 * `null`, number or string, so those bodies have to arrive as an error object.
 */
describe("fisApi", () => {
  it.each(["null", "42", '"text"'])("turns a non-object JSON body (%s) into an error", async (body) => {
    answer(body, 502);
    const res = await fisApi<{ ok: boolean }>(env, "/api/x");

    expect(res.status).toBe(502);
    expect("error" in res.data).toBe(true);
  });

  it("quotes at most 500 characters of a non-JSON error page", async () => {
    answer(`<html>${"x".repeat(5000)}</html>`, 502);
    const res = await fisApi<{ ok: boolean }>(env, "/api/x");

    expect("error" in res.data && res.data.error.length).toBeLessThanOrEqual(501);
  });

  it("passes an object body through untouched", async () => {
    answer('{"ok":true}');
    await expect(fisApi<{ ok: boolean }>(env, "/api/x")).resolves.toEqual({ ok: true, status: 200, data: { ok: true } });
  });
});

describe("apiErrorMessage", () => {
  it("keeps the tools' error format", () => {
    expect(apiErrorMessage("adding section", { status: 404, data: { error: 'unknown section "x"' } })).toBe(
      'Error adding section (404): unknown section "x"',
    );
    expect(apiErrorMessage("listing sections", { status: 500, data: {} })).toBe("Error listing sections (500): unknown error");
  });
});
