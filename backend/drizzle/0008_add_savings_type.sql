-- Add savings_type column to payment_methods
ALTER TABLE payment_methods ADD COLUMN savings_type VARCHAR(20);
