import type { Metadata } from 'next';
import Link from 'next/link';
import { ContactNote } from '@/components/collections/ContactNote';
import { getPublicSettings, siteUrl } from '@/lib/settings';
import styles from './page.module.css';

export const revalidate = 3600;

/** Fixed in configuration and never silently swapped. Mirrors README / apps/api config. */
const AI_MODEL_ID = 'nvidia/nemotron-3.5-super-vl-120b-a12b';

const SECTIONS: Array<{ id: string; label: string }> = [
  { id: 'what-this-is', label: 'What this paper is' },
  { id: 'ai-disclosure', label: 'AI disclosure' },
  { id: 'what-ai-may-rewrite', label: 'What the AI may rewrite' },
  { id: 'what-ai-must-never-do', label: 'What it must never do' },
  { id: 'risk-holds', label: 'Stories held for a human' },
  { id: 'photo-policy', label: 'Photo policy' },
  { id: 'corrections', label: 'Corrections' },
  { id: 'reporting', label: 'Reporting a problem' },
  { id: 'votes-and-reviews', label: 'Votes and reviews' },
  { id: 'anonymity-and-privacy', label: 'Anonymity and privacy' },
  { id: 'ai-failures', label: 'When the AI fails' },
  { id: 'contact', label: 'Contact' },
];

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getPublicSettings();
  const baseUrl = siteUrl(settings);
  const description = `How ${settings.site.name} is written: what the AI desk may rewrite, what it must never invent, how photos and anonymity are handled, and how to request a correction.`;

  return {
    title: 'Standards & corrections',
    description,
    alternates: { canonical: `${baseUrl}/standards` },
    openGraph: {
      type: 'article',
      siteName: settings.site.name,
      title: `Standards & corrections — ${settings.site.name}`,
      description,
      url: `${baseUrl}/standards`,
    },
  };
}

