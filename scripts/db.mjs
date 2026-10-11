#!/usr/bin/env node
// i12farm database tool. Replaces the Supabase CLI.
//
//   node scripts/db.mjs migrate     apply new files in db/migrations (in order, once each)
//   node scripts/db.mjs status      list applied and pending migrations
//   node scripts/db.mjs seed        load db/seed.sql + db/seed_demo.sql (development only)
//   node scripts/db.mjs reset       DROP everything, migrate, seed (development only)
//
// Reads DATABASE_URL from the environment or .env.local / .env.
// Each migration runs in its own transaction and is recorded with a checksum
// in public.schema_migrations; an edited, already-applied file is reported.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(ROOT, 'db', 'migrations');

function loadEnv() {
  for (const name of ['.env.local', '.env']) {
    const file = join(ROOT, name);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

loadEnv();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set (put it in .env.local).');
  process.exit(1);
}

const command = process.argv[2] ?? 'migrate';
const sql = postgres(url, { max: 1, onnotice: (n) => console.log(`  · ${n.message}`), prepare: false });

const sha = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);
const files = () => readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();

async function ensureTable() {
  await sql`
    create table if not exists public.schema_migrations (
      name       text primary key,
      checksum   text not null,
      applied_at timestamptz not null default now()
    )`;
  await sql`revoke all on public.schema_migrations from public`.catch(() => undefined);
}

async function applied() {
  const rows = await sql`select name, checksum from public.schema_migrations order by name`;
  return new Map(rows.map((r) => [r.name, r.checksum]));
}

async function migrate() {
  await ensureTable();
  const done = await applied();
  let count = 0;
  for (const name of files()) {
    const text = readFileSync(join(MIGRATIONS, name), 'utf8');
    if (done.has(name)) {
      if (done.get(name) !== sha(text)) console.warn(`! ${name} changed after it was applied (not re-run)`);
      continue;
    }
    process.stdout.write(`→ ${name}\n`);
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`insert into public.schema_migrations (name, checksum) values (${name}, ${sha(text)})`;
    });
    count += 1;
  }
  // Re-assert table-level revokes on the bookkeeping table after default privileges.
  await sql`revoke all on public.schema_migrations from anon, authenticated`.catch(() => undefined);
  console.log(count ? `Applied ${count} migration(s).` : 'Database is up to date.');
}

async function status() {
  await ensureTable();
  const done = await applied();
  for (const name of files()) console.log(`${done.has(name) ? '✓' : '·'} ${name}`);
}

function devOnly() {
  if (process.env.NODE_ENV === 'production' || /neon\.tech|supabase\.co|aivencloud|render\.com|railway/.test(url)) {
    if (process.env.I12FARM_ALLOW_SEED !== 'yes') {
      console.error(`Refusing to run "${command}" against what looks like a hosted database. Set I12FARM_ALLOW_SEED=yes to override.`);
      process.exit(1);
    }
  }
}

async function seed() {
  devOnly();
  for (const name of ['seed.sql', 'seed_demo.sql']) {
    process.stdout.write(`→ ${name}\n`);
    await sql.begin((tx) => tx.unsafe(readFileSync(join(ROOT, 'db', name), 'utf8')));
  }
  const [{ n }] = await sql`select count(*)::int as n from public.farms where status = 'published'`;
  console.log(`Seeded. Published farms: ${n}.`);
}

async function reset() {
  devOnly();
  console.log('Dropping schemas public, auth, extensions …');
  await sql.unsafe(`
    drop schema if exists auth cascade;
    drop schema if exists extensions cascade;
    drop schema if exists public cascade;
    create schema public;
    grant usage on schema public to public;
  `);
  await migrate();
  await seed();
}

try {
  if (command === 'migrate') await migrate();
  else if (command === 'status') await status();
  else if (command === 'seed') await seed();
  else if (command === 'reset') await reset();
  else {
    console.error(`Unknown command "${command}". Use migrate, status, seed or reset.`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`✗ ${error.message}`);
  if (error.where) console.error(error.where);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
