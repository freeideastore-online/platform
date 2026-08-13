import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ZodTypeAny } from "zod";
import { registerDiscoveryTools } from "./register-discovery-tools.js";
import { toolNames } from "./tool-registry.js";
import type { Env, McpProps, TextResult } from "./mcp-types.js";

/**
 * #65. `indexDocument()` writes one FTS row per chapter and
 * `syncDocumentSources()` links every URL to its section, both rebuilt on every
 * canonical write, and both already served at `/api/search`,
 * `/api/ideas/:id/sources` and `/api/sources/:id`. No MCP tool called any of
 * them, so the agent building the corpus was the only party unable to query it.
 */

type Handler = (input: Record<string, unknown>) => Promise<TextResult>;

const SEARCH_RESPONSE = {
  query: "ETIM",
  match: "ETIM",
  hits: [
    {
      idea_id: "cellar-door-cycling",
      kind: "section",
      ref: "regional-operators",
      title: "Regional operators",
      snippet: "…already lists <mark>ETIM</mark> classifications…",
      rank: -4.2,
      idea_title: "Cellar Door Cycling",
      superseded: false,
    },
  ],
};

const SOURCES_RESPONSE = {
  idea: "cellar-door-cycling",
  sources: [
    {
      id: "src-1",
      url: "https://example.test/report.pdf",
      host: "example.test",
      status: 404,
      last_checked: "2026-08-01T00:00:00Z",
      sections: ["regional-operators", "risk"],
      contribution_citations: 2,
    },
  ],
};

const SOURCE_RESPONSE = {
  source: { id: "src-1", url: "https://example.test/report.pdf", host: "example.test", status: 404, last_checked: "2026-08-01T00:00:00Z" },
  citations: [{ idea_id: "cellar-door-cycling", title: "Cellar Door Cycling", section: "risk", contribution_id: "" }],
};

let requested: string[] = [];
let handlers: Record<string, Handler> = {};
let schemas: Record<string, Record<string, ZodTypeAny>> = {};
let descriptions: Record<string, string> = {};
let status = 200;
let payload: unknown = SEARCH_RESPONSE;

beforeEach(() => {
  requested = [];
  handlers = {};
  schemas = {};
  descriptions = {};
  status = 200;
  vi.stubGlobal("fetch", async (input: string) => {
    requested.push(String(input));
    const url = String(input);
    payload = url.includes("/api/search")
      ? SEARCH_RESPONSE
      : url.includes("/sources/")
        ? SOURCE_RESPONSE
        : SOURCES_RESPONSE;
    if (status !== 200) payload = { error: "source not found" };
    return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
  });

  const server = {
    tool: (name: string, description: string, schema: Record<string, ZodTypeAny>, handler: Handler) => {
      handlers[name] = handler;
      schemas[name] = schema;
      descriptions[name] = description;
    },
  } as unknown as McpServer;
  registerDiscoveryTools(
    server,
    { FIS_API_BASE: "https://fis.test", PUBLIC_BASE: "https://fis.test" } as unknown as Env,
    () => ({ token: "t" }) as McpProps,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const raw = async (tool: string, input: Record<string, unknown>) => (await handlers[tool]!(input)).content[0]!.text;
const call = async (tool: string, input: Record<string, unknown>) => JSON.parse(await raw(tool, input));

describe("search_ideas (#65)", () => {
  it("queries the search endpoint the write path keeps rebuilding", async () => {
    await call("search_ideas", { query: "ETIM" });

    expect(requested).toEqual(["https://fis.test/api/search?q=ETIM"]);
  });

  it("scopes to one idea and honours a limit", async () => {
    await call("search_ideas", { query: "regional operator", idea_id: "cellar-door-cycling", limit: 5 });

    const url = new URL(requested[0]!);
    expect(url.pathname).toBe("/api/search");
    expect(url.searchParams.get("q")).toBe("regional operator");
    expect(url.searchParams.get("idea")).toBe("cellar-door-cycling");
    expect(url.searchParams.get("limit")).toBe("5");
  });

  it("sends no idea or limit parameter when the caller gave none", async () => {
    await call("search_ideas", { query: "ETIM" });

    const url = new URL(requested[0]!);
    expect(url.searchParams.has("idea")).toBe(false);
    expect(url.searchParams.has("limit")).toBe(false);
  });

  it("escapes a query rather than splicing it into the URL", async () => {
    await call("search_ideas", { query: "cellar door & bikes" });

    expect(requested[0]).toBe("https://fis.test/api/search?q=cellar+door+%26+bikes");
    expect(new URL(requested[0]!).searchParams.get("q")).toBe("cellar door & bikes");
  });

  it("returns each hit's ref, which is the argument read_idea_section takes", async () => {
    const result = await call("search_ideas", { query: "ETIM" });

    expect(result.hits[0].ref).toBe("regional-operators");
    expect(result.hits[0].kind).toBe("section");
    expect(result.hits[0].idea_id).toBe("cellar-door-cycling");
    expect(result.hits[0].snippet).toContain("<mark>ETIM</mark>");
  });

  it("rejects a limit outside what the endpoint clamps to", () => {
    expect(schemas.search_ideas!.limit!.safeParse(0).success).toBe(false);
    expect(schemas.search_ideas!.limit!.safeParse(51).success).toBe(false);
    expect(schemas.search_ideas!.limit!.safeParse(50).success).toBe(true);
    expect(schemas.search_ideas!.limit!.safeParse(2.5).success).toBe(false);
  });

  it("tells the caller a hit's ref is directly actionable", () => {
    expect(descriptions.search_ideas).toContain("read_idea_section");
  });
});

describe("list_idea_sources (#65)", () => {
  it("reads the per-idea source registry", async () => {
    await call("list_idea_sources", { idea_id: "cellar-door-cycling" });

    expect(requested).toEqual(["https://fis.test/api/ideas/cellar-door-cycling/sources"]);
  });

  it("encodes the idea id into the path", async () => {
    await call("list_idea_sources", { idea_id: "a/b idea" });

    expect(requested[0]).toBe("https://fis.test/api/ideas/a%2Fb%20idea/sources");
  });

  it("surfaces decay to the author, not only the sections citing it", async () => {
    const result = await call("list_idea_sources", { idea_id: "cellar-door-cycling" });

    // #25: a source that 404s still reads as evidence in the prose. `status`
    // and `last_checked` are the only thing that says otherwise.
    expect(result.sources[0].status).toBe(404);
    expect(result.sources[0].last_checked).toBe("2026-08-01T00:00:00Z");
    expect(result.sources[0].sections).toEqual(["regional-operators", "risk"]);
  });
});

describe("get_source (#65)", () => {
  it("reads the reverse index for one source", async () => {
    const result = await call("get_source", { source_id: "src-1" });

    expect(requested).toEqual(["https://fis.test/api/sources/src-1"]);
    expect(result.citations[0].idea_id).toBe("cellar-door-cycling");
    expect(result.citations[0].section).toBe("risk");
  });

  it("reports a failure as an error string rather than as a result", async () => {
    status = 404;

    const output = await raw("get_source", { source_id: "nope" });

    expect(output).toContain("Error reading source (404)");
    expect(output).toContain("source not found");
  });
});

describe("the discovery tools are registered, not just written (#65)", () => {
  it("is reachable through the one registry the server and the docs read", () => {
    // A register module that is never added to REGISTRARS compiles, passes its
    // own unit tests, and is invisible to every client. #72 is that failure in
    // the other direction.
    for (const name of ["search_ideas", "list_idea_sources", "get_source"]) {
      expect(toolNames()).toContain(name);
    }
  });
});
