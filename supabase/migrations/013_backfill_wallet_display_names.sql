-- Migration 013: Pre-create wallets + backfill display_name from pending_users
-- ─────────────────────────────────────────────────────────────────────────────
-- Two problems fixed here:
--
-- 1. Wallets are created lazily on first casino visit.  Users who were approved
--    but never opened the casino have no wallet row, so they are invisible to
--    the leaderboard and the Send-Coins modal entirely.
--
-- 2. Migration 012 backfilled display_name from auth.users.raw_user_meta_data
--    which is null for many existing accounts.  The reliable source is
--    pending_users.username — it is written explicitly during signup and is
--    directly joinable via user_id.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Create wallet rows for every approved user who does not have one yet.
--    Starting balance is 1 000 (same as the live code) with no daily-bonus
--    timestamp so their first casino visit awards the bonus normally.
INSERT INTO public.wallets (user_id, balance, display_name)
SELECT
  pu.user_id,
  1000,
  NULLIF(TRIM(pu.username), '')   -- store name now; fall back to NULL if blank
FROM public.pending_users pu
WHERE pu.status = 'approved'
  AND NOT EXISTS (
        SELECT 1 FROM public.wallets w WHERE w.user_id = pu.user_id
      );

-- 2. Backfill display_name for wallets that already exist but have no name yet.
--    Prefer pending_users.username (set at sign-up) over auth metadata.
UPDATE public.wallets w
SET    display_name = NULLIF(TRIM(pu.username), '')
FROM   public.pending_users pu
WHERE  pu.user_id = w.user_id
  AND  TRIM(COALESCE(pu.username, '')) <> ''
  AND (w.display_name IS NULL OR TRIM(w.display_name) = '');

-- 3. For any remaining nulls (e.g. the admin account which may skip pending_users)
--    fall back to auth.users metadata.
UPDATE public.wallets w
SET    display_name = NULLIF(TRIM(u.raw_user_meta_data->>'full_name'), '')
FROM   auth.users u
WHERE  w.user_id = u.id
  AND (w.display_name IS NULL OR TRIM(w.display_name) = '')
  AND  TRIM(COALESCE(u.raw_user_meta_data->>'full_name', '')) <> '';
