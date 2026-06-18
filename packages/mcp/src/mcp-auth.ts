import { resolveOAuthToken, type OAuthStore } from "./oauth-provider.js";
import type { Env, McpProps } from "./mcp-types.js";

function decodeUid(token: string): string | undefined {
  try {
    const b64 = token.split(".")[0]?.replace(/-/g, "+").replace(/_/g, "/") || "";
    const json = JSON.parse(atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=")));
    return typeof json.uid === "string" ? json.uid : undefined;
  } catch {
    return undefined;
  }
}

export async function authenticateRequest(request: Request, env: Env): Promise<McpProps> {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return {};
  let token = auth.slice(7).trim();
  if (!token) return {};

  const session = await resolveOAuthToken(token, oauthStore(env));
  if (session) token = session;

  return { userId: decodeUid(token), token };
}

type OAuthObject = {
  oauthGet(key: string): Promise<string | null>;
  oauthPut(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  oauthDelete(key: string): Promise<void>;
};

function oauthObject(env: Env): OAuthObject {
  const id = env.MCP_OBJECT.idFromName("oauth");
  return env.MCP_OBJECT.get(id) as unknown as OAuthObject;
}

export function oauthStore(env: Env): OAuthStore {
  const object = oauthObject(env);
  return {
    get: (key) => object.oauthGet(key),
    put: (key, value, options) => object.oauthPut(key, value, options),
    delete: (key) => object.oauthDelete(key),
  };
}
