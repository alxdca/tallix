import { defineConfig } from 'drizzle-kit';

const migrationUrl =
  process.env.MIGRATION_DATABASE_URL ||
  (process.env.POSTGRES_USER && process.env.POSTGRES_PASSWORD
    ? `postgresql://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'tallix'}`
    : undefined);

// Fallback to app user DATABASE_URL if no migration-specific credentials are available.
const defaultUrl =
  migrationUrl ||
  process.env.DATABASE_URL ||
  `postgresql://${process.env.APP_DB_USER || 'tallix_app'}:${process.env.APP_DB_PASSWORD || 'tallix_app_secret'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'tallix'}`;

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: defaultUrl,
  },
});
