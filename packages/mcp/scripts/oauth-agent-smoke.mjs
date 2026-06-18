#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const issuer = process.env.MCP_ISSUER || "https://freeideastore-mcp.serge-the-dev.workers.dev";
const endpoint = process.env.MCP_URL || `${issuer}/mcp`;
const redirectUri = process.env.MCP_REDIRECT_URI || "http://127.0.0.1:8792/callback";
const writeSmoke = process.env.WRITE_SMOKE === "1";

function b64url(bytes) {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function challengeFor(verifier) {
  return b64url(createHash("sha256").update(verifier).digest());
}

function textFrom(result) {
  return result.content
    ?.filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n") ?? "";
}

async function registerClient() {
  const response = await fetch(`${issuer}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "FreeIdeaStore MCP OAuth Smoke",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!response.ok) throw new Error(`Client registration failed ${response.status}: ${await response.text()}`);
  return response.json();
}

function waitForCallback(expectedState) {
  const url = new URL(redirectUri);
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      const callbackUrl = new URL(request.url || "/", redirectUri);
      if (callbackUrl.pathname !== url.pathname) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      const state = callbackUrl.searchParams.get("state");
      const code = callbackUrl.searchParams.get("code");
      const error = callbackUrl.searchParams.get("error");
      if (error) {
        response.writeHead(400, { "content-type": "text/plain" });
        response.end(`MCP OAuth failed: ${error}`);
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }
      if (!code || state !== expectedState) {
        response.writeHead(400, { "content-type": "text/plain" });
        response.end("MCP OAuth callback had missing code or invalid state.");
        server.close();
        reject(new Error("OAuth callback missing code or state mismatch"));
        return;
      }
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<!doctype html><title>FreeIdeaStore MCP connected</title><h1>FreeIdeaStore MCP connected.</h1><p>You can return to the terminal.</p>");
      server.close();
      resolve(code);
    });
    server.on("error", reject);
    server.listen(Number(url.port || 80), url.hostname);
    setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for OAuth callback"));
    }, 5 * 60 * 1000).unref();
  });
}

async function exchangeToken({ clientId, code, verifier }) {
  const response = await fetch(`${issuer}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
    }),
  });
  if (!response.ok) throw new Error(`Token exchange failed ${response.status}: ${await response.text()}`);
  return response.json();
}

async function runAuthenticatedAgent(accessToken) {
  const client = new Client({ name: "fis-oauth-smoke-agent", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  await client.connect(transport);
  const listed = await client.listTools();
  const template = await client.callTool({ name: "free_idea_template", arguments: {} });
  const myIdeas = await client.callTool({ name: "my_ideas", arguments: { limit: 100 } });
  const myIdeasText = textFrom(myIdeas);
  const result = {
    tools: listed.tools.map((tool) => tool.name).sort(),
    templateOk: textFrom(template).includes("next_step"),
    myIdeas: JSON.parse(myIdeasText),
  };
  if (writeSmoke) {
    const suffix = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const created = await client.callTool({
      name: "create_free_idea",
      arguments: {
        title: `MCP OAuth Smoke ${suffix}`,
        summary: "Short authenticated MCP smoke-test idea. Safe to ignore.",
        stage: "raw",
        category: "test",
        signal: "Authenticated MCP write path reached the FreeIdeaStore API.",
        next_step: "Confirm this idea appears under the signed-in profile.",
        risk: "Test artifact should not be mistaken for a real idea.",
        body: "## Snapshot\nAuthenticated MCP smoke-test idea.\n\n## Risk\nThis is a test artifact.",
      },
    });
    result.write = JSON.parse(textFrom(created));
  }
  await client.close();
  return result;
}

async function main() {
  const registered = await registerClient();
  const verifier = b64url(randomBytes(32));
  const state = b64url(randomBytes(18));
  const authorize = new URL(`${issuer}/authorize`);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", registered.client_id);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("code_challenge", challengeFor(verifier));
  authorize.searchParams.set("code_challenge_method", "S256");
  authorize.searchParams.set("state", state);

  console.log(JSON.stringify({ step: "open_authorize_url", issuer, endpoint, redirectUri, authorizeUrl: authorize.toString(), writeSmoke }, null, 2));
  const code = await waitForCallback(state);
  const token = await exchangeToken({ clientId: registered.client_id, code, verifier });
  const agent = await runAuthenticatedAgent(token.access_token);
  console.log(JSON.stringify({ ok: true, issuer, endpoint, agent }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
