export interface Env {
  API_BASE?: string;
  GITHUB_TOKEN?: string;
  GITHUB_ORG?: string;
  PLATFORM_REPO?: string;
  PUBLIC_BASE?: string;
  FIS_API_BASE?: string;
  MCP_OBJECT: DurableObjectNamespace;
  SESSION_SIGNING_KEY?: string;
}

export interface McpProps extends Record<string, unknown> {
  userId?: string;
  token?: string;
}

export type TextResult = { content: { type: "text"; text: string }[] };

export const text = (value: string): TextResult => ({ content: [{ type: "text", text: value }] });

export const STAGES = ["raw", "shaping", "researching", "validating", "prototyping", "launched", "pivot", "parked"] as const;
export const CONTRIBUTION_KINDS = ["comment", "evidence", "risk", "pivot", "prototype", "refinement", "kill-signal"] as const;
export const REACTION_TYPES = ["support", "trash", "pivot"] as const;
