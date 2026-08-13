import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env, McpProps } from "./mcp-types.js";
import { registerAccountTools } from "./register-account-tools.js";
import { registerCollaborationTools } from "./register-collaboration-tools.js";
import { registerDiscoveryTools } from "./register-discovery-tools.js";
import { registerPublishingTools } from "./register-publishing-tools.js";
import { registerSkillTools } from "./register-skill-tools.js";

type Registrar = (server: McpServer, env: Env, getProps: () => McpProps) => void;

/**
 * The one list of registration modules.
 *
 * #72: the server registered 32 tools and advertised 17, because the advertised
 * list was a hand-written restatement of the registrations rather than a reading
 * of them. Every section-write, revision and refinement tool was invisible to an
 * agent deciding what to call — which is the most plausible reason two separate
 * knowledge-base migrations reached for whole-document `publish_idea_update`
 * writes instead of section writes.
 *
 * So the same array both *performs* the registration (`registerAllTools`) and
 * *answers questions about* it (`toolNames`). A tool that is registered is, by
 * construction, a tool that is advertised — there is no second list to forget.
 */
const REGISTRARS: readonly Registrar[] = [
  registerSkillTools,
  registerAccountTools,
  registerCollaborationTools,
  registerPublishingTools,
  registerDiscoveryTools,
];

export function registerAllTools(server: McpServer, env: Env, getProps: () => McpProps): void {
  for (const register of REGISTRARS) register(server, env, getProps);
}

/**
 * Ask the registrars what they register, without standing up a real server.
 *
 * The register-* modules only ever call `server.tool(name, …)`, so a recorder
 * that implements that one method is enough to read the truth back. Passing an
 * empty `Env` is safe because nothing is read from it at registration time —
 * `env` is only touched inside the tool handlers, which never run here.
 */
function collectToolNames(): string[] {
  const names: string[] = [];
  const recorder = {
    tool: (name: string) => {
      names.push(name);
    },
  } as unknown as McpServer;
  registerAllTools(recorder, {} as Env, () => ({}) as McpProps);
  return names;
}

let cached: readonly string[] | undefined;

/** Every tool name this server registers, in registration order. */
export function toolNames(): readonly string[] {
  return (cached ??= Object.freeze(collectToolNames()));
}

/** How many tools this server registers. Reported by `/health`. */
export function toolCount(): number {
  return toolNames().length;
}
