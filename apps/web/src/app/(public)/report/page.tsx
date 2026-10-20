import type { Metadata } from 'next';
import Link from 'next/link';
import { ReportForm } from '@/components/forms/ReportForm';
import styles from '@/components/forms/forms.module.css';

export const metadata: Metadata = {
  title: 'Report a problem',
  description:
    'Flag a factual error, missing context, privacy problem or scam in a Duggal Badmosh Daily story. Reports are read by a human.',
  robots: { index: false },
};

interface ReportPageProps {
  /** `?article=` is supplied by the report link at the foot of every story. */
  searchParams: Promise<{ article?: string | string[] }>;
}

export default async function ReportPage({
  searchParams,
}: ReportPageProps): Promise<React.JSX.Element> {
  const query = await searchParams;
  const rawArticle = Array.isArray(query.article) ? query.article[0] : query.article;
  const articleId = (rawArticle ?? '').trim();

  return (
    <div className="container">
      <header className="page-head">
        <p className="eyebrow">The complaints desk</p>
        <h1>Report a problem</h1>
        <p className="lede">
          Something in a story is wrong, unfair or unsafe? Flag it here. A human reads every report;
          the robot that wrote the story does not get a vote.
        </p>
      </header>

      <div className={`section ${styles.split}`}>
        <div>
          <ReportForm key={articleId || 'manual'} articleId={articleId} />
        </div>

        <aside className={styles.aside} aria-labelledby="report-qualifies">
          <div className={styles.card}>
            <h2 className={styles.cardTitle} id="report-qualifies">
              What qualifies
            </h2>
            <ul className={styles.ruleList}>
              <li>
                <strong>Factual errors</strong>A name, number, date, place or quote that is wrong.
                Point at the sentence if you can.
              </li>
              <li>
                <strong>Misleading or missing context</strong>
                The facts are technically right but the story leaves out something that changes what
                they mean.
              </li>
              <li>
                <strong>Harassment or privacy</strong>A private address, phone number, ID number,
                private message or photo of someone who did not agree to be in the paper.
              </li>
              <li>
                <strong>Spam or scam</strong>A story pushing a fake giveaway, a phishing link or a
                paid scheme dressed up as news.
              </li>
              <li>
                <strong>Anything else</strong>
                Pick “Other” and explain. The desk would rather read a strange report than miss a
                real problem.
              </li>
            </ul>
          </div>

          <div className={styles.card}>
            <h2 className={styles.cardTitle}>What happens next</h2>
            <ol className={styles.ruleList}>
              <li>
                <strong>1. It lands with a human</strong>
                The report is attached to the story and logged. It is not published, and it does not
                appear under the article.
              </li>
              <li>
                <strong>2. The desk checks the record</strong>A reporter compares the report with
                the story and its sources. That can take a while, especially on a busy edition.
              </li>
              <li>
                <strong>3. The story is fixed or it stands</strong>
                If the story is wrong, the desk edits it and notes the change. If it is not, the
                report is closed without a public argument.
              </li>
            </ol>
            <p className={styles.note}>
              A report flags a problem. If you want a formal correction recorded against the
              article, use{' '}
              <Link
                href={
                  articleId ? `/correction?article=${encodeURIComponent(articleId)}` : '/correction'
                }
              >
                request a correction
              </Link>
              .
            </p>
          </div>

          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Not a tip line</h2>
            <p className={styles.note}>
              Have a story the paper has not printed?{' '}
              <Link href="/submit">Send it to the filing desk</Link> instead. Reports are for
              problems with stories that already exist.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
