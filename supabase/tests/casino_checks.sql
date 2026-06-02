-- ─────────────────────────────────────────────────────────────────────────────
-- casino_checks.sql — live-DB verification for the server-authoritative casino.
-- Run by hand in the Supabase SQL editor. There is NO local Postgres here, so this
-- is the live-DB counterpart to the JS engine tests (which pin exact-value
-- correctness). These are GRANT/RLS checks + distribution/RTP sanity over many
-- random() draws — NOT exact-value assertions (random() can't be seeded per-call;
-- only setseed() per session). Exact payout correctness is proven by the mirrored
-- node:test engines (92 cases).
--
-- Run the GRANT checks BEFORE and AFTER applying 045_wallet_lockdown.sql.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1) Wallet grant lockdown (from the spec) ─────────────────────────────────
-- AFTER 045: `authenticated` should show ONLY UPDATE on wallets (column-scoped to
-- display_name in the column-grants query below); `anon` should show NOTHING.
SELECT grantee, privilege_type
FROM   information_schema.role_table_grants
WHERE  table_schema = 'public' AND table_name = 'wallets'
ORDER  BY grantee, privilege_type;

-- AFTER 045: the only row for `authenticated` should be UPDATE on column display_name.
SELECT grantee, privilege_type, column_name
FROM   information_schema.role_column_grants
WHERE  table_schema = 'public' AND table_name = 'wallets'
ORDER  BY grantee, privilege_type, column_name;

-- AFTER 045: game_history should have NO INSERT for authenticated/anon (RPCs insert).
SELECT grantee, privilege_type
FROM   information_schema.role_table_grants
WHERE  table_schema = 'public' AND table_name = 'game_history'
ORDER  BY grantee, privilege_type;

-- AFTER 045: settle_bet must be gone.
SELECT proname FROM pg_proc WHERE proname = 'settle_bet';   -- expect 0 rows

-- ── 2) RLS posture on the interactive-round tables ───────────────────────────
-- casino_rounds: RLS enabled, exactly one SELECT-own policy, no write policies.
-- casino_round_secrets: RLS enabled, ZERO policies (deny-all to clients).
SELECT relname, relrowsecurity
FROM   pg_class
WHERE  relname IN ('casino_rounds', 'casino_round_secrets');   -- both relrowsecurity = true

SELECT tablename, policyname, cmd
FROM   pg_policies
WHERE  tablename IN ('casino_rounds', 'casino_round_secrets')
ORDER  BY tablename, policyname;
-- expect: casino_rounds → casino_rounds_select_own (SELECT) only;
--         casino_round_secrets → (no rows).

-- casino_round_secrets must NOT be in the Realtime publication.
SELECT schemaname, tablename
FROM   pg_publication_tables
WHERE  pubname = 'supabase_realtime' AND tablename = 'casino_round_secrets';   -- expect 0 rows

-- ── 3) Distribution / RTP sanity (mirrors the roll logic over many random() draws) ──
-- These reproduce each game's server roll inline so they can run without a funded
-- wallet. They should match the JS engine RTPs within Monte-Carlo noise at 1e6 trials.

-- Dice: roll = floor(random()*6)+1; win iff roll == guess (here guess = 6).
-- RTP = P(win)*5 = (1/6)*5 ≈ 0.8333; win rate ≈ 16.67%.
WITH r AS (
  SELECT (floor(random() * 6) + 1)::int AS roll FROM generate_series(1, 1000000)
)
SELECT 'dice' AS game,
       round(avg((roll = 6)::int)::numeric, 4)        AS win_rate,        -- ~0.1667
       round(avg(case when roll = 6 then 5 else 0 end)::numeric, 4) AS rtp  -- ~0.8333
FROM r;

