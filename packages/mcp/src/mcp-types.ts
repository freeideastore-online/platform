export interface Env {
  GITHUB_TOKEN?: string;
  GITHUB_ORG?: string;
  PLATFORM_REPO?: string;
  PUBLIC_BASE?: string;
  FIS_API_BASE?: string;
  /** Origin of the FreeIdeaStore site that signs users in for MCP OAuth. */
  FIS_AUTH_BASE?: string;
  MCP_OBJECT: DurableObjectNamespace;
  SESSION_SIGNING_KEY?: string;
  /** This server's own public origin. Durable Objects never see the request URL. */
  MCP_ISSUER?: string;
}

export interface McpProps extends Record<string, unknown> {
  userId?: string;
  token?: string;
  /**
   * When `token` stops working, in seconds since epoch — read off the session
   * payload at the edge so a caller can find out how much time it has *before*
   * it starts a fifteen-write migration rather than after (#26).
   */
  expiresAt?: number;
}

export type TextResult = { content: { type: "text"; text: string }[] };

export const text = (value: string): TextResult => ({ content: [{ type: "text", text: value }] });

export const STAGES = ["raw", "shaping", "researching", "validating", "prototyping", "launched", "pivot", "parked"] as const;
export const CONTRIBUTION_KINDS = ["comment", "evidence", "risk", "pivot", "prototype", "refinement", "kill-signal"] as const;
export const REACTION_TYPES = ["support", "trash", "pivot"] as const;
