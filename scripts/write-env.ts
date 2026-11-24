/** Writes apps/web/.env.local from the running local Supabase stack (dev only). */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const raw = execSync('pnpm exec supabase status -o env', { encoding: 'utf8' });
const env = Object.fromEntries(
  raw
    .split('\n')
    .map((l) => l.match(/^([A-Z_]+)="?(.*?)"?$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => [m[1], m[2]]),
);
const out = [
  `NEXT_PUBLIC_SUPABASE_URL=${env.API_URL}`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${env.ANON_KEY}`,
  `SOMA_DB_URL=${env.DB_URL}`,
  `SMTP_URL=smtp://127.0.0.1:54325`,
  `MAILPIT_URL=${env.MAILPIT_URL ?? 'http://127.0.0.1:54324'}`,
  '',
].join('\n');
writeFileSync('apps/web/.env.local', out);
writeFileSync('apps/worker/.env.local', out);
console.log('wrote apps/web/.env.local and apps/worker/.env.local');
