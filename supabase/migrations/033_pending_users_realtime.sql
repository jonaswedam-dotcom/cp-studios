-- Migration 033: Enable Realtime on pending_users
-- Required for the client-side ban enforcement in AppContext.jsx:
-- when an admin revokes a user, the active session picks up the status
-- change via a Realtime subscription and signs them out immediately.
--
-- Run this in the Supabase SQL Editor, then also verify that the
-- pending_users table appears under Database → Replication in the dashboard.

ALTER PUBLICATION supabase_realtime ADD TABLE public.pending_users;
