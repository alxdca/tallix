CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS transactions_year_id_idx
  ON transactions (year_id);

CREATE INDEX IF NOT EXISTS transactions_third_party_trgm_idx
  ON transactions USING gin (third_party gin_trgm_ops)
  WHERE third_party IS NOT NULL;
