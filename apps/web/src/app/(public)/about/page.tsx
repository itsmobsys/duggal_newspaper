import type { Metadata } from 'next';
import Link from 'next/link';
import { ContactNote } from '@/components/collections/ContactNote';
import { SectionHeading } from '@/components/SectionHeading';
import { formatNumber } from '@/lib/format';
import { getSiteStats } from '@/lib/queries';
import { getPublicSettings, siteUrl } from '@/lib/settings';
import styles from './page.module.css';

export const revalidate = 3600;

const REPO_URL = 'https://github.com/itsmobsys/duggal_newspaper';
/** Fixed in configuration and never silently swapped. Mirrors README / apps/api config. */
const AI_MODEL_ID = 'nvidia/nemotron-3.5-super-vl-120b-a12b';

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getPublicSettings();
  const baseUrl = siteUrl(settings);
  const description = `${settings.site.name} is written by an AI desk from reader submissions, on free tiers, under the MIT licence. How a tip becomes a dated edition.`;

  return {
    title: 'About this paper',
    description,
    alternates: { canonical: `${baseUrl}/about` },
    openGraph: {
      type: 'website',
      siteName: settings.site.name,
      title: `About this paper — ${settings.site.name}`,
      description,
      url: `${baseUrl}/about`,
    },
  };
}

export default async function AboutPage(): Promise<React.JSX.Element> {
  const [settings, stats] = await Promise.all([getPublicSettings(), getSiteStats()]);
  const nothingPublished = stats.articles === 0 && stats.editions === 0;

  return (
    <div className="container">
      <header className="page-head">
        <div className="accent-bar" aria-hidden="true" />
        <p className="eyebrow">Who writes this, and how</p>
        <h1>About this paper</h1>
        <p className="lede">
          Tips arrive from the community. An AI desk writes them up. A dated edition goes live at
          midnight IST, every night, with no editor in the loop. Humans hold the brake, review the
          genuinely risky copy, and fix the typos the robot insists are voice.
        </p>
      </header>

      <section className="section" aria-labelledby="stats-heading">
        <SectionHeading id="stats-heading" title="Live from the database" />
        <div className="stat-grid">
          <div className="stat">
            <span className="label">Stories published</span>
            <span className="value">{formatNumber(stats.articles)}</span>
          </div>
          <div className="stat">
            <span className="label">Distinct bylines</span>
            <span className="value">{formatNumber(stats.contributors)}</span>
          </div>
          <div className="stat">
            <span className="label">Editions printed</span>
            <span className="value">{formatNumber(stats.editions)}</span>
          </div>
          <div className="stat">
            <span className="label">Photographs on file</span>
            <span className="value">{formatNumber(stats.photos)}</span>
          </div>
        </div>
        <p className={styles.statsNote}>
          {nothingPublished
            ? 'These are real counts read from the paper’s own database, and right now they are zero. Zero means the press has not printed an edition yet — not that the numbers are broken. The first edition changes them.'
            : `Counts are read live from the paper’s database on every refresh, not typed in by hand. Anonymous stories share a single “Anonymous” byline, so they count once, however many people filed them.`}
        </p>
      </section>

      <section className="section" aria-labelledby="flow-heading">
        <SectionHeading id="flow-heading" title="How a tip becomes a dated edition" />
        <ol className="steps">
          <li className="step">
            <div>
              <strong>Submit</strong>
              <span>
                A reader files a headline, the story, an optional source link, up to the configured
                number of photos, a section, and a name, a Discord handle, or nothing at all.
              </span>
            </div>
          </li>
          <li className="step">
            <div>
              <strong>Checks run first</strong>
              <span>
                Blocked domains, banned terms, hold keywords, duplicate hashes and spam heuristics
                run before any model is called.
              </span>
            </div>
          </li>
          <li className="step">
            <div>
              <strong>The AI desk writes it up</strong>
              <span>
                The model rewrites the copy, writes the headline and dek, captions the photos, picks
                a section, and flags anything that looks risky.
              </span>
            </div>
          </li>
          <li className="step">
            <div>
              <strong>Publish or hold</strong>
              <span>
                Routine copy publishes itself to the live site immediately. Copy that trips a risk
                rule waits for a person. Nothing is silently dropped.
              </span>
            </div>
          </li>
          <li className="step">
            <div>
              <strong>23:00 IST — the edition is assembled</strong>
              <span>
                The desk builds tomorrow’s edition from the day’s published stories. If the model is
                unavailable, a deterministic fallback layout is written instead.
              </span>
            </div>
          </li>
          <li className="step">
            <div>
              <strong>00:00 IST — the edition goes live</strong>
              <span>
                The date rolls over, the front page starts reading the new edition, and the previous
                one takes its place on <Link href="/editions">the editions shelf</Link>.
              </span>
            </div>
          </li>
        </ol>
      </section>

      <section className="section" aria-labelledby="tech-heading">
        <SectionHeading id="tech-heading" title="What it runs on" />
        <ul className={styles.tech}>
          <li>
            <strong>Next.js 15 on Vercel</strong> — the public site and the admin console, rendered
            statically with revalidation, so publishing never waits for a deploy.
          </li>
          <li>
            <strong>Fastify on Render</strong> — submission handling, a durable queue in SQLite, and
            the worker that processes stories.
          </li>
          <li>
            <strong>Turso</strong> — a libSQL database for stories, editions, awards, jobs and
            settings. Text and metadata only; photos live elsewhere.
          </li>
          <li>
            <strong>NVIDIA Nemotron</strong> — <code>{AI_MODEL_ID}</code>, used for drafting,
            captions and risk-reading through the NVIDIA API.
          </li>
          <li>
            <strong>Cloudflare R2</strong> — object storage for the photos readers submit.
          </li>
          <li>
            <strong>GitHub Actions</strong> — a five-minute worker tick that also keeps the free
            instance warm.
          </li>
        </ul>
        <p className={styles.statsNote}>
          Everything runs on free tiers: Vercel Hobby, Render Free, Turso Free, Cloudflare R2 and
          the NVIDIA developer API. There is no Redis and no Postgres to keep alive.
        </p>
      </section>

      <section className="section" aria-labelledby="open-heading">
        <SectionHeading id="open-heading" title="Open source" />
        <p className={styles.body}>
          The whole paper is MIT licensed and public. You can read the code that makes the claims on
          this page true, run it locally, or fork it for a community of your own.
        </p>
        <p className={styles.body}>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
            github.com/itsmobsys/duggal_newspaper
            <span className="visually-hidden"> (opens in a new tab)</span>
          </a>
          {' · '}
          <a href={`${REPO_URL}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer">
            MIT licence
            <span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        </p>
      </section>

      <section className="section" aria-labelledby="independence-heading">
        <SectionHeading id="independence-heading" title="Independence" />
        <p className={styles.body}>
          This is an independent community project. It is not affiliated with, endorsed by, or
          operated by Discord, and it has no Discord bot and no OAuth app. Discord is simply where
          the community already talks and where tips usually start.
        </p>
        <p className={styles.body}>
          Nothing here is an official record of anything except itself. If the paper says something
          wrong, the response is a correction, not a retraction of the whole idea — see{' '}
          <Link href="/standards">standards &amp; corrections</Link>.
        </p>
      </section>

      <section className="section" aria-labelledby="about-contact-heading">
        <SectionHeading id="about-contact-heading" title="Contact" />
        <div className={styles.body}>
          <ContactNote
            contact={settings.site.contactDiscord}
            fallbackHref="/submit"
            fallbackLabel="file a story and the desk will see it"
          />
        </div>
      </section>
    </div>
  );
}
