import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ZodTypeAny } from "zod";
import { registerAccountTools } from "./register-account-tools.js";
import type { Env, McpProps, TextResult } from "./mcp-types.js";

/**
 * #66. `get_idea` returned the entire canonical body and the entire, unpaged
 * contribution history on every call. One real idea answers that request with
 * 195,546 characters, against a 1,000,000-character body ceiling — roughly a
 * quarter of a million tokens into the caller's context from one tool call,
 * with no parameter that would have prevented it.
 *
 * The default is now `body: 'none'`. That is a BREAKING change for any caller
 * reading the `body` field, and it is the point: a safe option nobody sets is
 * not a fix.
 */

type Handler = (input: Record<string, unknown>) => Promise<TextResult>;

let requested: string[] = [];
let handler: Handler;
let schema: Record<string, ZodTypeAny>;
let description = "";

const IDEA_RESPONSE = {
  idea: { id: "cellar-door-cycling", title: "Cellar Door Cycling" },
  body: null,
  body_view: "none",
  sections: [{ id: "snapshot", title: "Snapshot", words: 700, verdict: "ok" }],
  usage: { chars: 195_546, chars_remaining: 804_454, chapters: 12, chapters_remaining: 88, below_floor: 0, above_ceiling: 0 },
  url: "/ideas/cellar-door-cycling/",
};

const CONTRIBUTIONS_RESPONSE = { contributions: [{ id: "contribution-1" }], total: 45, limit: 20, offset: 0 };

beforeEach(() => {
  requested = [];
  vi.stubGlobal("fetch", async (input: string) => {
    requested.push(String(input));
    const payload = String(input).includes("/contributions") ? CONTRIBUTIONS_RESPONSE : IDEA_RESPONSE;
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  });

  const server = {
    tool: (name: string, toolDescription: string, toolSchema: Record<string, ZodTypeAny>, toolHandler: Handler) => {
      if (name !== "get_idea") return;
      description = toolDescription;
      schema = toolSchema;
      handler = toolHandler;
    },
  } as unknown as McpServer;
  registerAccountTools(server, { FIS_API_BASE: "https://fis.test", PUBLIC_BASE: "https://fis.test" } as unknown as Env, () => ({ token: "t" }) as McpProps);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const call = async (input: Record<string, unknown>) => JSON.parse((await handler(input)).content[0]!.text);

describe("get_idea size controls (#66)", () => {
  it("asks the API for no body when the caller does not say", async () => {
    await call({ idea_id: "cellar-door-cycling" });

    expect(requested).toEqual(["https://fis.test/api/ideas/cellar-door-cycling?body=none"]);
  });

  it("asks the API for the view the caller named", async () => {
    await call({ idea_id: "cellar-door-cycling", body: "preamble" });
    await call({ idea_id: "cellar-door-cycling", body: "full" });

    expect(requested[0]).toContain("?body=preamble");
    expect(requested[1]).toContain("?body=full");
  });

  /**
   * Filtering server-side is the whole saving. Fetching the document and
   * dropping the field here would still pull it across the wire.
   */
  it("never requests the idea without a body view", async () => {
    await call({ idea_id: "cellar-door-cycling", body: "none" });

    expect(requested[0]).not.toBe("https://fis.test/api/ideas/cellar-door-cycling");
  });

  it("keeps body as an explicit null so a caller indexing into it fails loudly", async () => {
    const result = await call({ idea_id: "cellar-door-cycling" });

    expect("body" in result).toBe(true);
    expect(result.body).toBeNull();
  });

  it("returns the chapter list and the document budget in place of the body", async () => {
    const result = await call({ idea_id: "cellar-door-cycling" });

    expect(result.sections.map((section: { id: string }) => section.id)).toEqual(["snapshot"]);
    expect(result.usage.chars).toBe(195_546);
    expect(result.url).toBe("https://fis.test/ideas/cellar-door-cycling/");
  });

  it("rejects a body view the API does not serve", () => {
    expect(schema.body!.safeParse("summary").success).toBe(false);
    for (const view of ["none", "preamble", "full"]) {
      expect(schema.body!.safeParse(view).success).toBe(true);
    }
  });

  it("leads the description with the changed default", () => {
    expect(description).toContain("NOT the document");
    expect(description).toContain("body: 'full'");
    expect(description).toContain("usage.chars");
  });
});

describe("get_idea pages contribution history (#66)", () => {
  it("fetches nothing extra when contributions were not asked for", async () => {
    const result = await call({ idea_id: "cellar-door-cycling" });

    expect(requested).toHaveLength(1);
    expect(result.contributions).toEqual([]);
    expect(result.contributions_total).toBeUndefined();
  });

  /**
   * This call used to pass no limit at all, and the endpoint is explicit that
   * no limit means every row. `gapfill` already carries 45 entries of up to
   * 8,000 characters each.
   */
  it("pages at 20 by default", async () => {
    await call({ idea_id: "cellar-door-cycling", include_contributions: true });

    expect(requested[1]).toBe("https://fis.test/api/ideas/cellar-door-cycling/contributions?limit=20&offset=0");
  });

  it("passes the caller's page through", async () => {
    await call({ idea_id: "cellar-door-cycling", include_contributions: true, contributions_limit: 5, contributions_offset: 40 });

    expect(requested[1]).toBe("https://fis.test/api/ideas/cellar-door-cycling/contributions?limit=5&offset=40");
  });

  it("reports the total so the caller knows what it did not receive", async () => {
    const result = await call({ idea_id: "cellar-door-cycling", include_contributions: true, contributions_limit: 5 });

    expect(result.contributions_total).toBe(45);
    expect(result.contributions_limit).toBe(5);
    expect(result.contributions_offset).toBe(0);
  });
});
