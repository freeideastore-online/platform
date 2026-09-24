import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ZodTypeAny } from "zod";
import { registerPublishingTools } from "./register-publishing-tools.js";
import type { Env, McpProps, TextResult } from "./mcp-types.js";

type Handler = (input: Record<string, unknown>) => Promise<TextResult>;

const VALIDATION_RESPONSE = {
  usage: {
    chars: 1210,
    chars_remaining: 998790,
    chapters: 3,
    chapters_remaining: 97,
    below_floor: 3,
    above_ceiling: 0,
  },
  chapters: [
    { id: "snapshot", title: "Snapshot", words: 6, verdict: "merge" },
    { id: "evidence", title: "Evidence", words: 2, verdict: "merge" },
    { id: "bottom-line", title: "Bottom line", words: 7, verdict: "merge" },
  ],
  chapters_created: 2,
  errors: [],
};

let handlers: Record<string, Handler> = {};
let schemas: Record<string, Record<string, ZodTypeAny>> = {};
let requests: Array<{ url: string; init?: RequestInit }> = [];

beforeEach(() => {
  handlers = {};
  schemas = {};
  requests = [];

  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    return new Response(JSON.stringify(VALIDATION_RESPONSE), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  const server = {
    tool: (name: string, _description: string, schema: Record<string, ZodTypeAny>, handler: Handler) => {
      handlers[name] = handler;
      schemas[name] = schema;
    },
  } as unknown as McpServer;

  registerPublishingTools(
    server,
    { FIS_API_BASE: "https://fis.test", PUBLIC_BASE: "https://fis.test" } as unknown as Env,
    () => ({ token: "t" }) as McpProps,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const call = async (tool: string, input: Record<string, unknown>) => JSON.parse((await handlers[tool]!(input)).content[0]!.text);

describe("validate_publication", () => {
  it("posts section operations to the validate endpoint and returns the preflight summary", async () => {
    expect(schemas.validate_publication!.sections.safeParse([
      { mode: "add", title: "Evidence", content: "One finding." },
    ]).success).toBe(true);

    const result = await call("validate_publication", {
      idea_id: "serge-idea-lab",
      mode: "add",
      sections: [{ title: "Evidence", content: "One finding." }],
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("https://fis.test/api/ideas/serge-idea-lab/validate");
    expect(requests[0]!.init?.method).toBe("POST");
    expect(requests[0]!.init?.headers).toMatchObject({ Authorization: "Bearer t" });
    expect(JSON.parse(String(requests[0]!.init?.body))).toEqual({
      mode: "add",
      sections: [{ title: "Evidence", content: "One finding." }],
    });
    expect(result).toEqual({ ok: true, ...VALIDATION_RESPONSE });
  });

  it("surfaces validation errors without hiding usage or chapters", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({
        ...VALIDATION_RESPONSE,
        errors: ["document would have 101 chapters; the free limit is 100"],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const result = await call("validate_publication", {
      idea_id: "serge-idea-lab",
      sections: [{ mode: "add", title: "Evidence" }],
    });

    expect(result.ok).toBe(false);
    expect(result.usage).toEqual(VALIDATION_RESPONSE.usage);
    expect(result.chapters).toEqual(VALIDATION_RESPONSE.chapters);
    expect(result.errors[0]).toContain("free limit");
  });
});
