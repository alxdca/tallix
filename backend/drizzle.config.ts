import { defineConfig } from 'drizzle-kit';

// Construct default DATABASE_URL from components if not provided
const defaultUrl = process.env.DATABASE_URL || 
  `postgresql://${process.env.APP_DB_USER || 'tallix_app'}:${process.env.APP_DB_PASSWORD || 'tallix_app_secret'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'tallix'}`;

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: defaultUrl,
  },
});
