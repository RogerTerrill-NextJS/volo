import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const check = process.argv.slice(2);
if (check.some((argument) => argument !== '--check') || check.length > 1) {
  throw new Error('Usage: npm run db:types [-- --check]');
}

// Use the pinned package's Node entry point, with no shell or downloads.
const cli = fileURLToPath(new URL('../node_modules/supabase/dist/supabase.js', import.meta.url));
const result = spawnSync(process.execPath, [cli, 'gen', 'types', '--local', '--lang', 'typescript', '--schema', 'public'], {
  encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
});
if (result.error) throw result.error;
if (result.status !== 0) {
  process.stderr.write(result.stderr || 'Supabase type generation failed. Start the local stack first.\n');
  process.exit(result.status || 1);
}
if (!result.stdout.includes('export type Database =')) {
  throw new Error('CLI returned no database types; existing file was preserved.');
}

const output = fileURLToPath(new URL('../lib/supabase/database.types.ts', import.meta.url));
const generated = result.stdout.replace(/\r\n/g, '\n');
if (check.length) {
  if (!existsSync(output) || readFileSync(output, 'utf8').replace(/\r\n/g, '\n') !== generated) {
    throw new Error('Database types are missing or stale. Run npm run db:types and commit the result.');
  }
} else {
  mkdirSync(fileURLToPath(new URL('../lib/supabase/', import.meta.url)), { recursive: true });
  writeFileSync(output, generated, 'utf8');
}
