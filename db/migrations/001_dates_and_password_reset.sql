-- Migration 001: transaction dates + password-reset tokens
-- Safe to run more than once. Existing rows are back-filled from created_at.
--
-- Run against a live Docker deployment with:
--   docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/migrations/001_dates_and_password_reset.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='payments' AND column_name='payment_date') THEN
    ALTER TABLE payments ADD COLUMN payment_date DATE NOT NULL DEFAULT CURRENT_DATE;
    UPDATE payments SET payment_date = created_at::date;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='expenses' AND column_name='expense_date') THEN
    ALTER TABLE expenses ADD COLUMN expense_date DATE NOT NULL DEFAULT CURRENT_DATE;
    UPDATE expenses SET expense_date = created_at::date;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='accounts' AND column_name='txn_date') THEN
    ALTER TABLE accounts ADD COLUMN txn_date DATE NOT NULL DEFAULT CURRENT_DATE;
    -- ledger entries take the date of the payment/expense they came from
    UPDATE accounts a SET txn_date = p.payment_date
      FROM payments p WHERE a.source_type='payment' AND a.source_id = p.payment_id;
    UPDATE accounts a SET txn_date = e.expense_date
      FROM expenses e WHERE a.source_type='expense' AND a.source_id = e.expense_id;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_accounts_txn_date ON accounts(txn_date);

ALTER TABLE members ADD COLUMN IF NOT EXISTS reset_token_hash TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMPTZ;
