-- Migration 007: Coin donations between players
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds a donations log table and a SECURITY DEFINER RPC that atomically
-- transfers coins from sender → recipient, bypassing the per-user wallet RLS
-- in a controlled way (all validation is inside the function).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── donations table ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.donations (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id    uuid        NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  recipient_id uuid        NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  amount       integer     NOT NULL CHECK (amount > 0),
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.donations ENABLE ROW LEVEL SECURITY;

-- Users can see donations they sent or received
CREATE POLICY "donations_select_participants"
  ON public.donations FOR SELECT
  TO authenticated
  USING (auth.uid() = sender_id OR auth.uid() = recipient_id);

-- Users can only insert donations they are sending
CREATE POLICY "donations_insert_sender"
  ON public.donations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = sender_id);

-- ── donate_coins RPC ──────────────────────────────────────────────────────────
-- SECURITY DEFINER: runs as the function owner (postgres) so it can update
-- any wallet row, even though the regular wallets_update_own policy would
-- block updating a different user's row. All safety checks happen inside.
CREATE OR REPLACE FUNCTION public.donate_coins(
  p_recipient_id uuid,
  p_amount       integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender_id      uuid    := auth.uid();
  v_sender_balance integer;
BEGIN
  -- Basic sanity checks
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be at least 1 coin';
  END IF;

  IF v_sender_id = p_recipient_id THEN
    RAISE EXCEPTION 'You cannot donate to yourself';
  END IF;

  -- Lock the sender row to prevent race conditions
  SELECT balance
  INTO   v_sender_balance
  FROM   public.wallets
  WHERE  user_id = v_sender_id
  FOR UPDATE;

  IF v_sender_balance IS NULL THEN
    RAISE EXCEPTION 'Sender wallet not found';
  END IF;

  IF v_sender_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance: you have % coins', v_sender_balance;
  END IF;

  -- Deduct from sender
  UPDATE public.wallets
  SET    balance = balance - p_amount
  WHERE  user_id = v_sender_id;

  -- Add to recipient (upsert-safe: if recipient has no wallet yet, skip gracefully)
  UPDATE public.wallets
  SET    balance = balance + p_amount
  WHERE  user_id = p_recipient_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recipient wallet not found';
  END IF;

  -- Log the donation
  INSERT INTO public.donations (sender_id, recipient_id, amount)
  VALUES (v_sender_id, p_recipient_id, p_amount);
END;
$$;

-- Grant execute to logged-in users
GRANT EXECUTE ON FUNCTION public.donate_coins(uuid, integer) TO authenticated;
