import { closeDb, getDb } from '../src/db/client.js';
import type { Db } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { hashPassword } from '../src/lib/crypto.js';
import { newId } from '../src/lib/id.js';
import { nowIso, editionDateFor } from '../src/lib/time.js';
import { SETTING_DEFS, defaultSettings } from '../src/settings.js';

const CATEGORIES: Array<{
  slug: string;
  name: string;
  description: string;
  accent: string;
  sortOrder: number;
}> = [
  {
    slug: 'server-news',
    name: 'Server News',
    description: 'Actual announcements, outages, rule changes and other admin propaganda.',
    accent: '#b3261e',
    sortOrder: 10,
  },
  {
    slug: 'drama',
    name: 'Drama',
    description: 'Beef, meltdowns and unresolved arguments that definitely should have been DMs.',
    accent: '#8a1c3b',
    sortOrder: 20,
  },
  {
    slug: 'events',
    name: 'Events',
    description: 'Movie nights, game nights, tournaments and things everyone RSVPs to and skips.',
    accent: '#1d5c4a',
    sortOrder: 30,
  },
  {
    slug: 'memes',
    name: 'Memes',
    description:
      'Certified fresh brainrot, cursed screenshots and inside jokes nobody can explain.',
    accent: '#a15c07',
    sortOrder: 40,
  },
  {
    slug: 'gaming',
    name: 'Gaming',
    description: 'Clutches, throws, patch notes and gamer grievances.',
    accent: '#2d4a8a',
    sortOrder: 50,
  },
  {
    slug: 'confessions',
    name: 'Confessions',
    description: 'Anonymous admissions from members who absolutely know we can still guess.',
    accent: '#5b3a7e',
    sortOrder: 60,
  },
];

const DEMO_STORIES: Array<{
  slug: string;
  headline: string;
  dek: string;
  body: string[];
  category: string;
  author: string;
  breaking: boolean;
  placement: 'lead' | 'top' | 'standard';
  tags: string[];
}> = [
  {
    slug: 'demo-server-owner-discovers-new-channel',
    headline: 'Server Owner Discovers #general After 11 Months, Declares “New Era”',
    dek: 'An emotional press conference was held in a voice channel with three listeners, two of whom were muted.',
    body: [
      'In a development historians are calling “broadly unsurprising”, the owner of the server has reportedly discovered the #general channel, eleven months after creating it.',
      'Sources close to the situation say the owner scrolled through roughly 40,000 messages, paused at a meme involving a frog, and then announced a “community reset” that nobody requested.',
      'The new era lasted approximately fourteen minutes before the owner posted a screenshot of a cricket score and left.',
      'Members have been advised to remain calm and, as always, to keep their best memes in #shitposting.',
    ],
    category: 'server-news',
    author: 'Demo Desk',
    breaking: true,
    placement: 'lead',
    tags: ['demo', 'server', 'admin'],
  },
  {
    slug: 'demo-voice-channel-beef',
    headline: 'Two Members Agree to “Settle It in Among Us”, Somehow Start Third Argument',
    dek: 'The imposter was not found. The grudge, however, was.',
    body: [
      'A disagreement over whether pineapple belongs on pizza escalated into a full-blown Among Us lobby on Tuesday night, according to a transcript nobody asked to see.',
      'The match ended with both parties accusing each other of “playing weird”, which is technically true of everyone who has ever played the game.',
      'Peace talks are scheduled for later this week, provided everyone can agree on a time zone.',
    ],
    category: 'drama',
    author: 'Demo Desk',
    breaking: false,
    placement: 'top',
    tags: ['demo', 'drama', 'among-us'],
  },
  {
    slug: 'demo-movie-night-postponed',
    headline: 'Movie Night Postponed for the Fourth Time, Organizer Still Optimistic',
    dek: 'The film remains unwatched. The poll remains tied. The popcorn remains unpopped.',
    body: [
      'The server’s weekly movie night has been postponed again, bringing the total number of reschedules to four and the total number of movies actually watched to zero.',
      'Organisers blame “scheduling conflicts”, a phrase that apparently covers everything from work shifts to someone being in another voice channel.',
      'A new poll has been launched. Early results indicate the poll itself is the only activity anyone is willing to commit to.',
    ],
    category: 'events',
    author: 'Demo Desk',
    breaking: false,
    placement: 'top',
    tags: ['demo', 'events', 'movies'],
  },
  {
    slug: 'demo-cursed-screenshot',
    headline: 'Local Man Posts “Last Cursed Screenshot”, Immediately Posts Nine More',
    dek: 'At press time, the channel had been muted by two moderators and one concerned parent.',
    body: [
      'A member who wished to remain anonymous, but whose username is visible in the screenshot, has declared a moratorium on cursed images.',
      'The moratorium ended ninety seconds later with a picture of a dog wearing a suit and a caption that cannot be reproduced in a family newspaper.',
      'Moderators are considering a new rule that would require all cursed screenshots to be submitted in triplicate.',
    ],
    category: 'memes',
    author: 'Demo Desk',
    breaking: false,
    placement: 'standard',
    tags: ['demo', 'memes'],
  },
  {
    slug: 'demo-ranked-clutch',
    headline: 'Five-Stack Loses Ranked Match, Blames “Lag”, Matchmaking, Moon Phase',
    dek: 'The enemy team has been contacted for comment and replied “gg ez”.',
    body: [
      'A five-stack of self-described “semi-pro” players lost a ranked match on Sunday and has yet to accept responsibility.',
      'In a post-match review lasting longer than the match itself, the group identified several contributing factors: lag, matchmaking, the moon phase, and one player’s new mousepad.',
      'The group has announced it will “run it back tomorrow”, which is also what it said yesterday.',
    ],
    category: 'gaming',
    author: 'Demo Desk',
    breaking: false,
    placement: 'standard',
    tags: ['demo', 'gaming', 'ranked'],
  },
  {
    slug: 'demo-confession-crush',
    headline:
      'Anonymous Member Confesses to Having a Crush on “The Person Who Always Says Good Morning”',
    dek: 'The server has narrowed it down to seven suspects, all of whom deny it.',
    body: [
      'An anonymous confession has sent the server into a full investigation after a member admitted to having a crush on whoever posts the daily good-morning message.',
      'The message is posted by a rotating cast of characters, which has made the investigation significantly harder and the speculation significantly worse.',
      'At least three members have changed their morning routines. One has started saying good evening instead.',
    ],
    category: 'confessions',
    author: 'Anonymous',
    breaking: false,
    placement: 'standard',
    tags: ['demo', 'confessions'],
  },
];

