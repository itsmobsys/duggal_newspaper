import type { Metadata } from 'next';
import Link from 'next/link';
import { SubmitForm } from '@/components/forms/SubmitForm';
import { pluralise } from '@/lib/format';
import { getCategories } from '@/lib/queries';
import { getPublicSettings } from '@/lib/settings';
import { getCurrentUser } from '@/lib/user';
import styles from '@/components/forms/forms.module.css';

export const metadata: Metadata = {
  title: 'Submit a story',
  description:
    'Send a story, tip or photo to the Duggal Badmosh Daily newsroom. Reader submissions only — the AI desk rewrites in house style, and risky stories are held for a human.',
  alternates: { canonical: '/submit' },
};

export default async function SubmitPage(): Promise<React.JSX.Element> {
  const settings = await getPublicSettings();
  const categories = await getCategories();
  const user = await getCurrentUser();
  const submissions = settings.submissions;

  return (
    <div className="container">
      <header className="page-head">
        <p className="eyebrow">The filing desk</p>
        <h1>Send a story to the desk</h1>
        <p className="lede">
          Reader submissions only. The AI desk rewrites every story into house style; the boring
          ones may publish on their own, the risky ones are held for a human with opinions. Photos
          stay exactly as submitted.
        </p>
      </header>

      <div className={`section ${styles.split}`}>
        <div>
          {user ? (
            <SubmitForm
              settings={submissions}
              categories={categories}
              timeZone={settings.site.timezone}
              user={user}
            />
          ) : (
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Sign in to file</h2>
              <p className={styles.note}>
                Every story is tied to a Discord account, even when it is published anonymously.
                That is the whole anti-spam policy and most of the legal one.
              </p>
              <p>
                <a
                  className="button button--primary"
                  href={`/api/auth/discord?next=${encodeURIComponent('/submit')}`}
                >
                  Login with Discord
                </a>
              </p>
              <p className={styles.note}>
                The desk asks Discord for your user ID, username, display name and avatar. No email,
                no friends list, no servers — just enough to know who filed the story.
              </p>
            </div>
          )}
        </div>

        <aside className={styles.aside} aria-labelledby="filing-rules">
          <div className={styles.card}>
            <h2 className={styles.cardTitle} id="filing-rules">
              The rules
            </h2>
            <ul className={styles.ruleList}>
              <li>
                <strong>Length</strong>
                Between {submissions.minStoryChars} and {submissions.maxStoryChars} characters.
                Headlines get {submissions.maxHeadlineChars}. The desk counts, and so should you.
              </li>
              <li>
                <strong>Photos</strong>
                Up to {pluralise(submissions.maxImages, 'photo')}, JPEG, PNG or WebP,{' '}
                {submissions.maxImageMb} MB each. Photos run as sent — no retouching, no filters, no
                exceptions.
              </li>
              <li>
                <strong>No AI-generated images</strong>
                We already have a robot. It writes; it does not need your robot pictures.
              </li>
              <li>
                <strong>No private data</strong>
                No addresses, phone numbers, ID numbers, private messages or anything else that
                belongs to someone who did not hand it to you. It will be cut, and the story may go
                with it.
              </li>
              <li>
                <strong>Source links</strong>
                {submissions.requireSourceUrl
                  ? ' A public http(s) link to the original post or source is required. Private chats do not qualify.'
                  : ' Optional, but a public http(s) link to the original post or source makes the risk desk much happier.'}
              </li>
              <li>
                <strong>Anonymity</strong>
                {submissions.anonymousAllowed
                  ? ' Available. Your name and Discord handle stay private; your account of events does not.'
                  : ' Closed right now. Your Discord display name will be considered for publication.'}
              </li>
              <li>
                <strong>One at a time</strong>
                Repeat filings are rate-limited per connection. Filing the same story twice does not
                make it twice as true.
              </li>
            </ul>
          </div>

          <div className={styles.card}>
            <h2 className={styles.cardTitle}>What happens next</h2>
            <ol className={styles.ruleList}>
              <li>
                <strong>1. It lands in the queue</strong>
                You get a tracking token. Keep it; the desk does not send reminders.
              </li>
              <li>
                <strong>2. The AI desk rewrites</strong>
                House style, shorter sentences, fewer adjectives. The facts are supposed to survive.
              </li>
              <li>
                <strong>3. Publish or hold</strong>
                Routine stories can go live automatically. Anything risky waits for a human, who may
                take their time.
              </li>
            </ol>
            <p className={styles.note}>
              You can watch all of this at <Link href="/status">the tracking page</Link> with your
              token. A rejected story is still a filed story — the robots are not sentimental.
            </p>
          </div>

          {settings.site.contactDiscord ? (
            <p className={styles.note}>
              Something broken? Find the desk on Discord: {settings.site.contactDiscord}.
            </p>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
