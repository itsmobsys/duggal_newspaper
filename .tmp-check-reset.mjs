import fs from 'node:fs';
import { createClient } from './apps/api/node_modules/@libsql/client/lib-esm/node.js';

const env = Object.fromEntries(
  fs
    .readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => {
      const at = line.indexOf('=');
      return [line.slice(0, at), line.slice(at + 1).replace(/^"|"$/g, '')];
    }),
);

const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });

const jobs = await db.execute(
  "SELECT idempotency_key, status, created_at FROM jobs WHERE idempotency_key LIKE 'placements:%' ORDER BY created_at DESC LIMIT 5",
);
console.log('placement jobs:', JSON.stringify(jobs.rows));

const pins = await db.execute(
  "SELECT placement, breaking, featured, COUNT(1) AS n FROM articles WHERE status = 'published' GROUP BY placement, breaking, featured",
);
console.log('published pins:', JSON.stringify(pins.rows));

db.close();
