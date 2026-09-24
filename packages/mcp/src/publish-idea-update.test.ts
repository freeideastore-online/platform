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
