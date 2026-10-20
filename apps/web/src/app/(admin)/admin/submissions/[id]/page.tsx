import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { CategoryOption } from '@/components/admin/SubmissionActions';
import { SubmissionActions } from '@/components/admin/SubmissionActions';
import EditorOverride from '@/components/admin/EditorOverride';
import { adminServerFetch } from '@/lib/admin-server';
import { ApiError } from '@/lib/api';
import { formatDateTime, relativeTime } from '@/lib/format';
import styles from '@/components/admin/admin.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Submission',
  robots: { index: false, follow: false },
};

interface SubmissionImage {
  id: string;
  url: string;
  thumb_url: string | null;
  caption: string | null;
  alt_text: string | null;
  attribution: string | null;
  width: number | null;
  height: number | null;
}

interface PublishedArticle {
  id: string;
  slug: string;
  headline: string;
  status: string;
  category_slug: string;
  breaking: number;
  published_at: string | null;
}

interface SubmissionRecord {
  id: string;
  headline: string;
  story: string;
  author_name: string;
  discord_handle: string | null;
  category_slug: string | null;
  source_url: string | null;
  anonymous: boolean;
  identity_mode: string;
  status: string;
  review_reason: string | null;
  reviewReasons: string[];
  spam_score: number;
  ai_model: string | null;
  ai_attempts: number;
  ai_last_error: string | null;
  aiResult: unknown;
  article_id: string | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface SubmissionDetailResponse {
  submission: SubmissionRecord;
  images: SubmissionImage[];
  article: PublishedArticle | null;
}

interface CategoriesResponse {
  categories: Array<{ slug: string; name: string; enabled: number }>;
}

interface SubmissionDetailPageProps {
  params: Promise<{ id: string }>;
}

function isNextControlFlow(error: unknown): boolean {
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === 'string' && /^NEXT_(REDIRECT|NOT_FOUND)/.test(digest);
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'published':
      return 'badge badge--published';
    case 'queued_review':
      return 'badge badge--review';
    case 'failed':
      return 'badge badge--failed';
    case 'processing':
      return 'badge badge--warn';
    case 'rejected':
      return 'badge badge--muted';
    default:
      return 'badge badge--info';
  }
}

