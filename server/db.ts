import { readdirSync, readFileSync } from 'node:fs';
import postgres from 'postgres';

export type Sql = postgres.Sql;

export function connect(url: string): Sql {
  return postgres(url, { onnotice: () => {} });
}

/** Applies every migration in server/migrations that hasn't run yet, in file-name order. */
export async function migrate(sql: Sql): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  const dir = new URL('./migrations/', import.meta.url);
  const done = new Set((await sql`SELECT name FROM schema_migrations`).map(r => r.name as string));
  for (const name of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    if (done.has(name)) continue;
    await sql.begin(async tx => {
      await tx.unsafe(readFileSync(new URL(name, dir), 'utf8'));
      await tx`INSERT INTO schema_migrations (name) VALUES (${name})`;
    });
  }
}
