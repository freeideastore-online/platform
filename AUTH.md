# FreeIdeaStore Authentication

FreeIdeaStore signs people in with GitHub or Google, mints its own session token, and
stores its own identity rows. Every part of that sentence used to belong to another store.
This document describes how the system works now, and why it is shaped the way it is.

## Why FIS owns its identity

FIS originally had no identity of its own. It borrowed FreeAppStore's wholesale:
`/.fis/auth/start` redirected to `api.freeappstore.online`, the FreeAppStore token was
stored verbatim in the FIS session cookie, and every authenticated request re-validated it
by calling `https://api.freeappstore.online/v1/auth/me`. The MCP Worker verified those same
FreeAppStore-signed tokens using a **copy of FreeAppStore's HMAC signing key**. There was no
users, identities, or sessions table anywhere in the schema — `profiles` was keyed by a
handle slug derived from whatever FreeAppStore happened to return.

That arrangement produced [#34](https://github.com/freeideastore-online/platform/issues/34).
The copy of FreeAppStore's key on `freeideastore-mcp` drifted out of sync with
FreeAppStore's own, MCP sign-in started failing with a bare `invalid session`, and **the bug
was not fixable from inside this repo**. Cloudflare Worker secrets are write-only, so the
correct value could not be read back from either service; it existed only inside a
FreeAppStore Worker. The only other repair was to rotate FreeAppStore's key — which would
have re-keyed `freeappstore-api` and logged out every FreeAppStore user in order to fix a
FreeIdeaStore Worker.

A bug in one store that can only be fixed by touching another store is the actual defect.
The shared key was one instance of it; the per-request round trip to `/v1/auth/me` was
another, since FreeAppStore being slow or down took FIS's signed-in experience with it.

So the reason FIS holds duplicate-looking OAuth registrations and a `SESSION_SIGNING_KEY`
with the same name as FreeAppStore's is not oversight or copy-paste. **It is the fix.**
Consolidating them back into one shared key would restore exactly the failure mode #34
describes. If a future change looks like a simplification in that direction, read #34 and
[#39](https://github.com/freeideastore-online/platform/issues/39) first.

Independence here means FIS holds its own client registrations, mints and verifies its own
sessions with its own key, and stores its own identity rows. It does not mean FIS built a
password database — the providers are still GitHub and Google.

## What FIS holds

| Thing | Value | Where it lives |
|---|---|---|
| GitHub OAuth App | client id `Ov23linw5p50f2c1onYZ` | owned by the `freeideastore-online` org |
| GitHub callback | `https://freeideastore.online/.fis/auth/callback/github` | registered with GitHub |
| Google OAuth client | client id `236968108464-6ogtss96ht1f49odbadv5psvonanas0f.apps.googleusercontent.com` | GCP project `freeideastore-online` (`236968108464`) |
| Google callback | `https://freeideastore.online/.fis/auth/callback/google` | registered with Google |
| Session signing key | 64-hex, HS256 | Worker secret on `freeideastore` **and** `freeideastore-mcp` |
| Identity rows | `identities` table | D1 `freeideastore`, migration `0016_identities.sql` |

Both OAuth clients belong to FreeIdeaStore, not to a personal account and not to another
store. The Google client asks only for `openid email profile`; all three scopes are
non-sensitive, which is why the consent screen published without a verification review.
GitHub asks for `read:user user:email` — `user:email` only because GitHub omits a private
address from `/user` and there would otherwise be no handle fallback.

## The sign-in flow

Both providers run the same authorization-code flow, exchanged server-side, implemented in
`packages/worker/src/auth.ts` and `packages/worker/src/oauth-providers.ts`.

**1. `GET /.fis/auth/start?provider=github|google&return_to=…`**

The Worker clamps `return_to` to a same-origin path (`sameOriginPath`), rejecting foreign
origins and any path back under `/.fis/auth` — the latter to prevent a sign-in that loops
into itself. It generates a random `state` nonce and sets it, together with the clamped
return path, in the `__Host-fis_auth_nonce` cookie for 10 minutes, then redirects to the
provider's authorize URL.

The return path travels in the cookie rather than the redirect URI because the redirect URI
has to match the provider's registration byte for byte. Nothing user-controlled can be
smuggled into it.

Google additionally gets `response_type=code` and `prompt=select_account`; without the
latter Google silently picks the first of several signed-in accounts instead of offering
the chooser.

**2. The provider authenticates the user** and redirects back to
`/.fis/auth/callback/<provider>` with `code` and `state`.

**3. `GET /.fis/auth/callback/<provider>`**

- The `state` parameter is compared against the nonce cookie **before** anything else, so a
  request that is already distrusted never costs a code exchange. A mismatch redirects to
  `#auth_error=invalid_state`.
- A missing `code` means the user declined consent or the provider refused —
  `#auth_error=denied`. This is an ordinary outcome, not an error.
- The code is exchanged for a provider access token server-side (`exchangeCode`), and that
  token is used once to fetch the profile: `api.github.com/user` for GitHub (which requires
  a `User-Agent` header or answers 403), `openidconnect.googleapis.com/v1/userinfo` for
  Google. The provider token is never stored and never leaves the Worker. Any failure in
  this step is `#auth_error=provider_error`.
- The profile is normalized into a `ProviderProfile`, `upsertIdentity` finds or creates the
  identity row, a FIS session is minted for `identities.id`, and the browser is redirected
  to the saved return path with the `__Host-fis_session` cookie set for 30 days.

There is no PKCE, deliberately. This is a confidential client: the client secret is a Worker
secret and never reaches the browser, which is the threat PKCE exists to cover for public
clients. The `state` nonce protects the callback, and it is held in an HttpOnly cookie
rather than in memory because a Worker has no memory that survives between the two requests.

**Other routes.** `GET /.fis/auth/me` returns the signed-in user, or 401 — and on 401 it
clears the session cookie, so a token that no longer resolves stops being retried on every
page load. `POST /.fis/auth/logout` clears the cookie and requires a same-origin request
(`isSameOriginMutation`). Both reject other methods with 405.

## The session token

`packages/worker/src/session.ts` mints and verifies. The wire format is:

```
base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload, SESSION_SIGNING_KEY))
```

with the payload `{ uid, roles?, iat, exp }`. `uid` is `identities.id` — deliberately not
the handle, because the handle is a display-level string and the id is not.

**This is not a JWT, on purpose.** There is no header and no `alg` field, so there is no
algorithm to confuse. The verifier can only ever compute HMAC-SHA256; a token claiming
`alg: none` is just a malformed payload. The price is that the token is not interoperable
with off-the-shelf JWT libraries, which nothing in this system needs.

Two other properties are load-bearing:

- **Signature is checked before the payload is parsed.** Unauthenticated attacker-controlled
  JSON is never handed to `JSON.parse`.
- **The signature comparison is constant-time.** A plain `===` returns on the first
  mismatched byte, which leaks enough timing to search for a valid signature one byte at a
  time.

Sessions are **stateless**: the signature is the proof and there is no sessions table to
read. Verification is a few microseconds of local work rather than a network round trip or a
D1 read on every authenticated request — which is the direct answer to the old per-request
call to `/v1/auth/me`. The tradeoff is that a token cannot be revoked before `exp`. If
revocation is ever wanted it belongs in a deny-list keyed on `uid` plus an issued-at floor,
not a lookup on the hot path.

Token lifetime is 30 days (`SESSION_TTL_SECONDS`), matching the cookie's `Max-Age`.

## Identity, profiles, and handle stability

`identities` (migrations `0016` and `0017`) holds `id`, `provider`, `provider_user_id`,
`handle`, `display_name`, `avatar_url`, `email`, `email_verified`, and timestamps. There is
one unique index, on `(provider, provider_user_id)`.

**The index on `handle` is deliberately NOT unique**, and re-adding the constraint would
break account linking — several identities belonging to the same person share one handle on
purpose. Migration `0017` removed it for exactly that reason; `0016` had it, and that is the
state to avoid returning to.

**Matching is on the provider's immutable user id** — GitHub's numeric `id`, Google's `sub`
— never on the login or the email address. People rename their GitHub account and change
their email, and providers reuse both; keying on either eventually hands one person's
account to somebody else. On a returning sign-in, `display_name` and `avatar_url` are
refreshed from the provider, because those are the provider's to change. The handle is not.

**Handle stability is the constraint the whole design bends around.** `profiles.id` is
`profile-<handle>`, and `contributions` and `reactions` reference those profile rows. If a
returning contributor is issued a different handle, their own history silently detaches from
them — nothing errors, the work simply stops being theirs. So:

- A new identity prefers the plain slug of its GitHub login, or of the local part of its
  Google email address. That is exactly what the FreeAppStore-era `normalizeAuthUser` did,
  which is what makes a pre-cutover contributor land back on the profile they already had.
- Creating an identity also does an `INSERT OR IGNORE` into `profiles`, so the handle is
  claimed in both tables at once. `OR IGNORE` means an existing FreeAppStore-era profile row
  is **adopted** rather than overwritten — that adoption is the migration path for existing
  contributors.
- A handle already held by *another identity* is never reassigned. A second person whose
  login also slugs to `alice` gets `alice-github` (provider-qualified, because that says
  something about who the account is, where `alice-2` says nothing), and only then
  `alice-2`, `alice-3`, and so on up to 50 before `upsertIdentity` gives up and throws.

## Account linking

One person signing in with GitHub and with Google would otherwise get two unrelated
contributor profiles, because a handle is minted per provider account. That is not
hypothetical — it happened in production and orphaned 29 items (issue #40).

Before minting a handle for a new identity, `linkedHandle` looks for an existing identity
carrying the **same email address, verified on both sides**. On a match the new identity
adopts that handle, so both provider logins resolve to one profile. Oldest match wins, so
someone with several linkable identities converges on the profile that has been accumulating
work longest.

**The verification requirement is the entire security boundary.** `email_verified = 1` is
checked on the stored row *and* on the incoming profile. Linking on an unverified address
would be an account takeover: register a throwaway account, claim someone else's address,
sign in, inherit their ideas and contributions. This is why GitHub's address comes from
`/user/emails` (primary **and** verified) rather than `/user`, which carries no verification
signal, and why Google's `email_verified` must be literally `true`.

A returning user's `(provider, provider_user_id)` match always wins over any email match, so
a shared or re-issued address cannot move an established identity onto a different profile.

Two known limits, neither of which has a fix in the product today: linking is one-way, with
no unlink path short of manual SQL; and an email address that a provider recycles (Google
Workspace does this, `@gmail.com` does not) would let a new owner inherit the previous
owner's profile.

Note that `availableHandle` checks the `identities` table only. A handle that exists in
`profiles` with no identity behind it is precisely a pre-cutover or anonymous profile, and
being claimable is the intended behaviour, not a gap.

Anonymous contribution still works and is unaffected: `profileFor` falls back to the
`x-idea-handle` request header, and then to `guest`, when there is no session. That header is
only trusted when the caller is unauthenticated — a signed-in caller always gets their
verified handle, so attribution cannot be spoofed by sending the header.

## Secrets and configuration

| Name | Kind | Worker | What it is for |
|---|---|---|---|
| `SESSION_SIGNING_KEY` | Worker secret | `freeideastore`, `freeideastore-mcp` | Signs and verifies FIS session tokens. The same value must be on both, because the site mints and the MCP server verifies. |
| `GH_OAUTH_CLIENT_SECRET` | Worker secret | `freeideastore` | Secret half of the FIS GitHub OAuth App. Used only in the server-side code exchange. |
| `GOOGLE_CLIENT_SECRET` | Worker secret | `freeideastore` | Secret half of the FIS Google OAuth client. Same. |
| `GH_OAUTH_CLIENT_ID` | `wrangler.toml` var | `freeideastore` | Public — it travels in every authorize redirect. |
| `GOOGLE_CLIENT_ID` | `wrangler.toml` var | `freeideastore` | Public, same reason. |

The client ids are public by construction and are therefore version-controlled in
`packages/worker/wrangler.toml` rather than hidden in the secret store, where they would only
create the illusion of being sensitive. The three secrets are managed from `~/dev/ops` and
recorded under the `fis:` section of `inventory.yaml`; `DEPLOY.md` has the commands.

The secret is named `GH_OAUTH_CLIENT_SECRET` rather than `GITHUB_OAUTH_CLIENT_SECRET`
because GitHub rejects secret names beginning `GITHUB_`.

`SESSION_SIGNING_KEY` shares a name with a FreeAppStore secret and is **not** the same value
and not a rotation of it. Rotating FIS's key logs out FIS users only, and must be pushed to
both FIS Workers together — a rotation that reaches the site but not the MCP server
reproduces #34 exactly. That is why the `inventory.yaml` entry names both consumers.

## The MCP Worker

`freeideastore-mcp` runs its own OAuth 2.1 provider for MCP clients — dynamic client
registration, PKCE/S256, and short-lived `authreq:`/`code:` records keyed by nonce. That part
is provider-agnostic and unchanged by any of this.

What changed is the identity behind it. The MCP server does not authenticate anyone itself:
it hands the human off to a browser sign-in, and then verifies the resulting session token
locally with `SESSION_SIGNING_KEY` before issuing its own authorization code. That
verification is where #34 failed, and it now uses FIS's own key. Cutting the browser hand-off
from FreeAppStore over to FIS's own `/.fis/auth/start`, and retiring the `fas_session`
vocabulary that goes with it, is
[#37](https://github.com/freeideastore-online/platform/issues/37).

Because the key on `freeideastore-mcp` is now FIS's own, the MCP server can only verify
FIS-minted tokens. The two halves are not independently deployable: they must agree on both
the key and the issuer.

## The FreeAppStore fallback

The FreeAppStore path has not been deleted yet. It is still reachable in two situations, both
deliberate:

- **Sessions issued before the cutover.** `authUserFor` verifies locally first; a token that
  fails that check falls through to `/v1/auth/me`, so a session minted by the old path keeps
  working until it expires rather than logging someone out mid-visit. (A token that verifies
  but whose identity row no longer exists resolves to nobody — it does not fall through.)
- **A half-configured deploy.** `nativeCredentials` requires a signing key *and* both halves
  of a provider client. If any of those is missing, `/.fis/auth/start` falls back to the
  FreeAppStore redirect instead of failing, which is what keeps a partial deploy from locking
  everyone out. The native callback route, by contrast, answers 503 `sign-in is not
  configured` — by then there is nothing safe left to fall back to.

[#38](https://github.com/freeideastore-online/platform/issues/38) removes this path for good:
`AUTH_API_BASE`, `AUTH_APP_ID`, `fetchAuthPayload`, and the `fas_session` parameter alias all
go, and `grep -ri freeappstore packages/` should return nothing. Until it lands, the fallback
is what makes a cutover problem recoverable. It is not an accident and it is not dead code.

## Diagnosing a failed sign-in

A failed callback redirects the browser back to the return path with an `#auth_error=` code
in the fragment. The fragment is chosen deliberately: it never reaches the server, never
lands in a log or a Referer header, and does not persist into a bookmark of the page. Nothing
in the UI renders these codes today — read them in the address bar.

| Code | Meaning | Usual cause |
|---|---|---|
| `invalid_state` | The `state` parameter did not match the nonce cookie, or the cookie was absent. | The user sat on the provider's consent screen for more than the nonce's 10 minutes; cookies blocked; the callback was replayed or forged. |
| `denied` | The provider came back with no `code`. | The user declined consent, or the provider refused the request. Ordinary, not a defect. |
| `provider_error` | The code exchange or the profile fetch failed. | A wrong or rotated client secret, a redirect URI that no longer matches the registration, a provider outage, or a profile with no usable handle. |
| `missing_session` / `invalid_session` | Legacy FreeAppStore callback only. | Only reachable via the pre-cutover path; #38 removes both. |

Two failure modes that are *not* `#auth_error` codes and are worth recognizing:

- **`sign-in is not configured` (503) from `/.fis/auth/callback/<provider>`** — the Worker is
  missing `SESSION_SIGNING_KEY` or one half of that provider's client. Note that this is a
  configuration gap, not a credential mismatch: a *wrong* secret gets as far as
  `provider_error`.
- **Signed in, then immediately signed out again** — `/.fis/auth/me` returned 401 and cleared
  the cookie. Either the token expired, or it verified against a signing key that has since
  been rotated, or its identity row is gone.

When sign-in breaks, the first question is which flow ran. A redirect to `github.com` or
`accounts.google.com` is the FIS-owned path; a redirect to `api.freeappstore.online` means
the fallback was taken, which means the Worker is missing a credential.
