-- Core schema: users, double-entry ledger, deposits, withdrawals.
-- All amounts are BIGINT minor units (see domain/assets.ts for decimals per asset).

CREATE TABLE users (
  id                  BIGINT PRIMARY KEY,            -- Telegram user id
  username            TEXT,
  first_name          TEXT NOT NULL DEFAULT '',
  last_name           TEXT,
  language_code       TEXT,
  is_blocked          BOOLEAN NOT NULL DEFAULT false,
  pin_hash            TEXT,
  pin_failed_attempts INT NOT NULL DEFAULT 0,
  pin_locked_until    TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
  id         BIGSERIAL PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('user', 'system')),
  user_id    BIGINT REFERENCES users(id),
  code       TEXT,
  asset      TEXT NOT NULL,
  balance    BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT accounts_owner_chk CHECK (
    (kind = 'user' AND user_id IS NOT NULL AND code IS NULL) OR
    (kind = 'system' AND user_id IS NULL AND code IS NOT NULL)
  ),
  -- A user can never go below zero, whatever the application code does.
  CONSTRAINT accounts_non_negative_chk CHECK (kind = 'system' OR balance >= 0)
);
CREATE UNIQUE INDEX accounts_user_asset_uq ON accounts (user_id, asset) WHERE kind = 'user';
CREATE UNIQUE INDEX accounts_system_code_asset_uq ON accounts (code, asset) WHERE kind = 'system';

CREATE TABLE ledger_transactions (
  id         BIGSERIAL PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('deposit', 'withdrawal', 'withdrawal_refund')),
  ref_id     UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A business event can be posted to the ledger exactly once.
  CONSTRAINT ledger_transactions_ref_uq UNIQUE (kind, ref_id)
);

CREATE TABLE ledger_entries (
  id            BIGSERIAL PRIMARY KEY,
  tx_id         BIGINT NOT NULL REFERENCES ledger_transactions(id),
  account_id    BIGINT NOT NULL REFERENCES accounts(id),
  amount        BIGINT NOT NULL CHECK (amount <> 0),
  balance_after BIGINT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ledger_entries_tx_idx ON ledger_entries (tx_id);
CREATE INDEX ledger_entries_account_idx ON ledger_entries (account_id, id);

-- Every ledger transaction must balance to zero (checked at COMMIT).
CREATE FUNCTION ledger_check_balanced() RETURNS trigger AS $$
DECLARE
  total NUMERIC;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO total FROM ledger_entries WHERE tx_id = NEW.tx_id;
  IF total <> 0 THEN
    RAISE EXCEPTION 'ledger transaction % is unbalanced (sum=%)', NEW.tx_id, total;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ledger_entries_balanced
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_check_balanced();

-- The ledger is append-only.
CREATE FUNCTION ledger_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entries_immutable
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_forbid_mutation();
CREATE TRIGGER ledger_transactions_immutable
  BEFORE UPDATE OR DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION ledger_forbid_mutation();

CREATE TABLE deposits (
  id                  UUID PRIMARY KEY,
  user_id             BIGINT NOT NULL REFERENCES users(id),
  asset               TEXT NOT NULL,
  amount              BIGINT NOT NULL CHECK (amount > 0),
  status              TEXT NOT NULL CHECK (status IN ('created', 'pending', 'paid', 'expired', 'failed')),
  provider            TEXT NOT NULL,
  provider_invoice_id TEXT,
  pay_url             TEXT,
  idempotency_key     TEXT NOT NULL,
  expires_at          TIMESTAMPTZ NOT NULL,
  paid_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT deposits_idempotency_uq UNIQUE (user_id, idempotency_key),
  CONSTRAINT deposits_invoice_uq UNIQUE (provider, provider_invoice_id)
);
CREATE INDEX deposits_user_created_idx ON deposits (user_id, created_at DESC);
CREATE INDEX deposits_open_idx ON deposits (created_at) WHERE status IN ('created', 'pending');

CREATE TABLE withdrawals (
  id                   UUID PRIMARY KEY,
  user_id              BIGINT NOT NULL REFERENCES users(id),
  asset                TEXT NOT NULL,
  amount               BIGINT NOT NULL CHECK (amount > 0),   -- sent to the user
  fee                  BIGINT NOT NULL CHECK (fee >= 0),     -- kept by the service
  status               TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'review')),
  provider             TEXT NOT NULL,
  provider_transfer_id TEXT,
  failure_reason       TEXT,
  attempts             INT NOT NULL DEFAULT 0,
  next_attempt_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  idempotency_key      TEXT NOT NULL,
  completed_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT withdrawals_idempotency_uq UNIQUE (user_id, idempotency_key)
);
CREATE INDEX withdrawals_user_created_idx ON withdrawals (user_id, created_at DESC);
CREATE INDEX withdrawals_queue_idx ON withdrawals (next_attempt_at) WHERE status IN ('pending', 'processing');
