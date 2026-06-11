DELETE FROM reactions
WHERE profile_id IN (
  'profile-risk-finder',
  'profile-pivot-maker',
  'profile-evidence-hunter'
)
OR profile_id IN (SELECT id FROM profiles WHERE handle IN ('risk-finder', 'pivot-maker', 'evidence-hunter', 'cloudflare-smoke'));

DELETE FROM contributions
WHERE profile_id IN (
  'profile-risk-finder',
  'profile-pivot-maker',
  'profile-evidence-hunter'
)
OR profile_id IN (SELECT id FROM profiles WHERE handle IN ('risk-finder', 'pivot-maker', 'evidence-hunter', 'cloudflare-smoke'));

DELETE FROM profiles
WHERE id IN (
  'profile-risk-finder',
  'profile-pivot-maker',
  'profile-evidence-hunter'
)
OR handle IN ('risk-finder', 'pivot-maker', 'evidence-hunter', 'cloudflare-smoke');
