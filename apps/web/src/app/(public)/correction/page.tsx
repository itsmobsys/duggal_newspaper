import type { Metadata } from 'next';
import Link from 'next/link';
import { CorrectionForm } from '@/components/forms/CorrectionForm';
import styles from '@/components/forms/forms.module.css';

export const metadata: Metadata = {
  title: 'Request a correction',
  description:
    'Ask the Duggal Badmosh Daily to correct a published story. Every request is reviewed and logged; submitting one does not guarantee publication.',
  robots: { index: false },
};

interface CorrectionPageProps {
  /** `?article=` is supplied by the correction link at the foot of every story. */
  searchParams: Promise<{ article?: string | string[] }>;
}

export default async function CorrectionPage({
  searchParams,
}: CorrectionPageProps): Promise<React.JSX.Element> {
  const query = await searchParams;
  const rawArticle = Array.isArray(query.article) ? query.article[0] : query.article;
  const articleId = (rawArticle ?? '').trim();

  return (
    <div className="container">
      <header className="page-head">
        <p className="eyebrow">The record</p>
        <h1>Request a correction</h1>
        <p className="lede">
          If a published story got something wrong, ask for it to be fixed in the open. You do not
          need an account, and you do not need to be the person the story is about.
        </p>
      </header>

      <div className={`section ${styles.split}`}>
        <div>
          <CorrectionForm key={articleId || 'manual'} articleId={articleId} />
        </div>

        <aside className={styles.aside} aria-labelledby="correction-process">
          <div className={styles.card}>
            <h2 className={styles.cardTitle} id="correction-process">
              Reviewed and logged
            </h2>
            <p className={styles.note}>
              Every request is recorded with the article, what you say is wrong, and the
              desk&rsquo;s decision. The log exists so the paper can be held to the same record it
              asks everyone else to keep.
            </p>
            <ul className={styles.ruleList}>
              <li>
                <strong>Only published stories</strong>
                Drafts and unpublished filings cannot be corrected. The article must already be in
                the paper.
              </li>
              <li>
                <strong>A human decides</strong>
                The desk checks the story and its sources. A request that is wrong, abusive or
                simply disagrees with the story will be closed.
              </li>
              <li>
                <strong>Not every request runs</strong>
                Submitting a correction does not guarantee that a correction will be published, or
                that the story will be changed in the way you ask.
              </li>
            </ul>
          </div>

          <div className={styles.card}>
            <h2 className={styles.cardTitle}>What to include</h2>
            <ul className={styles.ruleList}>
              <li>
                <strong>The exact problem</strong>
                Quote the sentence or name the figure that is wrong.
              </li>
              <li>
                <strong>The correct version</strong>
                Say what it should be, with a public link or a source the desk can check.
              </li>
              <li>
                <strong>Your name, if you like</strong>
                Optional. It helps the desk follow up, and it stays with the request rather than
                becoming a byline.
              </li>
            </ul>
            <p className={styles.note}>
              Reporting harassment, privacy or spam? Use{' '}
              <Link
                href={articleId ? `/report?article=${encodeURIComponent(articleId)}` : '/report'}
              >
                report a problem
              </Link>{' '}
              so it reaches the risk desk.
            </p>
          </div>

          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Already published</h2>
            <p className={styles.note}>
              Corrections that are accepted are added to the article and noted as a correction.
              There is no separate corrections page, and no quiet deletion: the record changes in
              public.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
