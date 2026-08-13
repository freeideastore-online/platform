export const AUTH_IN_FLIGHT_COOKIE = "fis_mcp_oauth_inflight";

const AUTH_PROVIDERS = ["github", "google"] as const;
type AuthProvider = (typeof AUTH_PROVIDERS)[number];

type OAuthPageConfig = {
  issuer: string;
  authStartUrl: string;
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

/**
 * The sign-in URL on the FreeIdeaStore site that this flow hands the browser to.
 *
 * `response_mode=query` asks the site to put the minted session on the redirect
 * rather than only in its cookie — our callback is on a different origin and
 * would never see that cookie. The site permits it only for allowlisted origins,
 * and `return_to` is what it matches against; the nonce rides along so the
 * callback can find the authorization request it belongs to.
 *
 * The provider is a parameter here. FreeAppStore had a per-provider path
 * (`/v1/auth/github/start`) that this function used to rewrite by hand; FIS
 * exposes one endpoint and selects the provider with `?provider=`.
 */
export function authStartRedirect(config: OAuthPageConfig, nonce: string, provider: AuthProvider): string {
  const startUrl = new URL(config.authStartUrl);
  startUrl.searchParams.set("provider", provider);
  startUrl.searchParams.set("response_mode", "query");
  const callbackUrl = new URL("/oauth/callback", config.issuer);
  callbackUrl.searchParams.set("nonce", nonce);
  startUrl.searchParams.set("return_to", callbackUrl.toString());
  return startUrl.toString();
}

/**
 * Ties an authorization request to the browser that started it.
 *
 * The cookie carries the nonce itself, and `/oauth/callback` refuses any nonce
 * that does not match it. Without that check the nonce is just a string in a URL
 * that anyone may present: an attacker can register a client of their own
 * (registration is open), call `/authorize` to mint a nonce bound to *their*
 * redirect_uri, then send a victim to the site's sign-in with `return_to` set to
 * this server's callback carrying that nonce. The victim signs in, their session
 * arrives here against the attacker's authorization request, and the code is
 * handed to the attacker's redirect_uri — an account takeover costing one click.
 *
 * The lifetime matches the `authreq:` record it guards. The old two minutes was
 * shorter than a real sign-in takes, which was survivable only because nothing
 * depended on the cookie still being there.
 */
export function authInFlightCookie(nonce: string): string {
  return `${AUTH_IN_FLIGHT_COOKIE}=${nonce}; Max-Age=600; Path=/; Secure; HttpOnly; SameSite=Lax`;
}

const PAGE_STYLES = `
    body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#f8fafc;color:#111827}
    main{width:min(100% - 32px,460px);padding:32px;border:1px solid #e5e7eb;border-radius:12px;background:white;box-shadow:0 12px 32px rgba(15,23,42,.08)}
    .brand{font-size:13px;font-weight:800;letter-spacing:0;text-transform:uppercase;color:#0f766e;margin:0 0 10px}
    h1{font-size:24px;line-height:1.2;margin:0 0 12px}
    p{line-height:1.5;margin:0 0 22px;color:#374151}
    .actions{display:flex;gap:10px;flex-wrap:wrap}
    a{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:0 16px;border-radius:8px;background:#111827;color:white;text-decoration:none;font-weight:700}
    a.secondary{background:white;color:#374151;border:1px solid #d1d5db}`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${PAGE_STYLES}
  </style>
</head>
<body>
  <main>
    <p class="brand">FreeIdeaStore</p>
${body}
  </main>
</body>
</html>`;
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
    page(
      "Connect FreeIdeaStore MCP",
      `    <h1>Connect FreeIdeaStore MCP</h1>
    <p>${name} wants to use FreeIdeaStore MCP tools as your account. Choose how to sign in.</p>
    <div class="actions">
      <a href="${escapeHtml(continueUrl("github"))}" autofocus>Continue with GitHub</a>
      <a class="secondary" href="${escapeHtml(continueUrl("google"))}">Continue with Google</a>
    </div>`,
    ),
    {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Set-Cookie": authInFlightCookie(nonce),
      },
    },
  );
}

/**
 * The page a person lands on when sign-in fails part-way through.
 *
 * #34 surfaced as the plain-text body `invalid session` on a blank page, which
 * told the user nothing about what to do and told us nothing about what broke.
 * `headline` is what went wrong, `advice` is the next action — and the two are
 * kept separate so the wording can name a cause without ever promising the user
 * a fix that is actually ours to make.
 */
export function authErrorPage(headline: string, advice: string, status = 400): Response {
  return new Response(
    page(
      "FreeIdeaStore MCP sign-in failed",
      `    <h1>${escapeHtml(headline)}</h1>
    <p>${escapeHtml(advice)}</p>`,
    ),
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        // The in-flight guard would otherwise keep every retry from this browser
        // stuck on "already in progress" for its full two minutes.
        "Set-Cookie": `${AUTH_IN_FLIGHT_COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`,
      },
    },
  );
}
