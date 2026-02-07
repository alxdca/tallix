import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { PostgreSqlContainer } from '@testcontainers/postgresql';

const here = dirname(fileURLToPath(import.meta.url));

const DB_NAME = 'tallix';
const SUPERUSER = 'tallix';
const SUPERUSER_PASSWORD = 'tallix_secret';
const APP_USER = 'tallix_app';
const APP_USER_PASSWORD = 'tallix_app_secret';

async function createAppRoleAndGrants(adminUrl: string) {
  const admin = postgres(adminUrl, { max: 1 });
  try {
    await admin.unsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${APP_USER}') THEN
          CREATE ROLE ${APP_USER}
            LOGIN
            PASSWORD '${APP_USER_PASSWORD}'
            NOSUPERUSER
            NOCREATEDB
            NOCREATEROLE
            NOBYPASSRLS;
        END IF;
      END
      $$;
    `);

    await admin.unsafe(`GRANT CONNECT ON DATABASE ${DB_NAME} TO ${APP_USER};`);
    await admin.unsafe(`GRANT USAGE ON SCHEMA public TO ${APP_USER};`);
    await admin.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_USER};`);
    await admin.unsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_USER};`);
    await admin.unsafe(`
      ALTER DEFAULT PRIVILEGES FOR ROLE ${SUPERUSER} IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_USER};
    `);
    await admin.unsafe(`
      ALTER DEFAULT PRIVILEGES FOR ROLE ${SUPERUSER} IN SCHEMA public
        GRANT USAGE, SELECT ON SEQUENCES TO ${APP_USER};
    `);
  } finally {
    await admin.end();
  }
}

async function runMigrations(migrationUrl: string) {
  const migrationClient = postgres(migrationUrl, { max: 1 });
  try {
    const migrationDb = drizzle(migrationClient);
    await migrate(migrationDb, {
      migrationsFolder: resolve(here, '../drizzle'),
    });
  } finally {
    await migrationClient.end();
  }
}

export default async function globalSetup() {
  if (process.env.SKIP_TESTCONTAINERS === 'true') {
    return;
  }

  config({ path: resolve(here, '../../.env') });
  config({ path: resolve(here, '../.env') });

  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase(DB_NAME)
    .withUsername(SUPERUSER)
    .withPassword(SUPERUSER_PASSWORD)
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(5432);
  const migrationUrl = `postgresql://${SUPERUSER}:${SUPERUSER_PASSWORD}@${host}:${port}/${DB_NAME}`;
  const appUrl = `postgresql://${APP_USER}:${APP_USER_PASSWORD}@${host}:${port}/${DB_NAME}`;

  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  process.env.DB_HOST = host;
  process.env.DB_PORT = String(port);
  process.env.DB_NAME = DB_NAME;
  process.env.POSTGRES_USER = SUPERUSER;
  process.env.POSTGRES_PASSWORD = SUPERUSER_PASSWORD;
  process.env.APP_DB_USER = APP_USER;
  process.env.APP_DB_PASSWORD = APP_USER_PASSWORD;
  process.env.MIGRATION_DATABASE_URL = migrationUrl;
  process.env.DATABASE_URL = appUrl;

  await createAppRoleAndGrants(migrationUrl);
  await runMigrations(migrationUrl);
  await createAppRoleAndGrants(migrationUrl);

  return async () => {
    await container.stop();
  };
}
