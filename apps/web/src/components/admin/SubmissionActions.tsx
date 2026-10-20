'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { adminErrorMessage, adminFetch } from './api';
import styles from './admin.module.css';

export interface CategoryOption {
  slug: string;
  name: string;
}

interface SubmissionActionsProps {
  submissionId: string;
  status: string;
  articleId: string | null;
  categorySlug: string | null;
  categories: CategoryOption[];
}

interface PublishForm {
  headline: string;
  dek: string;
  body: string;
  categorySlug: string;
  tags: string;
  breaking: boolean;
  placement: '' | 'lead' | 'top' | 'standard';
  editorNote: string;
}

const EMPTY_PUBLISH_FORM: PublishForm = {
  headline: '',
  dek: '',
  body: '',
  categorySlug: '',
  tags: '',
  breaking: false,
  placement: '',
  editorNote: '',
};

function splitTags(raw: string): string[] {
  return raw
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

function validatePublish(form: PublishForm): string | null {
  const headline = form.headline.trim();
  if (headline && (headline.length < 6 || headline.length > 200)) {
    return 'A custom headline must be between 6 and 200 characters.';
  }
  if (form.dek.trim().length > 320) return 'The dek cannot exceed 320 characters.';

  const body = form.body.trim();
  if (body && (body.length < 40 || body.length > 30_000)) {
    return 'A custom body must be between 40 and 30,000 characters.';
  }
  if (form.categorySlug.trim().length > 64) return 'The category slug is too long.';

  const tags = splitTags(form.tags);
  if (tags.length > 8) return 'Use at most 8 tags.';
  if (tags.some((tag) => tag.length > 32)) return 'Each tag must be 32 characters or fewer.';
  if (form.editorNote.trim().length > 220) return 'The editor note cannot exceed 220 characters.';

  return null;
}

export function SubmissionActions({
  submissionId,
  status,
  articleId,
  categorySlug,
  categories,
}: SubmissionActionsProps): React.JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState<'retry' | 'reject' | 'publish' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [form, setForm] = useState<PublishForm>({
    ...EMPTY_PUBLISH_FORM,
    categorySlug: categorySlug ?? '',
  });

  const published = status === 'published' || articleId !== null;

  function update<K extends keyof PublishForm>(key: K, value: PublishForm[K]): void {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function retry(): Promise<void> {
    if (
      !window.confirm(
        'Re-queue this submission for processing? The AI desk will run again and may replace the review result.',
      )
    ) {
      return;
    }
    setBusy('retry');
    setError(null);
    setNotice(null);
    try {
      await adminFetch(`/submissions/${encodeURIComponent(submissionId)}/retry`, {
        method: 'POST',
      });
      setNotice('Queued. The worker will pick the submission up on its next pass.');
      router.refresh();
    } catch (caught) {
      setError(adminErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function reject(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      setError('Give a short reason for rejecting the submission.');
      return;
    }
    if (!window.confirm('Reject this submission? It will not be published from this queue.')) {
      return;
    }
    setBusy('reject');
    setError(null);
    setNotice(null);
    try {
      await adminFetch(`/submissions/${encodeURIComponent(submissionId)}/reject`, {
        method: 'POST',
        body: { reason: trimmed.slice(0, 600) },
      });
      setNotice('Submission rejected. The reason is recorded with the submission.');
      setReason('');
      router.refresh();
    } catch (caught) {
      setError(adminErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function publish(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const problem = validatePublish(form);
    if (problem) {
      setError(problem);
      return;
    }
    if (
      !window.confirm(
        'Publish this submission now? This creates a live article on the site. Leave fields blank to use the AI copy or the original submission.',
      )
    ) {
      return;
    }

    const payload: Record<string, unknown> = { breaking: form.breaking };
    const headline = form.headline.trim();
    const dek = form.dek.trim();
    const body = form.body.trim();
    const slug = form.categorySlug.trim();
    const editorNote = form.editorNote.trim();
    const tags = splitTags(form.tags);
    if (headline) payload.headline = headline;
    if (dek) payload.dek = dek;
    if (body) payload.body = body;
    if (slug) payload.categorySlug = slug;
    if (editorNote) payload.editorNote = editorNote;
    if (tags.length > 0) payload.tags = tags;
    if (form.placement) payload.placement = form.placement;

    setBusy('publish');
    setError(null);
    setNotice(null);
    try {
      await adminFetch(`/submissions/${encodeURIComponent(submissionId)}/publish`, {
        method: 'POST',
        body: payload,
      });
      setNotice('Published. The live story is linked on this page.');
      router.refresh();
    } catch (caught) {
      setError(adminErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={styles.actionsGrid} aria-labelledby="submission-actions-heading">
      <h2 id="submission-actions-heading" className="visually-hidden">
        Submission actions
      </h2>

      {notice ? (
        <div className="alert alert--success" role="status">
          <p>{notice}</p>
        </div>
      ) : null}

      {error ? (
        <div className="alert alert--error" role="alert">
          <p>{error}</p>
        </div>
      ) : null}

      {published ? (
        <div className={styles.actionCard}>
          <h2>Already published</h2>
          <p className={styles.actionNote}>
            This submission has an article. Edit the story from the article editor; submissions
            cannot be republished or rejected once published.
          </p>
        </div>
      ) : (
        <>
          <div className={styles.actionCard}>
            <h2>Retry processing</h2>
            <p className={styles.actionNote}>
              Clears the last error and queues the submission for the AI desk again. Use it when a
              run failed or the desk was unavailable.
            </p>
            <div className={styles.actionRow}>
              <button
                className="button button--ghost button--sm"
                type="button"
                onClick={retry}
                disabled={busy !== null}
              >
                {busy === 'retry' ? 'Queueing…' : 'Retry submission'}
              </button>
            </div>
          </div>

          <div className={styles.actionCard}>
            <h2>Manual publish</h2>
            <p className={styles.actionNote}>
              Every field is optional. Blank fields fall back to the stored AI result or the
              original submission. Values must satisfy the same limits as the article editor.
            </p>

            <form className={styles.actionForm} onSubmit={publish}>
              <div className="field">
                <label className="field-label" htmlFor="publish-headline">
                  Headline
                </label>
                <input
                  className="input"
                  id="publish-headline"
                  name="headline"
                  type="text"
                  minLength={6}
                  maxLength={200}
                  value={form.headline}
                  onChange={(event) => update('headline', event.target.value)}
                  placeholder="Leave blank to keep the desk's headline"
                />
                <p className="field-help">6–200 characters when supplied.</p>
              </div>

              <div className="field">
                <label className="field-label" htmlFor="publish-dek">
                  Dek
                </label>
                <textarea
                  className="textarea"
                  id="publish-dek"
                  name="dek"
                  rows={2}
                  maxLength={320}
                  value={form.dek}
                  onChange={(event) => update('dek', event.target.value)}
                  placeholder="Leave blank to keep the desk's dek"
                  style={{ minHeight: 90 }}
                />
              </div>

              <div className="field">
                <label className="field-label" htmlFor="publish-body">
                  Body
                </label>
                <textarea
                  className="textarea"
                  id="publish-body"
                  name="body"
                  rows={8}
                  minLength={40}
                  maxLength={30_000}
                  value={form.body}
                  onChange={(event) => update('body', event.target.value)}
                  placeholder="Leave blank to publish the desk's copy (or the original story)"
                />
                <p className="field-help">40–30,000 characters when supplied.</p>
              </div>

              <div className="field">
                <label className="field-label" htmlFor="publish-category">
                  Category slug
                </label>
                <input
                  className="input"
                  id="publish-category"
                  name="categorySlug"
                  type="text"
                  list="publish-category-options"
                  maxLength={64}
                  value={form.categorySlug}
                  onChange={(event) => update('categorySlug', event.target.value)}
                />
                <datalist id="publish-category-options">
                  {categories.map((category) => (
                    <option key={category.slug} value={category.slug}>
                      {category.name}
                    </option>
                  ))}
                </datalist>
                <p className="field-help">Must be an enabled category on the site.</p>
              </div>

              <div className="field">
                <label className="field-label" htmlFor="publish-tags">
                  Tags
                </label>
                <input
                  className="input"
                  id="publish-tags"
                  name="tags"
                  type="text"
                  value={form.tags}
                  onChange={(event) => update('tags', event.target.value)}
                  placeholder="newsroom, campus, overnight"
                />
                <p className="field-help">Comma separated, up to 8 tags of 32 characters each.</p>
              </div>

              <div className="field">
                <label className="field-label" htmlFor="publish-placement">
                  Placement
                </label>
                <select
                  className="select"
                  id="publish-placement"
                  name="placement"
                  value={form.placement}
                  onChange={(event) =>
                    update('placement', event.target.value as PublishForm['placement'])
                  }
                >
                  <option value="">Keep the desk&apos;s placement</option>
                  <option value="lead">Lead</option>
                  <option value="top">Top</option>
                  <option value="standard">Standard</option>
                </select>
              </div>

              <div className="field">
                <label className="field-label" htmlFor="publish-note">
                  Editor note
                </label>
                <input
                  className="input"
                  id="publish-note"
                  name="editorNote"
                  type="text"
                  maxLength={220}
                  value={form.editorNote}
                  onChange={(event) => update('editorNote', event.target.value)}
                />
                <p className="field-help">Up to 220 characters. Internal.</p>
              </div>

              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={form.breaking}
                  onChange={(event) => update('breaking', event.target.checked)}
                />
                <span>Mark as breaking news</span>
              </label>

              <div className={styles.actionRow}>
                <button
                  className="button button--danger button--sm"
                  type="submit"
                  disabled={busy !== null}
                >
                  {busy === 'publish' ? 'Publishing…' : 'Publish manually'}
                </button>
              </div>
            </form>
          </div>

          <div className={styles.actionCard}>
            <h2>Reject</h2>
            <p className={styles.actionNote}>
              Rejection is final for this submission. The reason is stored with the submission and
              written to the audit log.
            </p>
            <form className={styles.actionForm} onSubmit={reject}>
              <div className="field">
                <label className="field-label" htmlFor="reject-reason">
                  Reason <span className="req">*</span>
                </label>
                <textarea
                  className="textarea"
                  id="reject-reason"
                  name="reason"
                  rows={3}
                  maxLength={600}
                  required
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
                <p className="field-help">Required, up to 600 characters.</p>
              </div>
              <div className={styles.actionRow}>
                <button
                  className="button button--ghost button--sm"
                  type="submit"
                  disabled={busy !== null}
                >
                  {busy === 'reject' ? 'Rejecting…' : 'Reject submission'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </section>
  );
}
