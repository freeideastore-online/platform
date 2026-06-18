export const AUTH_IN_FLIGHT_COOKIE = "fis_mcp_oauth_inflight";

const AUTH_PROVIDERS = ["github", "google"] as const;
type AuthProvider = (typeof AUTH_PROVIDERS)[number];

type OAuthPageConfig = {
  issuer: string;
  fasAuthStart: string;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[ch]!);
}

export function authProvider(raw: string | null): AuthProvider | null {
  return AUTH_PROVIDERS.includes(raw as AuthProvider) ? (raw as AuthProvider) : null;
}

export function fasAuthStartUrl(config: OAuthPageConfig, nonce: string, provider: AuthProvider): string {
  const fasUrl = new URL(config.fasAuthStart);
  if (provider !== "github") {
    fasUrl.pathname = fasUrl.pathname.replace("/auth/github/", `/auth/${provider}/`);
  }
  fasUrl.searchParams.set("response_mode", "query");
  fasUrl.searchParams.set("app_id", "mcp");
  const callbackUrl = new URL("/oauth/callback", config.issuer);
  callbackUrl.searchParams.set("nonce", nonce);
  fasUrl.searchParams.set("return_to", callbackUrl.toString());
  return fasUrl.toString();
}

export function authAlreadyInProgress(): Response {
  return new Response(
    "<!doctype html><title>FreeIdeaStore sign-in</title><p>FreeIdeaStore MCP sign-in is already in progress in another tab. Complete that sign-in, then return to your MCP client.</p>",
    {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    },
  );
}

export function authConfirmPage(config: OAuthPageConfig, nonce: string, clientName: string | null): Response {
  const continueUrl = (provider: AuthProvider) => {
    const url = new URL("/authorize/continue", config.issuer);
    url.searchParams.set("nonce", nonce);
    url.searchParams.set("provider", provider);
    return url.toString();
  };
  const name = clientName ? escapeHtml(clientName) : "your MCP client";
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Connect FreeIdeaStore MCP</title>
  <style>
    body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#f8fafc;color:#111827}
    main{width:min(100% - 32px,460px);padding:32px;border:1px solid #e5e7eb;border-radius:12px;background:white;box-shadow:0 12px 32px rgba(15,23,42,.08)}
    .brand{font-size:13px;font-weight:800;letter-spacing:0;text-transform:uppercase;color:#0f766e;margin:0 0 10px}
    h1{font-size:24px;line-height:1.2;margin:0 0 12px}
    p{line-height:1.5;margin:0 0 22px;color:#374151}
    .actions{display:flex;gap:10px;flex-wrap:wrap}
    a{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:0 16px;border-radius:8px;background:#111827;color:white;text-decoration:none;font-weight:700}
    a.secondary{background:white;color:#374151;border:1px solid #d1d5db}
  </style>
</head>
<body>
  <main>
    <p class="brand">FreeIdeaStore</p>
    <h1>Connect FreeIdeaStore MCP</h1>
    <p>${name} wants to use FreeIdeaStore MCP tools as your account. Choose how to sign in.</p>
    <div class="actions">
      <a href="${escapeHtml(continueUrl("github"))}" autofocus>Continue with GitHub</a>
      <a class="secondary" href="${escapeHtml(continueUrl("google"))}">Continue with Google</a>
    </div>
  </main>
</body>
</html>`,
    {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Set-Cookie": `${AUTH_IN_FLIGHT_COOKIE}=1; Max-Age=120; Path=/; Secure; HttpOnly; SameSite=Lax`,
      },
    },
  );
}
