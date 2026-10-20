'use client';

import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import styles from './forms.module.css';

/**
 * The corrections ledger. Every request is logged, but only the desk decides
 * whether the record is wrong. The panel is rendered only after the API gives
 * us a reference id, so a network blip can never look like a filed correction.
 */

type FieldName = 'articleId' | 'summary' | 'detail' | 'submittedBy';

type FieldErrors = Partial<Record<FieldName, string>>;

interface CorrectionResponse {
  id?: string;
  message?: string;
}

interface SuccessState {
  reference: string;
  message: string;
}

export interface CorrectionFormProps {
  /** Article id from `?article=`. Empty string means the visitor must type one. */
  articleId: string;
}

const FIELD_ORDER: FieldName[] = ['articleId', 'summary', 'detail', 'submittedBy'];

const FIELD_LABELS: Record<FieldName, string> = {
  articleId: 'Article ID',
  summary: 'What needs correcting',
  detail: 'Detail',
  submittedBy: 'Your name',
};

const API_FIELD_MAP: Record<string, FieldName | null> = {
  articleId: 'articleId',
  summary: 'summary',
  detail: 'detail',
  submittedBy: 'submittedBy',
  website: null,
};

function formatWait(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} seconds`;
  if (seconds < 3600) {
    const minutes = Math.max(1, Math.round(seconds / 60));
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  }
  const hours = Math.max(1, Math.round(seconds / 3600));
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

function readRetrySeconds(details: unknown): number | null {
  if (details && typeof details === 'object' && 'retryAfterSeconds' in details) {
    const value = (details as { retryAfterSeconds?: unknown }).retryAfterSeconds;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return null;
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

export function CorrectionForm({ articleId }: CorrectionFormProps): React.JSX.Element {
  const websiteRef = useRef<HTMLInputElement | null>(null);
  const lockedArticle = articleId.trim();

  const [article, setArticle] = useState(lockedArticle);
  const [summary, setSummary] = useState('');
  const [detail, setDetail] = useState('');
  const [submittedBy, setSubmittedBy] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<SuccessState | null>(null);

  function clearError(field: FieldName): void {
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function validate(): FieldErrors {
    const next: FieldErrors = {};

    const cleanArticle = article.trim();
    if (cleanArticle.length < 4) {
      next.articleId = 'Enter the article ID — at least 4 characters.';
    } else if (cleanArticle.length > 80) {
      next.articleId = 'Article IDs are 80 characters or fewer. Check what you pasted.';
    }

    const cleanSummary = summary.trim();
    if (!cleanSummary) {
      next.summary = 'Say what needs correcting.';
    } else if (cleanSummary.length < 10) {
      next.summary = 'Give the desk a little more — at least 10 characters.';
    } else if (cleanSummary.length > 600) {
      next.summary = 'Keep the summary to 600 characters; the detail box is for the long version.';
    }

    if (detail.trim().length > 3000) {
      next.detail = 'Keep the detail to 3000 characters.';
    }

    if (submittedBy.trim().length > 80) {
      next.submittedBy = 'Keep the name under 80 characters.';
    }

    return next;
  }

  function applyApiError(response: Response, payload: unknown): void {
    const envelope =
      payload !== null && typeof payload === 'object'
        ? (payload as {
            error?: { code?: unknown; message?: unknown; details?: unknown; issues?: unknown };
          })
        : {};
    const error = envelope.error;
    let message =
      typeof error?.message === 'string' && error.message
        ? error.message
        : 'The desk could not take that request. Try again.';

    if (response.status === 429) {
      const retryAfter =
        readRetrySeconds(error?.details) ?? Number(response.headers.get('retry-after') ?? '');
      message =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? `${message} Try again in ${formatWait(retryAfter)}.`
          : `${message} Wait a little while and try again.`;
    }

    if (response.status === 404) {
      message = `${message} The desk only corrects published stories, and the article ID must match one of them exactly.`;
    }

    const mapped: FieldErrors = {};
    const extra: string[] = [];

    if (Array.isArray(error?.issues)) {
      for (const rawIssue of error.issues) {
        if (!rawIssue || typeof rawIssue !== 'object') continue;
        const field = (rawIssue as { field?: unknown }).field;
        const issueMessage = (rawIssue as { message?: unknown }).message;
        if (typeof field !== 'string' || typeof issueMessage !== 'string') continue;
        const target = field in API_FIELD_MAP ? API_FIELD_MAP[field] : undefined;
        if (target) {
          mapped[target] = mapped[target] ? `${mapped[target]} ${issueMessage}` : issueMessage;
        } else if (target !== null) {
          extra.push(issueMessage);
        }
      }
    }

    setFormError(extra.length > 0 ? `${message} ${extra.join(' ')}` : message);
    if (Object.keys(mapped).length > 0) {
      setErrors((current) => ({ ...current, ...mapped }));
    }

    window.setTimeout(() => {
      const firstField = FIELD_ORDER.find((field) => mapped[field]);
      const element = firstField
        ? document.getElementById(firstField)
        : document.getElementById('correction-error-summary');
      element?.focus();
    }, 0);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;

    setFormError(null);

    const nextErrors = validate();
    setErrors(nextErrors);

    const firstInvalid = FIELD_ORDER.find((field) => nextErrors[field]);
    if (firstInvalid) {
      document.getElementById(firstInvalid)?.focus();
      return;
    }

    setBusy(true);

    try {
      const response = await fetch('/api/public/corrections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          articleId: article.trim(),
          summary: summary.trim(),
          ...(detail.trim() ? { detail: detail.trim() } : {}),
          ...(submittedBy.trim() ? { submittedBy: submittedBy.trim() } : {}),
          website: websiteRef.current?.value ?? '',
        }),
      });

      const payload = await readJson(response);

      if (!response.ok) {
        applyApiError(response, payload);
        return;
      }

      const data = payload as CorrectionResponse | null;
      const reference = typeof data?.id === 'string' ? data.id.trim() : '';
      if (!reference) {
        setFormError(
          'The desk accepted the request but did not return a reference. Do not send it again yet — tell the newsroom.',
        );
        return;
      }

      setSuccess({
        reference,
        message:
          typeof data?.message === 'string' && data.message
            ? data.message
            : 'Correction request received.',
      });
    } catch {
      setFormError('The newsroom could not be reached. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (success) {
    return (
      <div className={`alert alert--success ${styles.success}`} role="status">
        <div>
          <h3>Request logged</h3>
          <p>{success.message}</p>
        </div>
        <p className={styles.note}>Reference</p>
        <code className={styles.tokenBox}>{success.reference}</code>
        <p className={styles.note}>
          This is a request, not a published correction. A human will compare it with the story and
          the record. If the desk agrees, the correction is added to the article and logged; if it
          does not, nothing changes.
        </p>
      </div>
    );
  }

  const summaryEntries: Array<{ field: FieldName | null; message: string }> = [];
  if (formError) summaryEntries.push({ field: null, message: formError });
  for (const field of FIELD_ORDER) {
    const message = errors[field];
    if (message) summaryEntries.push({ field, message });
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate aria-busy={busy}>
      {summaryEntries.length > 0 ? (
        <div
          className={`alert alert--error ${styles.errorSummary}`}
          id="correction-error-summary"
          role="alert"
          tabIndex={-1}
        >
          <h3>Nothing was sent yet</h3>
          <ul>
            {summaryEntries.map((entry) => (
              <li key={entry.field ?? 'general'}>
                {entry.field ? (
                  <>
                    <a
                      href={`#${entry.field}`}
                      onClick={(event) => {
                        event.preventDefault();
                        document.getElementById(entry.field ?? '')?.focus();
                      }}
                    >
                      {FIELD_LABELS[entry.field]}
                    </a>
                    : {entry.message}
                  </>
                ) : (
                  entry.message
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="field">
        <label className="field-label" htmlFor="articleId">
          <span>Article ID</span>
          {lockedArticle ? (
            <span className={styles.optional}>From the story</span>
          ) : (
            <span className="req" aria-hidden="true">
              *
            </span>
          )}
        </label>
        <input
          id="articleId"
          name="articleId"
          className={`input${lockedArticle ? ` ${styles.readOnly}` : ''}`}
          type="text"
          value={article}
          onChange={(event) => {
            setArticle(event.target.value);
            clearError('articleId');
          }}
          readOnly={Boolean(lockedArticle)}
          disabled={busy}
          required
          maxLength={80}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={errors.articleId ? true : undefined}
          aria-describedby={errors.articleId ? 'articleId-help articleId-error' : 'articleId-help'}
        />
        <p className="field-help" id="articleId-help">
          {lockedArticle
            ? 'Locked to the story you came from. Open a different article to correct that one instead.'
            : 'The short ID for the published story. It is filled in automatically when you use “Request a correction” on an article.'}
        </p>
        {errors.articleId ? (
          <p className="field-error" id="articleId-error" role="alert">
            {errors.articleId}
          </p>
        ) : null}
      </div>

      <div className="field">
        <label className="field-label" htmlFor="summary">
          <span>What needs correcting</span>
          <span className="count">{summary.length} / 600</span>
        </label>
        <textarea
          id="summary"
          name="summary"
          className="textarea"
          value={summary}
          onChange={(event) => {
            setSummary(event.target.value);
            clearError('summary');
          }}
          required
          disabled={busy}
          rows={3}
          maxLength={600}
          aria-invalid={errors.summary ? true : undefined}
          aria-describedby={errors.summary ? 'summary-help summary-error' : 'summary-help'}
        />
        <p className="field-help" id="summary-help">
          One or two sentences: what the story says, and what is actually true. At least 10
          characters.
        </p>
        {errors.summary ? (
          <p className="field-error" id="summary-error" role="alert">
            {errors.summary}
          </p>
        ) : null}
      </div>

      <div className="field">
        <label className="field-label" htmlFor="detail">
          <span>
            Detail <span className={styles.optional}>Optional</span>
          </span>
          <span className="count">{detail.length} / 3000</span>
        </label>
        <textarea
          id="detail"
          name="detail"
          className="textarea"
          value={detail}
          onChange={(event) => {
            setDetail(event.target.value);
            clearError('detail');
          }}
          rows={6}
          disabled={busy}
          maxLength={3000}
          aria-invalid={errors.detail ? true : undefined}
          aria-describedby={errors.detail ? 'detail-help detail-error' : 'detail-help'}
        />
        <p className="field-help" id="detail-help">
          Sources, links, dates, the correct figures, or anything else that helps the desk check the
          record. Plain text only.
        </p>
        {errors.detail ? (
          <p className="field-error" id="detail-error" role="alert">
            {errors.detail}
          </p>
        ) : null}
      </div>

      <div className="field">
        <label className="field-label" htmlFor="submittedBy">
          <span>
            Your name <span className={styles.optional}>Optional</span>
          </span>
        </label>
        <input
          id="submittedBy"
          name="submittedBy"
          className="input"
          type="text"
          value={submittedBy}
          onChange={(event) => {
            setSubmittedBy(event.target.value);
            clearError('submittedBy');
          }}
          maxLength={80}
          disabled={busy}
          autoComplete="name"
          placeholder="If you want the request attributed"
          aria-invalid={errors.submittedBy ? true : undefined}
          aria-describedby={
            errors.submittedBy ? 'submittedBy-help submittedBy-error' : 'submittedBy-help'
          }
        />
        <p className="field-help" id="submittedBy-help">
          Optional. It is kept with the request, not published as a byline. Leave it blank to stay
          unnamed in the log.
        </p>
        {errors.submittedBy ? (
          <p className="field-error" id="submittedBy-error" role="alert">
            {errors.submittedBy}
          </p>
        ) : null}
      </div>

      <div className="visually-hidden" aria-hidden="true">
        <label htmlFor="correction-website">Website</label>
        <input
          ref={websiteRef}
          id="correction-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          defaultValue=""
        />
      </div>

      <div className={styles.formActions}>
        <button type="submit" className="button button--primary" disabled={busy}>
          {busy ? 'Sending…' : 'Request a correction'}
        </button>
        {busy ? (
          <p className={styles.busyNote} aria-live="polite">
            Sending the request to the desk…
          </p>
        ) : (
          <p className={styles.note}>
            Sending a request does not guarantee a correction will be published.
          </p>
        )}
      </div>
    </form>
  );
}
