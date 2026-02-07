import postgres from 'postgres';
import { config } from 'dotenv';
import { resolve } from 'node:path';

// Load environment variables
config({ path: resolve(process.cwd(), '.env') });

const DATABASE_URL = process.env.DATABASE_URL || process.env.MIGRATION_DATABASE_URL;

if (!DATABASE_URL) {
  console.error('DATABASE_URL or MIGRATION_DATABASE_URL not found in environment');
  process.exit(1);
}

const sql = postgres(DATABASE_URL);

async function applyMigration() {
  try {
    console.log('Applying start_year migration...');

    // Add start_year column with a temporary default (current year)
    console.log('1. Adding start_year column...');
    await sql`
      ALTER TABLE budgets
      ADD COLUMN IF NOT EXISTS start_year INTEGER DEFAULT EXTRACT(YEAR FROM NOW())::INTEGER NOT NULL
    `;

    // Backfill start_year for each budget
    console.log('2. Backfilling start_year values...');
    await sql`
      UPDATE budgets b
      SET start_year = COALESCE(
        (
          SELECT MIN(year)
          FROM budget_years by
          WHERE by.budget_id = b.id
        ),
        EXTRACT(YEAR FROM NOW())::INTEGER
      )
    `;

    // Remove the default constraint
    console.log('3. Removing default constraint...');
    await sql`
      ALTER TABLE budgets
      ALTER COLUMN start_year DROP DEFAULT
    `;

    console.log('✅ Migration applied successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

applyMigration();
