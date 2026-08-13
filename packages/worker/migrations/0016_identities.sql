-- FIS-owned identities.
--
-- Until this table existed FreeIdeaStore stored no identity at all. `profiles`
-- is keyed by a `handle` slug that was derived from whatever FreeAppStore
-- returned, so nothing recorded which provider account a contributor actually
-- is, and "who is this?" could only be answered by asking another store's API
-- (see #39). That made FIS sign-in fail when a FreeAppStore key rotated (#34).
--
-- `handle` is the join to `profiles.handle` rather than a foreign key, because
-- profile rows are created lazily on first contribution and an identity can
-- exist before one does. Both columns are UNIQUE, so the pairing stays 1:1.
--
-- Handles must survive the cutover: `profiles.id` is 'profile-<handle>' and both
-- `contributions` and `reactions` reference it, so a returning user landing on a
-- different handle would silently detach their own history. The UNIQUE
-- constraint here is what stops a second provider account claiming a handle that
-- already belongs to someone.
CREATE TABLE IF NOT EXISTS identities (
  id TEXT PRIMARY KEY,
  -- 'github' | 'google'
  provider TEXT NOT NULL,
  -- The provider's own immutable user id, NOT the login or email. Logins and
  -- email addresses get changed by their owners and reused by the provider;
  -- keying on them would eventually hand one person's account to someone else.
  provider_user_id TEXT NOT NULL,
  handle TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS identities_provider_user
  ON identities (provider, provider_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS identities_handle
  ON identities (handle);
