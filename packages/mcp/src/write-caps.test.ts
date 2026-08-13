import { readFileSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import type { ZodTypeAny } from "zod";
import { DOCUMENT_CHARS, SECTION_CHARS } from "./limits.js";
import { registerCollaborationTools } from "./register-collaboration-tools.js";
import { registerPublishingTools } from "./register-publishing-tools.js";
import type { Env, McpProps } from "./mcp-types.js";

/**
 * #46, remaining work 2. Six MCP write schemas declared `max(200000)` after the
 * server limit became 1,000,000, and `create_free_idea.body` declared no cap at
 * all — seven fields, because the number was written out seven times and
 * updated in none of them.
 *
 * These assertions are on the ZOD SCHEMAS rather than the source text, so a cap
 * that is present in the file but not actually applied to the field cannot pass.
 */

type Schemas = Record<string, Record<string, ZodTypeAny>>;

function schemasFor(register: (server: McpServer, env: Env, getProps: () => McpProps) => void): Schemas {
  const schemas: Schemas = {};
  const server = {
    tool: (name: string, _description: string, schema: Record<string, ZodTypeAny>) => {
      schemas[name] = schema;
    },
  } as unknown as McpServer;
  register(server, { FIS_API_BASE: "https://fis.test" } as unknown as Env, () => ({ token: "t" }));
  return schemas;
}

const publishing = schemasFor(registerPublishingTools);
const collaboration = schemasFor(registerCollaborationTools);

const field = (schemas: Schemas, tool: string, name: string) => {
  const found = schemas[tool]?.[name];
  if (!found) throw new Error(`${tool}.${name} is not declared`);
  return found;
};

/** Longest value the field accepts, found by binary search over `.safeParse`. */
function declaredCap(schema: ZodTypeAny) {
  const fits = (length: number) => schema.safeParse("x".repeat(length)).success;
  let low = 0;
  let high = DOCUMENT_CHARS * 2;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle)) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** The three fields that replace an entire document. */
const WHOLE_DOCUMENT: Array<[string, Schemas, string, string]> = [
  ["publish_idea_update.body", publishing, "publish_idea_update", "body"],
  ["derive_idea.body", collaboration, "derive_idea", "body"],
  ["create_free_idea.body", collaboration, "create_free_idea", "body"],
];

/** The four fields that write one section of a document. */
const PER_CALL: Array<[string, Schemas, string, string]> = [
  ["patch_idea_section.content", publishing, "patch_idea_section", "content"],
  ["append_to_idea_section.content", publishing, "append_to_idea_section", "content"],
  ["add_idea_section.content", publishing, "add_idea_section", "content"],
  ["apply_refinement.content", publishing, "apply_refinement", "content"],
];

describe("MCP write caps match the server's document budget (#46)", () => {
  it.each(WHOLE_DOCUMENT)("caps %s at the whole document budget", (_label, schemas, tool, name) => {
    expect(declaredCap(field(schemas, tool, name))).toBe(DOCUMENT_CHARS);
  });

  /**
   * A per-call field declaring the document budget is the original bug at a
   * bigger number: a caller reads the per-call cap as the per-call cap. It must
   * be visibly smaller, and it must say so — three agents read `max(200000)` on
   * a section write as the section's allowance when it was the allowance for
   * everything, and a financial model shipped without its P&L.
   */
  it.each(PER_CALL)("caps %s below the document budget", (_label, schemas, tool, name) => {
    const cap = declaredCap(field(schemas, tool, name));

    expect(cap).toBe(SECTION_CHARS);
    expect(cap).toBeLessThan(DOCUMENT_CHARS);
  });

  it.each(PER_CALL)("tells the caller %s is per-call, not the budget", (_label, schemas, tool, name) => {
    const description = field(schemas, tool, name).description || "";

    expect(description).toContain("PER-CALL limit");
    expect(description).toContain("not the document budget");
  });

  /**
   * `@fis/mcp` is a separate Worker bundle and cannot import the worker's
   * `FIELD_LIMITS`, so DOCUMENT_CHARS is a deliberate duplicate. This is the
   * pin that stops it drifting — the failure mode #46 is a report of.
   */
  it("pins DOCUMENT_CHARS to the worker's FIELD_LIMITS.body", () => {
    const http = readFileSync(new URL("../../worker/src/http.ts", import.meta.url), "utf8");
    const limits = http.match(/export const FIELD_LIMITS = \{([\s\S]*?)\n\} as const;/)?.[1];
    expect(limits).toBeTruthy();
    const declared = limits?.match(/^\s*body:\s*([\d_]+),/m)?.[1];
    expect(declared).toBeTruthy();

    expect(Number((declared || "").replace(/_/g, ""))).toBe(DOCUMENT_CHARS);
  });

  it("leaves no hard-coded 200000 behind in either write-tool file", () => {
    const publishingSource = readFileSync(new URL("register-publishing-tools.ts", import.meta.url), "utf8");
    const collaborationSource = readFileSync(new URL("register-collaboration-tools.ts", import.meta.url), "utf8");

    expect(publishingSource).not.toContain("200000");
    expect(collaborationSource).not.toContain("200000");
  });
});