async function seedCategories(db: Db): Promise<void> {
  const now = nowIso();
  for (const category of CATEGORIES) {
    await db.run(
      `INSERT INTO categories (slug, name, description, accent, sort_order, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         accent = excluded.accent,
         sort_order = excluded.sort_order`,
      [
        category.slug,
        category.name,
        category.description,
        category.accent,
        category.sortOrder,
        now,
        now,
      ],
    );
  }
  console.log(`[seed] categories ready (${CATEGORIES.length})`);
}

async function seedSettings(db: Db): Promise<void> {
  const now = nowIso();
  const defaults = defaultSettings();
  let inserted = 0;
  for (const key of Object.keys(SETTING_DEFS) as Array<keyof typeof SETTING_DEFS>) {
    const result = await db.run(
      `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, 'seed')
       ON CONFLICT(key) DO NOTHING`,
      [key, JSON.stringify(defaults[key]), now],
    );
    if (result.rowsAffected > 0) inserted += 1;
  }
  console.log(`[seed] settings ready (${inserted} new, ${Object.keys(SETTING_DEFS).length} total)`);
}

async function seedAdmin(db: Db): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const existing = await db.get<{ count: number }>('SELECT COUNT(*) as count FROM admin_users');
  if (Number(existing?.count ?? 0) > 0) {
    console.log('[seed] admin user already exists; skipping');
    return;
  }
  if (!email || !password) {
    console.warn(
      '[seed] no admin user created. Set ADMIN_EMAIL and ADMIN_PASSWORD, or run `npm run admin:create`.',
    );
    return;
  }
  if (password.length < 10) {
    throw new Error('ADMIN_PASSWORD must be at least 10 characters.');
  }
  const now = nowIso();
  await db.run(
    `INSERT INTO admin_users (id, email, name, password_hash, role, disabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'owner', 0, ?, ?)`,
    [newId('adm'), email, 'Owner', await hashPassword(password), now, now],
  );
  console.log(`[seed] admin user created: ${email}`);
}

async function seedDemo(db: Db): Promise<void> {
  const existing = await db.get<{ count: number }>('SELECT COUNT(*) as count FROM articles');
  if (Number(existing?.count ?? 0) > 0) {
    console.log('[seed] articles already exist; skipping demo stories');
    return;
  }
  const settings = await db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [
    'site.timezone',
  ]);
  let timezone = 'Asia/Kolkata';
  try {
    timezone = settings ? (JSON.parse(settings.value) as string) : timezone;
  } catch {
    /* keep default */
  }
  const editionDate = editionDateFor(new Date(), timezone);
  const now = Date.now();
  const nowStamp = nowIso();
  let index = 0;
  for (const story of DEMO_STORIES) {
    const publishedAt = new Date(now - index * 37 * 60 * 1000).toISOString();
    const authorId = newId('mem');
    await db.run(
      `INSERT INTO members (id, display_name, discord_username, submission_count, published_count, created_at, updated_at)
       VALUES (?, ?, NULL, 1, 1, ?, ?)
       ON CONFLICT DO NOTHING`,
      [authorId, story.author, nowStamp, nowStamp],
    );
    await db.run(
      `INSERT INTO articles (id, slug, submission_id, headline, dek, body, original_body, category_slug,
         author_display, author_member_id, identity_mode, tags, breaking, featured, placement, rank_score,
         editor_note, status, source_url, ai_model, ai_generated, reading_minutes, edition_date, views,
         published_at, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?, 0, ?, ?, ?, 'published', NULL,
         'nvidia/nemotron-3.5-super-vl-120b-a12b', 1, ?, ?, 0, ?, ?, ?)`,
      [
        newId('art'),
        story.slug,
        story.headline,
        story.dek,
        story.body.join('\n\n'),
        story.category,
        story.author,
        story.author === 'Anonymous' ? 'anonymous' : 'named',
        JSON.stringify(story.tags),
        story.breaking ? 1 : 0,
        story.placement,
        story.placement === 'lead' ? 95 : story.placement === 'top' ? 72 : 45,
        'Sample edition copy. Delete this demo content from the admin console before launch.',
        Math.max(1, Math.ceil(story.body.join(' ').split(/\s+/).length / 200)),
        editionDate,
        publishedAt,
        nowStamp,
        nowStamp,
      ],
    );
    index += 1;
  }
  console.log(`[seed] ${DEMO_STORIES.length} demo articles created`);
}

async function main(): Promise<void> {
  const demo = process.argv.includes('--demo') || process.env.SEED_DEMO === 'true';
  const db = getDb();
  await runMigrations(db, (message) => console.log(`[seed] ${message}`));
  await seedCategories(db);
  await seedSettings(db);
  await seedAdmin(db);
  if (demo) await seedDemo(db);
  await closeDb();
  console.log('[seed] done');
}

main().catch((error) => {
  console.error('[seed] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