export default async function StandardsPage(): Promise<React.JSX.Element> {
  const settings = await getPublicSettings();

  return (
    <div className="container">
      <header className="page-head">
        <div className="accent-bar" aria-hidden="true" />
        <p className="eyebrow">How the desk works</p>
        <h1>Standards &amp; corrections</h1>
        <p className="lede">
          This page is a description of the running system, not a dated policy document. Behaviour
          is enforced by code and configuration, and this page is edited when that behaviour
          changes.
        </p>
      </header>

      <nav className={styles.toc} aria-label="On this page">
        <p className={styles.tocLabel}>On this page</p>
        <ol>
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`}>{section.label}</a>
            </li>
          ))}
        </ol>
      </nav>

      <article className={styles.prose}>
        <section aria-labelledby="what-this-is">
          <h2 id="what-this-is">What this paper is</h2>
          <p>
            {settings.site.name} is a community newspaper written from reader submissions. Stories
            arrive through the submission form, the AI desk rewrites them into house style, and a
            dated edition is assembled each night. The paper is autonomous by default: routine copy
            publishes without a human reading it first.
          </p>
          <p>
            Humans are not absent. An owner account can hold, unpublish or delete copy, resolve
            corrections and reports, and stop the scheduler entirely. What humans do not do is write
            the stories.
          </p>
        </section>

        <section aria-labelledby="ai-disclosure">
          <h2 id="ai-disclosure">AI disclosure</h2>
          <p>
            The desk runs on NVIDIA Nemotron, fixed in configuration at <code>{AI_MODEL_ID}</code>.
            The model is never silently swapped for another one; the identifier lives in the
            repository and in the running configuration.
          </p>
          <p>
            Every story drafted by the desk is stored with a record of the model that drafted it,
            and the article page carries an <strong>AI disclosure</strong> naming that model. Reader
            submissions are kept as originals: the AI output is a separate rewrite, always
            attributed as AI-assisted.
          </p>
        </section>

        <section aria-labelledby="what-ai-may-rewrite">
          <h2 id="what-ai-may-rewrite">What the AI may rewrite</h2>
          <ul>
            <li>The body copy, edited into the paper&rsquo;s style and length.</li>
            <li>
              The headline and the dek, written to fit the story as filed — not to make a bigger
              claim than the submission supports.
            </li>
            <li>Captions for submitted photos, written from what the photo actually shows.</li>
            <li>Tags, and the section the story runs in.</li>
          </ul>
          <p>
            The model may also read a submission to spot spam and copy that carries concrete legal
            risk. That reading changes the routing of a story; it does not change the pictures that
            were sent.
          </p>
        </section>

        <section aria-labelledby="what-ai-must-never-do">
          <h2 id="what-ai-must-never-do">What it must never do</h2>
          <ul>
            <li>Invent facts, quotes, figures, people or sources.</li>
            <li>Add a byline or contributor that was not on the submission.</li>
            <li>
              Generate, edit or substitute a photograph. Photos are only ever the files readers
              sent.
            </li>
            <li>Present its rewrite as the reader&rsquo;s original words.</li>
            <li>
              Publish private personal data or dangerous instructions without a human decision.
            </li>
          </ul>
          <p>
            These rules are written into the model&rsquo;s instructions and enforced around it: the
            original text and photos are always retained, and AI output is stored separately from
            the submission.
          </p>
        </section>

        <section aria-labelledby="risk-holds">
          <h2 id="risk-holds">Stories held for a human</h2>
          <p>
            Deterministic checks run before the model does — blocked domains, banned terms, hold
            keywords and spam heuristics. Routine stories publish themselves; only the narrow list
            below is parked in a review queue instead.
          </p>
          <p>Copy that is held rather than published involves:</p>
          <ul>
            <li>Credible threats of violence against a real person.</li>
            <li>Instructions for weapons, explosives, drugs or self-harm.</li>
            <li>Private personal data, such as addresses, phone numbers or documents.</li>
            <li>Sexual content involving minors, or non-consensual sexual content.</li>
            <li>Slurs aimed at a protected group.</li>
            <li>Active fraud or phishing.</li>
          </ul>
          <p>
            A held story is not deleted. It waits with its reasons attached until a person publishes
            it, rejects it, or asks the desk to try again.
          </p>
        </section>

        <section aria-labelledby="photo-policy">
          <h2 id="photo-policy">Photo policy</h2>
          <p>
            Photographs are optional attachments on submissions, sent by the readers who filed the
            stories. Every file is validated, re-encoded, stripped of metadata and stored under a
            random key before it is served. The image is never generated, content-edited or
            replaced, and the AI desk never sees or captions your photo file — captions come from
            the words you attach to the submission, if any.
          </p>
          <p>
            The submission form enforces the configured limits on how many photos a story may carry
            and how large each one may be. Stories without photos run without them, using a
            typographic block rather than a stand-in image. The full gallery, with each photo linked
            to its story, is on the <Link href="/photos">photo desk</Link>.
          </p>
        </section>

        <section aria-labelledby="corrections">
          <h2 id="corrections">Corrections</h2>
          <p>
            If a story is wrong, ask for a correction. Correction requests are recorded against the
            article and reviewed by a person. When one is accepted, a dated correction line is
            appended to the story rather than the original text being quietly rewritten, and the
            correction is published with the article.
          </p>
          <p>
            <Link className="button button--sm button--ghost" href="/correction">
              Request a correction
            </Link>
          </p>
        </section>

        <section aria-labelledby="reporting">
          <h2 id="reporting">Reporting a problem</h2>
          <p>
            Reports cover everything that is not a factual correction: harassment, privacy,
            plagiarism, spam, or a story that should not have run at all. A report is recorded
            against the article and handled by a person in the admin console.
          </p>
          <p>
            <Link className="button button--sm button--ghost" href="/report">
              Report a problem
            </Link>
          </p>
        </section>

        <section aria-labelledby="votes-and-reviews">
          <h2 id="votes-and-reviews">Votes and reviews</h2>
          <p>
            Readers can like or dislike a story and leave a star rating with a written review. No
            account is needed. One browser gets one vote and one review per story, tracked by a
            random httpOnly cookie; the server stores only a hash of that cookie, never the token
            itself. Both can be changed or removed, and clearing cookies starts a fresh identity.
          </p>
          <p>
            Reviews publish immediately when they pass the spam checks. Reviews with links, banned
            words or other spam signals are held for a human. A moderator can hide or delete a
            review; hiding keeps the record for audit and removes it from the story and the weekly{' '}
            <Link href="/leaderboard">leaderboard</Link>. Display names are optional, and blank
            names appear as &ldquo;Anonymous reader.&rdquo;
          </p>
          <p>
            The weekly table counts net votes plus a review term capped at ten reviews, so a pile-on
            has a limited effect. Only stories published in the current Monday-to-Sunday week in the
            newsroom timezone, and only published reviews, are ranked.
          </p>
        </section>

        <section aria-labelledby="anonymity-and-privacy">
          <h2 id="anonymity-and-privacy">Anonymity and privacy</h2>
          <p>
            You can file without giving a name. Identity is self-declared and unverified — there is
            no login, no OAuth and no Discord bot checking who you are. A Discord handle is credited
            only when the submitter supplies one and does not choose to be anonymous.
          </p>
          <p>
            Anonymous submissions never publish a name or handle. The desk does store submissions
            privately for moderation, and it hashes the submitting IP address for rate limiting and
            abuse handling; that hash is not published and is not a name. The{' '}
            <Link href="/status">status page</Link> shows a submission&rsquo;s progress from a
            private token.
          </p>
        </section>

        <section aria-labelledby="ai-failures">
          <h2 id="ai-failures">When the AI fails</h2>
          <p>
            A submission is never lost because the model was unavailable. If the desk cannot process
            a story, it is parked rather than dropped, and retried with backoff — quickly for rate
            limits, more slowly otherwise. A daily recovery pass requeues anything that exhausted
            its attempts, and a scheduled edition is still written as a deterministic fallback
            layout if the AI cannot finish.
          </p>
          <p>
            The same applies to awards: a weekly round that cannot name a real contributor writes
            nothing. An empty result is preferred to a fabricated one.
          </p>
        </section>

        <section aria-labelledby="contact">
          <h2 id="contact">Contact</h2>
          <ContactNote
            contact={settings.site.contactDiscord}
            fallbackHref="/about"
            fallbackLabel="read about the paper"
          />
          <p>
            Security issues should not be posted publicly with an exploit. Use the contact above, or
            open an issue without reproduction details.
          </p>
        </section>
      </article>
    </div>
  );
}
