import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ZodTypeAny } from "zod";
import { registerCollaborationTools } from "./register-collaboration-tools.js";
import { toolNames } from "./tool-registry.js";
import type { Env, McpProps, TextResult } from "./mcp-types.js";

/**
 * #64. The overflow error tells an author to move chapters into a derived
 * annex, and no tool listed the annexes that produced — an agent sharding a
 * corpus as instructed could not enumerate its own shards.
 */

type Handler = (input: Record<string, unknown>) => Promise<TextResult>;

const DERIVED_RESPONSE = {
  idea: "gapfill",
  parent_id: null,
  children: [
    { id: "gapfill-annex-a", title: "Annex A", url: "/ideas/gapfill-annex-a/" },
    { id: "gapfill-annex-b", title: "Annex B", url: "/ideas/gapfill-annex-b/" },
  ],
  total: 4,
  limit: 2,
  offset: 0,
};

let requested: string[] = [];
let handlers: Record<string, Handler> = {};
let schemas: Record<string, Record<string, ZodTypeAny>> = {};
let status = 200;

beforeEach(() => {
  requested = [];
  handlers = {};
  schemas = {};
  status = 200;
  vi.stubGlobal("fetch", async (input: string) => {
    requested.push(String(input));
    const payload = status === 200 ? DERIVED_RESPONSE : { error: "idea not found" };
    return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
  });
  const server = {
    tool: (name: string, _description: string, schema: Record<string, ZodTypeAny>, handler: Handler) => {
      handlers[name] = handler;
      schemas[name] = schema;
    },
  } as unknown as McpServer;
  registerCollaborationTools(
    server,
    { FIS_API_BASE: "https://fis.test", PUBLIC_BASE: "https://fis.test" } as unknown as Env,
    () => ({ token: "t" }) as McpProps,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const raw = async (input: Record<string, unknown>) => (await handlers.list_derived_ideas!(input)).content[0]!.text;

describe("list_derived_ideas (#64)", () => {
  it("reads the derived-children endpoint and returns its page and total", async () => {
    const result = JSON.parse(await raw({ idea_id: "gapfill" }));

    expect(requested).toEqual(["https://fis.test/api/ideas/gapfill/derived"]);
    expect(result.children.map((child: { id: string }) => child.id)).toEqual(["gapfill-annex-a", "gapfill-annex-b"]);
    expect(result.total).toBe(4);
  });

  it("passes limit and offset through for paging", async () => {
    await raw({ idea_id: "gapfill", limit: 2, offset: 2 });

    const url = new URL(requested[0]!);
    expect(url.pathname).toBe("/api/ideas/gapfill/derived");
    expect(url.searchParams.get("limit")).toBe("2");
    expect(url.searchParams.get("offset")).toBe("2");
  });

  it("encodes the idea id into the path", async () => {
    await raw({ idea_id: "a/b idea" });

    expect(requested[0]).toBe("https://fis.test/api/ideas/a%2Fb%20idea/derived");
  });

  it("reports an unknown parent as an error string", async () => {
    status = 404;

    const output = await raw({ idea_id: "nope" });

    expect(output).toContain("Error listing derived ideas (404)");
    expect(output).toContain("idea not found");
  });

  it("rejects a limit outside what the endpoint clamps to", () => {
    expect(schemas.list_derived_ideas!.limit!.safeParse(0).success).toBe(false);
    expect(schemas.list_derived_ideas!.limit!.safeParse(201).success).toBe(false);
    expect(schemas.list_derived_ideas!.limit!.safeParse(200).success).toBe(true);
  });

  it("is registered through the one registry the server and the docs read", () => {
    expect(toolNames()).toContain("list_derived_ideas");
  });
});