function scoreText(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function safeExternalUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/* AI results are stored as JSON written by a model. Read them defensively:
   a missing or malformed field must render as unknown, never as a guess. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function readTextList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => readText(entry)).filter((entry): entry is string => entry !== null);
}

export default async function AdminSubmissionDetailPage({
  params,
}: SubmissionDetailPageProps): Promise<React.JSX.Element> {
  const { id } = await params;

  let data: SubmissionDetailResponse;
  try {
    data = await adminServerFetch<SubmissionDetailResponse>(
      `/admin/submissions/${encodeURIComponent(id)}`,
    );
  } catch (caught) {
    if (isNextControlFlow(caught)) throw caught;
    if (caught instanceof ApiError && caught.status === 404) notFound();
    throw caught;
  }

  // Categories are only used as datalist suggestions for manual publishing;
  // they are not worth failing the page over.
  let categories: CategoryOption[] = [];
  try {
    const response = await adminServerFetch<CategoriesResponse>('/admin/categories');
    categories = response.categories
      .filter((category) => category.enabled === 1)
      .map((category) => ({ slug: category.slug, name: category.name }));
  } catch (caught) {
    if (isNextControlFlow(caught)) throw caught;
  }

  const { submission, images, article } = data;
  const ai = asRecord(submission.aiResult);
  const review = ai ? asRecord(ai.review) : null;

  const reviewNeeded = review ? readBoolean(review.needed) : null;
  const aiReasons = review ? readTextList(review.reasons) : [];
  const aiSummary = ai ? readText(ai.summary) : null;
  const aiHeadline = ai ? readText(ai.headline) : null;

  const decision =
    reviewNeeded === null
      ? 'Unknown'
      : reviewNeeded
        ? 'Held by the editorial gate'
        : 'Cleared for publication';

  const sourceUrl = safeExternalUrl(submission.source_url);
  const identity = submission.anonymous ? 'Anonymous' : submission.identity_mode;

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{submission.headline}</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            <span className={statusBadgeClass(submission.status)}>
              {statusLabel(submission.status)}
            </span>{' '}
            · filed {formatDateTime(submission.created_at)} · updated{' '}
            {relativeTime(submission.updated_at)}
          </p>
        </div>
        <Link className={styles.panelLink} href="/admin/submissions">
          ← All submissions
        </Link>
      </div>

      {submission.reviewReasons.length > 0 ? (
        <div className={`alert alert--warn ${styles.noticeBar}`}>
          <h3>Flags raised by the desk</h3>
          <ul>
            {submission.reviewReasons.map((reason, index) => (
              <li key={`${index}-${reason}`}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <EditorOverride
        submissionId={submission.id}
        status={submission.status}
        flags={submission.reviewReasons}
      />

      {submission.ai_last_error ? (
        <div className={`alert alert--error ${styles.noticeBar}`} role="alert">
          <h3>Last AI error</h3>
          <p>{submission.ai_last_error}</p>
        </div>
      ) : null}

      <div className="admin-split">
        <div className="stack">
          <section className="panel" aria-labelledby="story-heading">
            <h2 id="story-heading">Submitted story</h2>
            <p className={styles.titleMeta}>
              {submission.story.length.toLocaleString('en-IN')} characters ·{' '}
              {submission.anonymous ? 'anonymous submission' : `identity: ${identity}`}
            </p>
            <div className={styles.storyText}>{submission.story}</div>
          </section>

          {images.length > 0 ? (
            <section className="panel" aria-labelledby="photos-heading">
              <h2 id="photos-heading">Photos ({images.length})</h2>
              <div className={styles.photoGrid}>
                {images.map((image) => (
                  <figure className={styles.photo} key={image.id}>
                    {/* Uploads come from storage at arbitrary hosts: next/image cannot optimise them. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={image.thumb_url || image.url}
                      alt={image.alt_text || image.caption || 'Photograph submitted with the story'}
                      loading="lazy"
                      width={image.width ?? undefined}
                      height={image.height ?? undefined}
                    />
                    <figcaption>
                      {image.caption || 'No caption supplied.'}
                      {image.attribution ? ` — ${image.attribution}` : ''}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </section>
          ) : null}

          {aiSummary ? (
            <section className="panel" aria-labelledby="ai-summary-heading">
              <h2 id="ai-summary-heading">Desk summary</h2>
              <p>{aiSummary}</p>
            </section>
          ) : null}
        </div>

        <aside className="stack" aria-label="Submission details">
          <section className="panel" aria-labelledby="record-heading">
            <h2 id="record-heading">Submission record</h2>
            <dl className={`kv ${styles.kvTight}`}>
              <dt>Submitter</dt>
              <dd>{submission.anonymous ? 'Anonymous' : submission.author_name || 'Unnamed'}</dd>
              <dt>Discord</dt>
              <dd>{submission.discord_handle || '—'}</dd>
              <dt>Identity</dt>
              <dd>{identity}</dd>
              <dt>Category</dt>
              <dd>{submission.category_slug || '—'}</dd>
              <dt>Source</dt>
              <dd>
                {sourceUrl ? (
                  <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
                    {sourceUrl}
                  </a>
                ) : submission.source_url ? (
                  <span className="field-error">Unsafe or unreadable source URL</span>
                ) : (
                  '—'
                )}
              </dd>
              <dt>Spam score</dt>
              <dd>{scoreText(submission.spam_score)}</dd>
              <dt>AI attempts</dt>
              <dd>{submission.ai_attempts}</dd>
              <dt>Processed</dt>
              <dd>
                {submission.processed_at
                  ? formatDateTime(submission.processed_at)
                  : 'Not processed yet'}
              </dd>
              <dt>Review reason</dt>
              <dd>{submission.review_reason || '—'}</dd>
              <dt>Photos</dt>
              <dd>{images.length}</dd>
            </dl>
          </section>

          <section className="panel" aria-labelledby="ai-heading">
            <h2 id="ai-heading">AI desk</h2>
            <dl className={`kv ${styles.kvTight}`}>
              <dt>Model</dt>
              <dd>{submission.ai_model || '—'}</dd>
              <dt>Decision</dt>
              <dd>{decision}</dd>
            </dl>

            {aiReasons.length > 0 ? (
              <ul className={styles.reasons}>
                {aiReasons.map((reason, index) => (
                  <li key={`${index}-${reason}`}>{reason}</li>
                ))}
              </ul>
            ) : null}

            {submission.aiResult === null ? (
              <p className={styles.emptyLine}>
                No AI result is stored yet. The submission may still be queued, or the run failed.
              </p>
            ) : ai === null ? (
              <p className={styles.emptyLine}>
                The stored AI result could not be read. Retry processing to rebuild it.
              </p>
            ) : aiHeadline ? (
              <p className={styles.titleMeta}>Desk headline: {aiHeadline}</p>
            ) : null}
          </section>

          <section className="panel" aria-labelledby="published-heading">
            <h2 id="published-heading">Published article</h2>
            {article ? (
              <>
                <p className={styles.publishedLink}>
                  <Link
                    href={`/article/${encodeURIComponent(article.slug)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {article.headline} ↗
                  </Link>
                </p>
                <dl className={`kv ${styles.kvTight}`}>
                  <dt>Status</dt>
                  <dd>
                    <span className={statusBadgeClass(article.status)}>
                      {statusLabel(article.status)}
                    </span>
                  </dd>
                  <dt>Category</dt>
                  <dd>{article.category_slug}</dd>
                  <dt>Published</dt>
                  <dd>
                    {article.published_at ? formatDateTime(article.published_at) : 'Not dated'}
                  </dd>
                </dl>
                <p className={styles.actionNote}>
                  <Link href={`/admin/articles/${article.id}`}>Open the article editor →</Link>
                </p>
              </>
            ) : (
              <p className={styles.emptyLine}>
                Nothing has been published from this submission. Use manual publish below if the
                desk cannot process it.
              </p>
            )}
          </section>
        </aside>
      </div>

      <SubmissionActions
        submissionId={submission.id}
        status={submission.status}
        articleId={submission.article_id}
        categorySlug={submission.category_slug}
        categories={categories}
      />
    </>
  );
}
