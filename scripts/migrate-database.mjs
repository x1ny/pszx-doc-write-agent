import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnvironment } from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');

loadEnvironment({
  path: [
    join(projectDirectory, '.env.local'),
    join(projectDirectory, '.env'),
  ],
  quiet: true,
});

function getRequiredEnvironment(key) {
  const value = process.env[key]?.trim();

  if (!value) {
    throw new Error(`Missing required database environment variable: ${key}`);
  }

  return value;
}

function getDatabasePort() {
  const value = getRequiredEnvironment('DB_PORT');
  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('DB_PORT must be an integer between 1 and 65535');
  }

  return port;
}

const pool = new pg.Pool({
  host: getRequiredEnvironment('DB_HOST'),
  port: getDatabasePort(),
  database: getRequiredEnvironment('DB_NAME'),
  user: getRequiredEnvironment('DB_USER'),
  password: getRequiredEnvironment('DB_PASSWORD'),
  application_name: 'doc-agent-migrator',
  connectionTimeoutMillis: 10_000,
});

try {
  const database = drizzle(pool);

  await migrate(database, {
    migrationsFolder: join(projectDirectory, 'drizzle'),
    migrationsSchema: 'drizzle',
    migrationsTable: '__drizzle_migrations',
  });

  console.log('Database migrations completed successfully.');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Database migration failed: ${message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
