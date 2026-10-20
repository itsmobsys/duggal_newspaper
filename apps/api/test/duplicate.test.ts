import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { contentHash } from '../src/lib/text.js';
import { findDuplicate } from '../src/services/moderation.js';

/**
 * Regression tests for the duplicate self-match that held every submission with
 * "Likely duplicate (100% match) of an earlier submission".
 *
 * A submission is stored with its own content_hash before processing, so the
 * exact-hash lookup must exclude the row under review. Empty or missing text
 * must never qualify as a duplicate.
 */

let dir: string;
let db: Db;
let counter = 0;

const THRESHOLD = 0.75;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'duggal-dup-'));
  db = createDb({ url: `file:${path.join(dir, 'test.db')}` });
  await runMigrations(db);
});

afterAll(() => {
  db.client.close();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows keeps the SQLite handle briefly; the OS temp cleaner will get it.
  }
});

interface SeedOptions {
  headline?: string;
  story?: string;
  status?: string;
  hash?: string;
}

async function seed(
  options: SeedOptions = {},
): Promise<{ id: string; headline: string; story: string; hash: string }> {
  counter += 1;
  const id = `sub_dup_${counter}`;
  const headline = options.headline ?? `Hostel mess update number ${counter}`;
  const story =
    options.story ??
    `The hostel mess published update number ${counter} about the paneer supply and the warden explained the delivery schedule for this week.`;
  const hash = options.hash ?? contentHash(`${headline}\n\n${story}`);
  const now = new Date(Date.now() + counter).toISOString();
  await db.run(
    `INSERT INTO submissions (id, public_token, headline, story, author_name, identity_mode,
       status, content_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'Test Reporter', 'named', ?, ?, ?, ?)`,
    [id, `tok_${counter}`, headline, story, options.status ?? 'received', hash, now, now],
  );
  return { id, headline, story, hash };
}

async function seedArticle(input: {
  submissionId: string | null;
  originalBody: string;
}): Promise<string> {
  counter += 1;
  const id = `art_dup_${counter}`;
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO articles (id, slug, submission_id, headline, body, original_body,
       author_display, edition_date, created_at, updated_at)
     VALUES (?, ?, ?, 'Seeded article', 'body', ?, 'Test Reporter', '2026-10-20', ?, ?)`,
    [id, `seeded-${counter}`, input.submissionId, input.originalBody, now, now],
  );
  return id;
}

describe('findDuplicate', () => {
  it('never reports a submission as a duplicate of itself', async () => {
    const row = await seed();

    const result = await findDuplicate(
      db,
      { submissionId: row.id, headline: row.headline, story: row.story, contentHash: row.hash },
      THRESHOLD,
    );

    expect(result.duplicateOf).toBeNull();
    expect(result.duplicateScore).toBe(0);
  });

  it('matches an earlier submission with the same content hash', async () => {
    const original = await seed();
    const copy = await seed({ hash: original.hash });

    const result = await findDuplicate(
      db,
      { submissionId: copy.id, headline: copy.headline, story: copy.story, contentHash: copy.hash },
      THRESHOLD,
    );

    expect(result.duplicateOf).toBe(original.id);
    expect(result.duplicateScore).toBe(1);
    expect(result.matchedOn).toBe('content_hash');
  });

  it('matches an earlier submission by story similarity, including rejected rows', async () => {
    const original = await seed({ status: 'rejected' });
    const copy = await seed({
      headline: 'A Completely Different Headline',
      story: original.story,
    });

    const result = await findDuplicate(
      db,
      { submissionId: copy.id, headline: copy.headline, story: copy.story, contentHash: copy.hash },
      THRESHOLD,
    );

    expect(result.duplicateOf).toBe(original.id);
    expect(result.matchedOn).toBe('story');
    expect(result.storyScore).toBe(1);
  });

  it('never treats empty or emoji-only content as a duplicate', async () => {
    await seed({ story: '   ', hash: contentHash('   ') });

    const empty = await findDuplicate(
      db,
      { submissionId: 'sub_unknown', headline: '', story: '', contentHash: contentHash('') },
      THRESHOLD,
    );
    expect(empty.duplicateOf).toBeNull();
    expect(empty.duplicateScore).toBe(0);

    const emoji = await findDuplicate(
      db,
      {
        submissionId: 'sub_unknown',
        headline: '🔥🔥🔥',
        story: '🔥🔥🔥',
        contentHash: contentHash('🔥🔥🔥'),
      },
      THRESHOLD,
    );
    expect(emoji.duplicateOf).toBeNull();
    expect(emoji.duplicateScore).toBe(0);
  });

  it('ignores stored submissions whose body is empty', async () => {
    const emptyRow = await seed({ story: '   ', hash: contentHash('   ') });
    const real = await seed();

    const result = await findDuplicate(
      db,
      {
        submissionId: real.id,
        headline: emptyRow.headline,
        story: real.story,
        contentHash: real.hash,
      },
      THRESHOLD,
    );

    expect(result.duplicateOf).toBeNull();
  });

  it('ignores empty article bodies and the submission own article', async () => {
    const row = await seed();
    await seedArticle({ submissionId: row.id, originalBody: row.story });
    await seedArticle({ submissionId: row.id, originalBody: '   ' });

    const ownArticle = await findDuplicate(
      db,
      { submissionId: row.id, headline: row.headline, story: row.story, contentHash: row.hash },
      THRESHOLD,
    );
    expect(ownArticle.duplicateOf).toBeNull();

    const other = await seed();
    await seedArticle({ submissionId: other.id, originalBody: other.story });
    const shared = await findDuplicate(
      db,
      {
        submissionId: 'sub_fresh',
        headline: other.headline,
        story: other.story,
        contentHash: 'fresh-hash',
      },
      THRESHOLD,
    );
    expect(shared.duplicateOf).toBe(other.id);
    expect(shared.matchedOn).toBe('original_body');
  });

  it('keeps the best score below the threshold but does not flag a duplicate', async () => {
    await seed({
      headline: 'A Totally Unrelated Headline About Something Else',
      story:
        'The canteen introduced a new menu with several items that students politely described as interesting.',
    });
    const incoming = await seed({
      headline: 'Library Extends Opening Hours During Exam Week',
      story:
        'A different report about the library extending its opening hours during the exam week for students.',
    });

    const result = await findDuplicate(
      db,
      {
        submissionId: incoming.id,
        headline: incoming.headline,
        story: incoming.story,
        contentHash: incoming.hash,
      },
      THRESHOLD,
    );

    expect(result.duplicateOf).toBeNull();
    expect(result.matchedOn).toBeNull();
    expect(result.duplicateScore).toBeLessThan(THRESHOLD);
  });
});
