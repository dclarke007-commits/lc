import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// Migrations/DDL run over the DIRECT (non-pooled) connection so drizzle-kit is
// not subject to transaction-mode pooling constraints. Runtime app traffic uses
// the pooled DATABASE_URL (see lib/db/client.ts).
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('DIRECT_URL or DATABASE_URL must be set for drizzle-kit');

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  strict: true,
});
