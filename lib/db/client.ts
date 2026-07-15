// Drizzle client bound to the POOLED (pgBouncer transaction-mode) connection
// string (AD-3). node-postgres uses the extended protocol without persistent
// named prepared statements here, so it is safe under transaction pooling; we
// never rely on session-scoped connection state (session pg_advisory_lock is
// forbidden project-wide). Surfaces never import this — only actions/db reach it.

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set (pooled transaction-mode string).');
}

// Reuse the pool across hot-reloads / serverless invocations.
const globalForDb = globalThis as unknown as { __lcPool?: Pool };
const pool = globalForDb.__lcPool ?? new Pool({ connectionString, max: 10 });
if (process.env.NODE_ENV !== 'production') globalForDb.__lcPool = pool;

export const db = drizzle(pool, { schema });
export { pool };
