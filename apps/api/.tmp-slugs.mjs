import { createClient } from '@libsql/client';

const c = createClient({ url: `file:${process.cwd()}/data/duggal.db` });
const r = await c.execute('select slug, headline, status from articles order by published_at desc');
for (const row of r.rows) console.log(row.slug, '|', row.status, '|', row.headline);
