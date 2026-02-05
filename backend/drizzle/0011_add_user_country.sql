-- Migration: Add country field to users table
ALTER TABLE "users" ADD COLUMN "country" varchar(2);
