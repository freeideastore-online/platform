import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ZodTypeAny } from "zod";
import { registerCollaborationTools } from "./register-collaboration-tools.js";
import { registerPublishingTools } from "./register-publishing-tools.js";
import type { Env, McpProps, TextResult } from "./mcp-types.js";

/**
 * #111. The Worker files every signed-in write under the caller's own identity
 * and ignores contributor_handle for it, but these tools replied naming the
 * handle the caller passed — telling a signed-in user that "bob" owned the fork
 * they had just made.
 */

type Handler = (input: Record<string, unknown>) => Promise<TextResult>;

function tools(props: McpProps) {
  const handlers: Record<string, Handler> = {};
  const server = {
    tool: (name: string, _description: string, _schema: Record<string, ZodTypeAny>, handler: Handler) => {
      handlers[name] = handler;
    },
  } as unknown as McpServer;
  const env = { FIS_API_BASE: "https://fis.test", PUBLIC_BASE: "https://fis.test" } as unknown as Env;
  registerCollaborationTools(server, env, () => props);
  registerPublishingTools(server, env, () => props);
  return handlers;
}

function stubApi(payload: Record<string, unknown>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  return calls;
}

const text = async (handler: Handler | undefined, input: Record<string, unknown>) => (await handler!(input)).content[0]!.text;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MCP replies name the account that actually wrote (#111)", () => {
  const signedIn: McpProps = { token: "t", userId: "identity-42" };

  it("reports the signed-in identity as the owner of a fork, not contributor_handle", async () => {
    stubApi({ idea: "fork", url: "/ideas/fork/", parent: "parent", parentUrl: "/ideas/parent/" });

    const out = JSON.parse(await text(tools(signedIn).derive_idea, { idea_id: "parent", contributor_handle: "bob" }));

    expect(out.owner_user_id).toBe("identity-42");
    expect(JSON.stringify(out)).not.toContain("bob");
  });

  it.each([
    ["add_idea_contribution", { idea_id: "x", body: "A finding worth recording.", contributor_handle: "bob" }],
    ["propose_idea_refinement", { idea_id: "x", section: "snapshot", proposal: "Sharper wording.", rationale: "It is vague.", contributor_handle: "bob" }],
    ["react_to_idea", { idea_id: "x", type: "support", contributor_handle: "bob" }],
  ])("%s reports the signed-in identity", async (tool, input) => {
    stubApi({ ok: true });

    const out = JSON.parse(await text(tools(signedIn)[tool], input));

    expect(out.attributed_to_user_id).toBe("identity-42");
    expect(JSON.stringify(out)).not.toContain("bob");
  });
});

describe("promote_to_pro_candidate (#111)", () => {
  it("says sign-in is required instead of calling the Worker anonymously", async () => {
    const calls = stubApi({ ok: true });

    const out = await text(tools({}).promote_to_pro_candidate, { idea_id: "x" });

    expect(out).toContain("authentication required");
    expect(calls).toHaveLength(0);
  });
});