-- Coin flip: result heads iff random() > 0.5; bet on heads. win → +0.95 return (push-ish),
-- net delta floor(bet*0.95). RTP per unit = P(win)*1.95 (stake back is implicit) — measured
-- here as gross return multiple of bet: win → 1.95, loss → 0. RTP ≈ 0.5*1.95 = 0.975.
WITH r AS (
  SELECT (random() > 0.5) AS heads FROM generate_series(1, 1000000)
)
SELECT 'coinflip' AS game,
       round(avg(heads::int)::numeric, 4)                          AS win_rate,   -- ~0.5
       round(avg(case when heads then 1.95 else 0 end)::numeric, 4) AS rtp          -- ~0.975
FROM r;

-- Roulette (red bet): result = floor(random()*37); red set size 18 → P(win)=18/37.
-- Even-money gross return on win = 2 (stake + bet). RTP = (18/37)*2 ≈ 0.9730.
WITH r AS (
  SELECT (floor(random() * 37))::int AS res FROM generate_series(1, 1000000)
), red AS (
  SELECT res, (res = ANY (ARRAY[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36])) AS is_red
  FROM r
)
SELECT 'roulette_red' AS game,
       round(avg(is_red::int)::numeric, 4)                       AS win_rate,   -- ~0.4865
       round(avg(case when is_red then 2 else 0 end)::numeric, 4) AS rtp          -- ~0.9730
FROM red;

-- Roulette (straight number bet): P(win)=1/37, gross return 36 → RTP ≈ 0.9730.
WITH r AS (
  SELECT (floor(random() * 37))::int AS res FROM generate_series(1, 1000000)
)
SELECT 'roulette_number' AS game,
       round(avg((res = 17)::int)::numeric, 5)                    AS win_rate,   -- ~0.027
       round(avg(case when res = 17 then 36 else 0 end)::numeric, 4) AS rtp        -- ~0.9730
FROM r;

-- Slots: full 5x3 weighted grid + 5-payline evaluation reproduced inline is verbose;
-- the closed-form RTP is asserted in slotsEngine.theoreticalRTP() (92.x% band) and
-- monte-carlo'd by scripts/slots-sim.mjs / casino-sim.mjs. As a coarse DB check,
-- confirm a single weighted draw lands in the expected proportions:
WITH r AS (
  SELECT (
    SELECT min(i) FROM (
      SELECT i, sum(w) OVER (ORDER BY i) AS cum
      FROM unnest(ARRAY[6,6,4,3,1]) WITH ORDINALITY AS t(w, i)
    ) c WHERE c.cum > d.x
  ) - 1 AS sym
  FROM (SELECT random() * 20 AS x FROM generate_series(1, 1000000)) d
)
SELECT 'slots_symbol_dist' AS game, sym, count(*),
       round(count(*)::numeric / 1000000, 4) AS freq   -- expect ~0.30,0.30,0.20,0.15,0.05
FROM r GROUP BY sym ORDER BY sym;

-- Plinko: slot = #right deflections over `rows` fair coins ~ Binomial(rows, 0.5).
-- RTP per config = Σ_slot C(rows,slot)/2^rows * MULTIPLIERS[rows][risk][slot].
-- Spot-check the slot distribution for 8 rows (should be symmetric, peak at slot 4):
WITH r AS (
  SELECT (SELECT sum((random() < 0.5)::int) FROM generate_series(1, 8)) AS slot
  FROM generate_series(1, 1000000)
)
SELECT 'plinko8_slot_dist' AS game, slot, count(*),
       round(count(*)::numeric / 1000000, 4) AS freq
FROM r GROUP BY slot ORDER BY slot;

-- ── 4) OPTIONAL end-to-end RPC smoke (run as a real signed-in user with coins) ──
-- These actually move money; run only on a throwaway account. Uncomment to use.
-- SELECT public.play_dice(10, 6);
-- SELECT public.play_coinflip(10, 'heads');
-- SELECT public.play_roulette(10, 'red', NULL);
-- SELECT public.play_slots(10);
-- SELECT public.play_plinko(10, 8, 'medium');
-- -- interactive:
-- SELECT public.mines_open(10, 3);          -- returns round_id; then mines_reveal/_cashout
-- SELECT public.chicken_open(10);           -- returns round_id; then chicken_step/_cashout
-- SELECT public.blackjack_open(10);         -- returns round_id; then blackjack_hit/_stand/_double
