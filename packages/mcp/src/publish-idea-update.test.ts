import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ZodTypeAny } from "zod";
import { registerPublishingTools } from "./register-publishing-tools.js";
import type { Env, McpProps, TextResult } from "./mcp-types.js";

type Handler = (input: Record<string, unknown>) => Promise<TextResult>;

let handlers: Record<string, Handler> = {};
let schemas: Record<string, Record<string, ZodTypeAny>> = {};
let requests: Array<{ url: string; init?: RequestInit }> = [];

beforeEach(() => {
  handlers = {};
  schemas = {};
  requests = [];

  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ ok: true, idea: "cellar-door-cycling", url: "/ideas/cellar-door-cycling/" }), {
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

describe("publish_idea_update", () => {
  it("accepts and forwards title in the PATCH body (#31)", async () => {
    expect(schemas.publish_idea_update!.title!.safeParse("Cellar Door Cycling Network").success).toBe(true);

    const result = await call("publish_idea_update", {
      idea_id: "cellar-door-cycling",
      title: "Cellar Door Cycling Network",
    });

    expect(result).toMatchObject({ ok: true, idea: "cellar-door-cycling" });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("https://fis.test/api/ideas/cellar-door-cycling");
    expect(requests[0]!.init?.method).toBe("PATCH");
    expect(JSON.parse(String(requests[0]!.init?.body))).toEqual({
      title: "Cellar Door Cycling Network",
    });
  });
});

/**
 * #106. get_idea -> edit -> publish_idea_update is a read-modify-write across
 * an agent's whole think time. base_version is how the publish says which
 * version it edited, so a write made meanwhile is refused rather than replaced.
 */
describe("publish_idea_update base_version (#106)", () => {
  it("forwards base_version with the body", async () => {
    await call("publish_idea_update", { idea_id: "cellar-door-cycling", body: "## Snapshot\nRewritten in full.", base_version: 7 });

    expect(JSON.parse(String(requests[0]!.init?.body))).toMatchObject({ base_version: 7 });
  });

  it("accepts only a non-negative integer", () => {
    const field = schemas.publish_idea_update!.base_version!;
    expect(field.safeParse(7).success).toBe(true);
    expect(field.safeParse(-1).success).toBe(false);
    expect(field.safeParse(1.5).success).toBe(false);
  });

  it("surfaces a version conflict as an error naming the current version", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({
          error: "the document has changed since base_version 7 — it is now at 8; read it again and reapply your edit",
          conflict: true,
          body_version: 8,
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ));

    const result = await handlers.publish_idea_update!({ idea_id: "cellar-door-cycling", body: "## Snapshot\nStale rewrite.", base_version: 7 });

    expect(result.content[0]!.text).toContain("Error publishing idea update (409)");
    expect(result.content[0]!.text).toContain("it is now at 8");
  });
});
