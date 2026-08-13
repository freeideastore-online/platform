import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ZodTypeAny } from "zod";
import { registerPublishingTools } from "./register-publishing-tools.js";
import type { Env, McpProps, TextResult } from "./mcp-types.js";

/**
 * #47. Structural section writes answered with `sections: ideaSectionList(...)`
 * — every chapter of the document, pretty-printed, on every call. #16 justified
 * section-level writes as removing the O(document) token cost per edit; the
 * request side achieved that and the response side did not.
 *
 * The response now carries the compact result plus `usage` and drops the tree.
 * `usage` is NOT part of what is dropped: PR #56 added it deliberately so an
 * agent can see its budget and chapter health, and dropping it would trade one
 * missing signal for another.
 */

type Handler = (input: Record<string, unknown>) => Promise<TextResult>;

const CHAPTERS = 74;

/** A section list the size a real fragmented document produces (#48: 74 chapters). */
const SECTIONS = Array.from({ length: CHAPTERS }, (_, i) => ({
  id: `chapter-${i + 1}`,
  title: `Regional operator profile ${i + 1}`,
  words: 40 + i,
  verdict: i < 60 ? "merge" : "ok",
}));

const USAGE = {
  chars: 184_200,
  chars_remaining: 815_800,
  chapters: CHAPTERS,
  chapters_remaining: 26,
  below_floor: 60,
  above_ceiling: 0,
};

/** What `writeStructuralEdit()` returns: add / edit / merge / delete all share it. */
const STRUCTURAL_RESPONSE = {
  ok: true,
  idea: "cellar-door-cycling",
  revision: "rev-9",
  sections: SECTIONS,
  usage: USAGE,
  url: "/ideas/cellar-door-cycling/",
};

/** What `updateIdeaSection()` returns: no tree, and none should be added. */
const SECTION_WRITE_RESPONSE = {
  ok: true,
  idea: "cellar-door-cycling",
  section: "snapshot",
  mode: "replace",
  words: 412,
  chapters: CHAPTERS,
  usage: USAGE,
  url: "/ideas/cellar-door-cycling/",
};

let handlers: Record<string, Handler> = {};
let schemas: Record<string, Record<string, ZodTypeAny>> = {};
let payload: Record<string, unknown> = STRUCTURAL_RESPONSE;

beforeEach(() => {
  handlers = {};
  schemas = {};
  payload = STRUCTURAL_RESPONSE;
  vi.stubGlobal("fetch", async () =>
    new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } }));

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

const raw = async (tool: string, input: Record<string, unknown>) => (await handlers[tool]!(input)).content[0]!.text;
const call = async (tool: string, input: Record<string, unknown>) => JSON.parse(await raw(tool, input));

/** Every tool that ends in a structural write, with a minimal valid input. */
const STRUCTURAL_TOOLS: Array<[string, Record<string, unknown>]> = [
  ["add_idea_section", { idea_id: "cellar-door-cycling", title: "Regional operator profile 3" }],
  ["edit_idea_section", { idea_id: "cellar-door-cycling", section: "chapter-3", title: "Regional operator profile 3" }],
  ["merge_idea_sections", { idea_id: "cellar-door-cycling", from_section: "chapter-3", into_section: "chapter-2" }],
  ["delete_idea_section", { idea_id: "cellar-door-cycling", section: "chapter-3" }],
];

