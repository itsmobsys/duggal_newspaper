'use client';

import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import styles from './forms.module.css';

/**
 * The complaints desk. Reports are free text plus a reason; the API checks the
 * article exists and rate-limits per connection. Nothing here is optimistic:
 * the success panel only renders after the API returns a reference id.
 */

type FieldName = 'articleId' | 'reason' | 'detail' | 'contact';

type FieldErrors = Partial<Record<FieldName, string>>;

interface ReportResponse {
  id?: string;
  message?: string;
}

interface SuccessState {
  reference: string;
  message: string;
}

export interface ReportFormProps {
  /** Article id from `?article=`. Empty string means the visitor must type one. */
  articleId: string;
}

const REASONS = [
  'Factual error',
  'Misleading or missing context',
  'Harassment or privacy',
  'Spam or scam',
  'Other',
] as const;

const OTHER_REASON = 'Other';

const FIELD_ORDER: FieldName[] = ['articleId', 'reason', 'detail', 'contact'];

const FIELD_LABELS: Record<FieldName, string> = {
  articleId: 'Article ID',
  reason: 'Reason',
  detail: 'Detail',
  contact: 'Contact',
};

const API_FIELD_MAP: Record<string, FieldName | null> = {
  articleId: 'articleId',
  reason: 'reason',
  detail: 'detail',
  contact: 'contact',
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

export function ReportForm({ articleId }: ReportFormProps): React.JSX.Element {
  const websiteRef = useRef<HTMLInputElement | null>(null);
  const lockedArticle = articleId.trim();

  const [article, setArticle] = useState(lockedArticle);
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState('');
  const [contact, setContact] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<SuccessState | null>(null);

  const isOther = reason === OTHER_REASON;

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

    if (!reason) {
      next.reason = 'Choose the closest reason.';
    } else if (!(REASONS as readonly string[]).includes(reason)) {
      next.reason = 'Pick a reason from the list.';
    }

    const cleanDetail = detail.trim();
    if (isOther && !cleanDetail) {
      next.detail = 'The “Other” reason needs an explanation. Tell the desk what is wrong.';
    } else if (cleanDetail.length > 2000) {
      next.detail = 'Keep the detail to 2000 characters; the desk stops reading there.';
    }

    if (contact.trim().length > 200) {
      next.contact = 'Keep the contact under 200 characters.';
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
        : 'The desk could not take that report. Try again.';

    if (response.status === 429) {
      const retryAfter =
        readRetrySeconds(error?.details) ?? Number(response.headers.get('retry-after') ?? '');
      message =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? `${message} Try again in ${formatWait(retryAfter)}.`
          : `${message} Wait a little while and try again.`;
    }

    if (response.status === 404) {
      message = `${message} No story matches that article ID — copy it from the story page and try again.`;
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
        : document.getElementById('report-error-summary');
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
      const response = await fetch('/api/public/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          articleId: article.trim(),
          reason,
          ...(detail.trim() ? { detail: detail.trim() } : {}),
          ...(contact.trim() ? { contact: contact.trim() } : {}),
          website: websiteRef.current?.value ?? '',
        }),
      });

      const payload = await readJson(response);

      if (!response.ok) {
        applyApiError(response, payload);
        return;
      }

      const data = payload as ReportResponse | null;
      const reference = typeof data?.id === 'string' ? data.id.trim() : '';
      if (!reference) {
        setFormError(
          'The desk accepted the report but did not return a reference. Do not send it again yet — tell the newsroom.',
        );
        return;
      }

      setSuccess({
        reference,
        message:
          typeof data?.message === 'string' && data.message
            ? data.message
            : 'Report received. The desk will look at it.',
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
          <h3>Report received</h3>
          <p>{success.message}</p>
        </div>
        <p className={styles.note}>Reference</p>
        <code className={styles.tokenBox}>{success.reference}</code>
        <p className={styles.note}>
          Keep this reference if you need to follow up. A report flags the story for a human; it
          does not change the article by itself.
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
          id="report-error-summary"
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
            ? 'Locked to the story you came from. Open a different story to report that one instead.'
            : 'The short ID for the story. It is filled in automatically when you use “Report a problem” on an article.'}
        </p>
        {errors.articleId ? (
          <p className="field-error" id="articleId-error" role="alert">
            {errors.articleId}
          </p>
        ) : null}
      </div>

      <div className="field">
        <label className="field-label" htmlFor="reason">
          <span>Reason</span>
          <span className="req" aria-hidden="true">
            *
          </span>
        </label>
        <select
          id="reason"
          name="reason"
          className="select"
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
            clearError('reason');
            // The detail box is only required for “Other”; do not leave that error behind.
            clearError('detail');
          }}
          required
          disabled={busy}
          aria-invalid={errors.reason ? true : undefined}
          aria-describedby={errors.reason ? 'reason-help reason-error' : 'reason-help'}
        >
          <option value="">Choose a reason</option>
          {REASONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <p className="field-help" id="reason-help">
          Pick the closest fit. “Other” needs an explanation before the report can be sent.
        </p>
        {errors.reason ? (
          <p className="field-error" id="reason-error" role="alert">
            {errors.reason}
          </p>
        ) : null}
      </div>

      <div className="field">
        <label className="field-label" htmlFor="detail">
          <span>
            {isOther ? 'What is wrong' : 'Detail'}{' '}
            {isOther ? (
              <span className="req" aria-hidden="true">
                *
              </span>
            ) : (
              <span className={styles.optional}>Optional</span>
            )}
          </span>
          <span className="count">{detail.length} / 2000</span>
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
          required={isOther}
          disabled={busy}
          rows={6}
          maxLength={2000}
          aria-invalid={errors.detail ? true : undefined}
          aria-describedby={errors.detail ? 'detail-help detail-error' : 'detail-help'}
        />
        <p className="field-help" id="detail-help">
          Say what is wrong and what the story should say instead. Quote the sentence if you can;
          links help. Do not paste anyone&rsquo;s private messages, addresses or phone numbers.
        </p>
        {errors.detail ? (
          <p className="field-error" id="detail-error" role="alert">
            {errors.detail}
          </p>
        ) : null}
      </div>

      <div className="field">
        <label className="field-label" htmlFor="contact">
          <span>
            Contact <span className={styles.optional}>Optional</span>
          </span>
        </label>
        <input
          id="contact"
          name="contact"
          className="input"
          type="text"
          value={contact}
          onChange={(event) => {
            setContact(event.target.value);
            clearError('contact');
          }}
          maxLength={200}
          disabled={busy}
          autoComplete="off"
          placeholder="Email or Discord handle"
          aria-invalid={errors.contact ? true : undefined}
          aria-describedby={errors.contact ? 'contact-help contact-error' : 'contact-help'}
        />
        <p className="field-help" id="contact-help">
          Only if you want a reply. It is not published and it is not passed to anyone else.
        </p>
        {errors.contact ? (
          <p className="field-error" id="contact-error" role="alert">
            {errors.contact}
          </p>
        ) : null}
      </div>

      <div className="visually-hidden" aria-hidden="true">
        <label htmlFor="report-website">Website</label>
        <input
          ref={websiteRef}
          id="report-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          defaultValue=""
        />
      </div>

      <div className={styles.formActions}>
        <button type="submit" className="button button--primary" disabled={busy}>
          {busy ? 'Sending…' : 'Send the report'}
        </button>
        {busy ? (
          <p className={styles.busyNote} aria-live="polite">
            Sending the report to the desk…
          </p>
        ) : (
          <p className={styles.note}>
            Reports are read by a human. The desk does not publish a list of who complained.
          </p>
        )}
      </div>
    </form>
  );
}
