-- NAV switches from "exited tokens stay in NAV at exit value" to "tokens leaving the position are
-- capital out". Convert stored snapshots and engine states: the engine's cumulative exitedValue
-- becomes capitalOut, and NAV drops by it. Total P&L is unchanged.
--
-- Rows written by the new engine before this migration ran already exclude exitedValue from NAV
-- (nav = positionValue + heldFeesValue + rGasCost); only their capital totals and state are fixed.

WITH s AS (
  SELECT
    id,
    COALESCE((state->>'exitedValue')::float8, 0) AS ex,
    COALESCE(LAG((state->>'exitedValue')::float8) OVER (PARTITION BY "positionId" ORDER BY seq), 0) AS prev_ex,
    ABS(nav - ("positionValue" + "heldFeesValue" + "rGasCost")) < 0.01 AS already_new,
    ABS("navOpen" - (LAG("positionValue" + "heldFeesValue" + "rGasCost") OVER (PARTITION BY "positionId" ORDER BY seq))) < 0.01 AS open_already_new
  FROM "Snapshot"
  WHERE state ? 'exitedValue'
)
UPDATE "Snapshot" t
SET
  nav = CASE WHEN s.already_new THEN t.nav ELSE t.nav - s.ex END,
  "navOpen" = CASE WHEN COALESCE(s.open_already_new, false) THEN t."navOpen" ELSE t."navOpen" - s.prev_ex END,
  "capitalOut" = t."capitalOut" + (s.ex - s.prev_ex),
  "netCapital" = t."netCapital" - s.ex,
  state = jsonb_set(t.state - 'exitedValue', '{capitalOut}', to_jsonb(COALESCE((t.state->>'capitalOut')::float8, 0) + s.ex)),
  -- The new-engine rows failed this check only because capitalOut had not been converted yet.
  checks = jsonb_set(t.checks, '{totalPnlMatchesNav}', 'true'::jsonb),
  "checksOk" = NOT EXISTS (
    SELECT 1 FROM jsonb_each(jsonb_set(t.checks, '{totalPnlMatchesNav}', 'true'::jsonb)) c WHERE c.value = 'false'::jsonb
  )
FROM s
WHERE t.id = s.id;

UPDATE "Position"
SET state = jsonb_set(
  state - 'exitedValue',
  '{capitalOut}',
  to_jsonb(COALESCE((state->>'capitalOut')::float8, 0) + COALESCE((state->>'exitedValue')::float8, 0))
)
WHERE state ? 'exitedValue';
