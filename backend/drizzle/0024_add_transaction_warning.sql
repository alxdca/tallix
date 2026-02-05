-- Add warning column to transactions table for duplicate detection and other warnings
ALTER TABLE transactions ADD COLUMN warning varchar(50);

-- Add index to improve query performance when filtering by warning
CREATE INDEX idx_transactions_warning ON transactions(warning) WHERE warning IS NOT NULL;
