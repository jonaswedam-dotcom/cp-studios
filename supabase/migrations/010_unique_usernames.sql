-- Migration 010: Enforce unique usernames on the profiles table
-- ─────────────────────────────────────────────────────────────────────────────
-- Creates a case-insensitive unique index on profiles.full_name so that no two
-- profile rows can share the same name (ignoring capitalisation).
--
-- The index uses lower(full_name) so "Alice", "alice", and "ALICE" are treated
-- as the same name and the insert/update will fail with a unique-violation error.
--
-- Frontend checks (CreateProfilePage + Navbar) query for an existing match
-- *before* attempting the insert/update and surface a friendly error message,
-- so the database constraint is a final safety net rather than the primary UX.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS profiles_full_name_lower_idx
  ON public.profiles (lower(full_name));
