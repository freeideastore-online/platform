-- One person, one profile — across providers.
--
-- 0016 gave every identity its own handle and made `identities.handle` UNIQUE.
-- That reads as a safety property, and for a while it was: it stopped a second
-- provider account walking onto a handle that already belonged to someone else.
-- What it also did was hard-code the assumption that a handle belongs to exactly
-- one provider account, i.e. that a person only ever signs in one way. That is
-- not true of anybody who has both a GitHub account and a Google account, and
-- FIS offers both. Signing in the other way produced a second, empty contributor
-- profile and left the real one behind (#40).
--
-- The fix is to let several identities point at the SAME handle. The handle stays
-- exactly what it was — the profile this identity resolves to — so every reader
-- downstream (authUserFor, profileFor, registeredProfileFor, ownedIdea, the
-- contributor pages) keys on the same string it always did and needs no change.
-- The relationship simply becomes many-to-one instead of one-to-one.
--
-- WHAT BREAKS IF SOMEONE RE-ADDS THE UNIQUE INDEX. It will look like a missing
-- constraint to anyone reading the schema cold, because a non-unique index on a
-- column named `handle` next to a UNIQUE `profiles.handle` looks like an
-- oversight. It is not. Restoring uniqueness would make the second INSERT in
-- `upsertIdentity`'s linking path fail with a constraint error at the exact
-- moment a returning contributor signs in with their other provider — every
-- cross-provider sign-in becomes `provider_error` at the callback, and the only
-- way to sign in again is with the provider that happened to get there first.
-- Worse, it cannot be un-run cleanly: by then the table legitimately contains
-- duplicate handles, so the CREATE UNIQUE INDEX itself fails and the migration
-- wedges. If handle collisions between *different people* are the worry, that is
-- still handled — `availableHandle` varies the handle whenever there is no
-- verified-email match, which is the only situation in which two rows may share
-- a handle by accident rather than on purpose.
DROP INDEX IF EXISTS identities_handle;

-- Still indexed, just not unique: `availableHandle` probes this column on every
-- first sign-in, and the linking lookup below reads it back.
CREATE INDEX IF NOT EXISTS identities_handle ON identities (handle);

-- The email the provider told us about, lower-cased, and whether the provider
-- asserted it was verified.
--
-- This is the ONLY thing two identities are allowed to be linked on, and the
-- verified flag is the whole of the security argument. An unverified address is
-- a string the account holder typed; anyone can put `victim@example.com` on a
-- throwaway Google account, sign in, and be handed the victim's profile,
-- contributions and ideas. So `email_verified` defaults to 0 and is set to 1
-- only when the provider says so explicitly — `email_verified: true` from
-- Google's userinfo, or an entry in GitHub's /user/emails that is both
-- `primary` and `verified`. Anything ambiguous stays 0 and simply does not link.
--
-- Storing it here rather than on `profiles` is deliberate: an email belongs to
-- the provider account, not to the display-level profile, and two identities
-- sharing a handle may legitimately carry two different verified addresses.
ALTER TABLE identities ADD COLUMN email TEXT;
ALTER TABLE identities ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;

-- Existing rows keep email NULL, which is correct: nothing recorded an address
-- before now and we must not invent one. They backfill themselves on the owner's
-- next sign-in, so linking becomes available to them a sign-in later rather than
-- immediately. A backfill from the providers is not possible — the access tokens
-- were never stored.
CREATE INDEX IF NOT EXISTS identities_email ON identities (email);

-- NOT TOUCHED, and must stay: the unique (provider, provider_user_id) pair.
--
-- That index is the one carrying real weight. It is what makes a returning
-- sign-in resolve to the row it already had, and what stops one provider account
-- accumulating several identity rows and several handles. Email matching runs
-- only when this lookup misses, and never overrides it.
