-- Multi-currency wallet: currency exchange, fiat payouts, 4-digit PINs.

-- Exchanges post to the ledger too.
ALTER TABLE ledger_transactions DROP CONSTRAINT ledger_transactions_kind_check;
ALTER TABLE ledger_transactions ADD CONSTRAINT ledger_transactions_kind_check
  CHECK (kind IN ('deposit', 'withdrawal', 'withdrawal_refund', 'exchange'));

-- With several currencies in one transaction, "sums to zero" must hold per currency:
-- otherwise 100 RUB could silently balance against 100 USD.
CREATE OR REPLACE FUNCTION ledger_check_balanced() RETURNS trigger AS $$
DECLARE
  bad TEXT;
BEGIN
  SELECT a.asset INTO bad
  FROM ledger_entries e JOIN accounts a ON a.id = e.account_id
  WHERE e.tx_id = NEW.tx_id
  GROUP BY a.asset
  HAVING SUM(e.amount) <> 0
  LIMIT 1;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'ledger transaction % is unbalanced in %', NEW.tx_id, bad;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- What actually leaves through the provider: fiat balances are paid out in crypto at the market rate.
ALTER TABLE withdrawals ADD COLUMN payout_asset TEXT;
ALTER TABLE withdrawals ADD COLUMN payout_amount BIGINT;
UPDATE withdrawals SET payout_asset = asset, payout_amount = amount;
ALTER TABLE withdrawals ALTER COLUMN payout_asset SET NOT NULL;
ALTER TABLE withdrawals ALTER COLUMN payout_amount SET NOT NULL;
ALTER TABLE withdrawals ADD CONSTRAINT withdrawals_payout_positive_chk CHECK (payout_amount > 0);

CREATE TABLE exchanges (
  id              UUID PRIMARY KEY,
  user_id         BIGINT NOT NULL REFERENCES users(id),
  from_asset      TEXT NOT NULL,
  to_asset        TEXT NOT NULL,
  from_amount     BIGINT NOT NULL CHECK (from_amount > 0),
  to_amount       BIGINT NOT NULL CHECK (to_amount > 0),   -- credited to the user
  fee             BIGINT NOT NULL CHECK (fee >= 0),         -- in to_asset
  rate            TEXT NOT NULL,                            -- display rate: 1 from = rate to
  quote_id        UUID NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT exchanges_assets_chk CHECK (from_asset <> to_asset),
  -- A quote can be executed once, whatever the idempotency key.
  CONSTRAINT exchanges_quote_uq UNIQUE (quote_id),
  CONSTRAINT exchanges_idempotency_uq UNIQUE (user_id, idempotency_key)
);
CREATE INDEX exchanges_user_created_idx ON exchanges (user_id, created_at DESC);

-- PINs are now 4 digits and also unlock the app: everyone sets a new one on next launch.
UPDATE users SET pin_hash = NULL, pin_failed_attempts = 0, pin_locked_until = NULL;