describe("section writes do not return the document tree (#47)", () => {
  for (const [tool, input] of STRUCTURAL_TOOLS) {
    it(`${tool} omits the section list by default`, async () => {
      const result = await call(tool, input);

      expect(result.sections).toBeUndefined();
      expect(result.sections_omitted).toBe(CHAPTERS);
      expect(result.ok).toBe(true);
    });

    it(`${tool} returns the full tree on verbose: true`, async () => {
      const result = await call(tool, { ...input, verbose: true });

      expect(result.sections).toHaveLength(CHAPTERS);
      expect(result.sections[0].id).toBe("chapter-1");
      // Verbose is the untouched API response: nothing invented, nothing lost.
      expect(result.sections_omitted).toBeUndefined();
      expect(result.note).toBeUndefined();
    });

    it(`${tool} keeps the usage block PR #56 added`, async () => {
      const result = await call(tool, input);

      // The point of #47 is the tree, not the budget. An agent that can no
      // longer see chars_remaining or below_floor has traded one blind spot
      // for another.
      expect(result.usage).toEqual(USAGE);
    });

    it(`${tool} accepts verbose in its schema`, () => {
      expect(schemas[tool]!.verbose!.safeParse(true).success).toBe(true);
    });

    it(`${tool} points at list_idea_sections rather than leaving the tree unreachable`, async () => {
      const result = await call(tool, input);

      expect(result.note).toContain("list_idea_sections");
      expect(result.note).toContain("verbose: true");
    });
  }

  /**
   * The measurement in the issue, made durable. A ten-call consolidation pass
   * used to re-read all 74 rows ten times; the compact response is a fixed
   * handful of fields regardless of how large the document is.
   */
  it("cuts a merge response on a 74-chapter document by more than 90%", async () => {
    const verbose = await raw("merge_idea_sections", {
      idea_id: "cellar-door-cycling",
      from_section: "chapter-3",
      into_section: "chapter-2",
      verbose: true,
    });
    const compact = await raw("merge_idea_sections", {
      idea_id: "cellar-door-cycling",
      from_section: "chapter-3",
      into_section: "chapter-2",
    });

    expect(verbose.length).toBeGreaterThan(9_000);
    expect(compact.length).toBeLessThan(verbose.length * 0.1);
    // Absolute, not only relative: the compact response must not grow with the
    // document at all, and 600 characters cannot hold 74 chapter rows.
    expect(compact.length).toBeLessThan(600);
  });

  it("does not grow with the document", async () => {
    const short = { ...STRUCTURAL_RESPONSE, sections: SECTIONS.slice(0, 3) };
    const input = { idea_id: "cellar-door-cycling", section: "chapter-3" };

    payload = short;
    const small = await raw("delete_idea_section", input);
    payload = STRUCTURAL_RESPONSE;
    const large = await raw("delete_idea_section", input);

    // Only the omitted-count digits differ between a 3- and a 74-chapter
    // document, so the difference is bounded by a couple of characters.
    expect(Math.abs(large.length - small.length)).toBeLessThanOrEqual(2);
  });
});

describe("the id a caller needs next survives the trim (#47)", () => {
  /**
   * The tree was load-bearing for exactly one thing: the id of a section that
   * was just created or renamed. Ids are not derivable from the title on the
   * client — `ideaChapters()` maps some titles onto canonical ids by keyword
   * and resolves collisions with a numbered suffix — so it is read back out of
   * the list instead of guessed.
   */
  it("names the new section id after add_idea_section", async () => {
    const result = await call("add_idea_section", {
      idea_id: "cellar-door-cycling",
      title: "Regional operator profile 3",
    });

    expect(result.section).toBe("chapter-3");
  });

  it("names the new section id after a rename", async () => {
    const result = await call("edit_idea_section", {
      idea_id: "cellar-door-cycling",
      section: "chapter-40",
      title: "Regional operator profile 7",
    });

    expect(result.section).toBe("chapter-7");
  });

  it("reports every candidate rather than guessing when two chapters share a title", async () => {
    payload = {
      ...STRUCTURAL_RESPONSE,
      sections: [
        { id: "risk", title: "Risk", words: 90, verdict: "ok" },
        { id: "risk-2", title: "Risk", words: 90, verdict: "ok" },
      ],
    };

    const result = await call("add_idea_section", { idea_id: "cellar-door-cycling", title: "Risk" });

    expect(result.section).toBeUndefined();
    expect(result.section_candidates).toEqual(["risk", "risk-2"]);
  });

  it("claims no section when a move names no title", async () => {
    const result = await call("edit_idea_section", {
      idea_id: "cellar-door-cycling",
      section: "chapter-3",
      after: "chapter-9",
    });

    expect(result.section).toBeUndefined();
    expect(result.section_candidates).toBeUndefined();
  });
});

describe("responses that never carried a tree are passed through (#47)", () => {
  for (const tool of ["patch_idea_section", "append_to_idea_section"]) {
    it(`${tool} returns the API result unchanged`, async () => {
      payload = SECTION_WRITE_RESPONSE;

      const result = await call(tool, {
        idea_id: "cellar-door-cycling",
        section: "snapshot",
        content: "Replacement prose for the snapshot chapter.",
      });

      expect(result).toEqual(SECTION_WRITE_RESPONSE);
    });
  }

  /**
   * The stripping runs on these paths too, so an API that starts returning a
   * tree here is trimmed by construction rather than by someone noticing.
   */
  it("strips a tree from a section replace if the API ever starts sending one", async () => {
    payload = { ...SECTION_WRITE_RESPONSE, sections: SECTIONS };

    const result = await call("patch_idea_section", {
      idea_id: "cellar-door-cycling",
      section: "snapshot",
      content: "Replacement prose for the snapshot chapter.",
    });

    expect(result.sections).toBeUndefined();
    expect(result.sections_omitted).toBe(CHAPTERS);
  });

  it("leaves a no-change structural response alone, including its own note", async () => {
    payload = { ok: true, idea: "cellar-door-cycling", note: "no change" };

    const result = await call("delete_idea_section", { idea_id: "cellar-door-cycling", section: "chapter-3" });

    expect(result).toEqual({ ok: true, idea: "cellar-door-cycling", note: "no change" });
  });
});
