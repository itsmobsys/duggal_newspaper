'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { adminErrorMessage, adminFetch } from './api';
import type { CategoryOption } from './SubmissionActions';
import styles from './admin.module.css';

export interface EditableArticle {
  id: string;
  slug: string;
  headline: string;
  dek: string | null;
  body: string;
  category_slug: string;
  author_display: string;
  tags: string;
  breaking: number;
  featured: number;
  placement: 'lead' | 'top' | 'standard';
  status: string;
  editor_note: string | null;
  source_url: string | null;
  published_at: string | null;
  edition_date: string;
  ai_model: string | null;
  ai_generated: number;
  updated_at: string;
}

export interface EditorImage {
  id: string;
  url: string;
  thumb_url: string | null;
  caption: string | null;
  alt_text: string | null;
  attribution: string | null;
}

interface ArticleEditorProps {
  article: EditableArticle;
  categories: CategoryOption[];
  images: EditorImage[];
}

interface ArticleForm {
  headline: string;
  dek: string;
  body: string;
  categorySlug: string;
  tags: string;
  breaking: boolean;
  featured: boolean;
  placement: 'lead' | 'top' | 'standard';
  editorNote: string;
  sourceUrl: string;
  publishedAt: string;
}

type Busy = 'save' | 'publish' | 'unpublish' | 'delete' | 'correct' | null;

type FieldErrors = Record<string, string>;

/** Stored tags are JSON, but older rows may have been hand-edited. Read both. */
function tagsToText(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((tag): tag is string => typeof tag === 'string')
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0)
        .join(', ');
    }
  } catch {
    // Fall through to the raw value.
  }
  return raw;
}

function splitTags(raw: string): string[] {
  return raw
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'published':
      return 'badge badge--published';
    case 'unpublished':
      return 'badge badge--review';
    case 'deleted':
      return 'badge badge--failed';
    default:
      return 'badge badge--info';
  }
}

function publishedLabel(iso: string | null): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? 'Invalid date' : parsed.toUTCString();
}

interface Validated {
  payload: Record<string, unknown>;
  errors: FieldErrors;
}

function validate(form: ArticleForm, categories: CategoryOption[], currentSlug: string): Validated {
  const errors: FieldErrors = {};
  const headline = form.headline.trim();
  const dek = form.dek.trim();
  const body = form.body.trim();
  const categorySlug = form.categorySlug.trim();
  const editorNote = form.editorNote.trim();
  const sourceUrl = form.sourceUrl.trim();
  const tags = splitTags(form.tags);

  if (headline.length < 6 || headline.length > 200) {
    errors.headline = 'The headline must be between 6 and 200 characters.';
  }
  if (dek.length > 320) errors.dek = 'The dek cannot exceed 320 characters.';
  if (body.length < 40 || body.length > 40_000) {
    errors.body = 'The body must be between 40 and 40,000 characters.';
  }
  if (!categorySlug) {
    errors.categorySlug = 'Choose a category.';
  } else if (categorySlug.length > 64) {
    errors.categorySlug = 'The category slug is too long.';
  } else if (
    categorySlug !== currentSlug &&
    categories.length > 0 &&
    !categories.some((entry) => entry.slug === categorySlug)
  ) {
    errors.categorySlug = 'Choose one of the enabled categories.';
  }
  if (tags.length > 10) errors.tags = 'Use at most 10 tags.';
  else if (tags.some((tag) => tag.length > 32)) {
    errors.tags = 'Each tag must be 32 characters or fewer.';
  }
  if (editorNote.length > 220) errors.editorNote = 'The editor note cannot exceed 220 characters.';
  if (sourceUrl.length > 2048) {
    errors.sourceUrl = 'The source URL cannot exceed 2,048 characters.';
  } else if (sourceUrl) {
    try {
      const parsed = new URL(sourceUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        errors.sourceUrl = 'Use a public http(s) link.';
      }
    } catch {
      errors.sourceUrl = 'Enter a valid http(s) URL.';
    }
  }

  const payload: Record<string, unknown> = {
    headline,
    dek,
    body,
    categorySlug,
    tags,
    breaking: form.breaking,
    featured: form.featured,
    placement: form.placement,
    editorNote,
    sourceUrl,
  };

  if (form.publishedAt) {
    const parsed = new Date(form.publishedAt);
    if (Number.isNaN(parsed.getTime())) {
      errors.publishedAt = 'Enter a valid publication date and time.';
    } else {
      payload.publishedAt = parsed.toISOString();
    }
  }

  return { payload, errors };
}

export function ArticleEditor({
  article,
  categories,
  images,
}: ArticleEditorProps): React.JSX.Element {
  const router = useRouter();
  const [form, setForm] = useState<ArticleForm>({
    headline: article.headline,
    dek: article.dek ?? '',
    body: article.body,
    categorySlug: article.category_slug,
    tags: tagsToText(article.tags),
    breaking: article.breaking === 1,
    featured: article.featured === 1,
    placement: article.placement,
    editorNote: article.editor_note ?? '',
    sourceUrl: article.source_url ?? '',
    publishedAt: '',
  });
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [correctionSummary, setCorrectionSummary] = useState('');
  const [correctionDetail, setCorrectionDetail] = useState('');

  function update<K extends keyof ArticleForm>(key: K, value: ArticleForm[K]): void {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function showError(message: string): void {
    setError(message);
    setNotice(null);
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const { payload, errors } = validate(form, categories, article.category_slug);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      showError('Fix the highlighted fields before saving.');
      return;
    }

    setBusy('save');
    setError(null);
    setNotice(null);
    try {
      await adminFetch(`/articles/${encodeURIComponent(article.id)}`, {
        method: 'PATCH',
        body: payload,
      });
      // Clear the date override so a later body edit cannot silently re-apply it.
      setForm((current) => ({ ...current, publishedAt: '' }));
      setNotice('Saved. The API queued a revalidation of the public pages.');
      router.refresh();
    } catch (caught) {
      showError(adminErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function publish(): Promise<void> {
    setBusy('publish');
    setError(null);
    setNotice(null);
    try {
      await adminFetch(`/articles/${encodeURIComponent(article.id)}/publish`, { method: 'POST' });
      setNotice('Published. The story is live.');
      router.refresh();
    } catch (caught) {
      showError(adminErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function unpublish(): Promise<void> {
    if (!window.confirm('Unpublish this story? It will disappear from the public site.')) return;
    setBusy('unpublish');
    setError(null);
    setNotice(null);
    try {
      await adminFetch(`/articles/${encodeURIComponent(article.id)}/unpublish`, { method: 'POST' });
      setNotice('Unpublished. The story is no longer live.');
      router.refresh();
    } catch (caught) {
      showError(adminErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function remove(): Promise<void> {
    if (
      !window.confirm(
        'Delete this article? It is a soft delete: the story leaves the site but the record is kept.',
      )
    ) {
      return;
    }
    setBusy('delete');
    setError(null);
    setNotice(null);
    try {
      await adminFetch(`/articles/${encodeURIComponent(article.id)}`, { method: 'DELETE' });
      router.push('/admin/articles');
      router.refresh();
    } catch (caught) {
      showError(adminErrorMessage(caught));
      setBusy(null);
    }
  }

  async function correct(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const summary = correctionSummary.trim();
    const detail = correctionDetail.trim();
    if (summary.length < 10 || summary.length > 600) {
      showError('A correction summary must be between 10 and 600 characters.');
      return;
    }
    if (detail.length > 2000) {
      showError('Correction detail cannot exceed 2,000 characters.');
      return;
    }
    if (
      !window.confirm(
        'Append this correction to the published story? The text is added to the article body immediately.',
      )
    ) {
      return;
    }

    setBusy('correct');
    setError(null);
    setNotice(null);
    try {
      await adminFetch(`/articles/${encodeURIComponent(article.id)}/correct`, {
        method: 'POST',
        body: { summary, ...(detail ? { detail } : {}) },
      });
      setNotice('Correction appended to the story.');
      setCorrectionSummary('');
      setCorrectionDetail('');
      router.refresh();
    } catch (caught) {
      showError(adminErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  const categoryChoices = categories.some((entry) => entry.slug === form.categorySlug)
    ? categories
    : form.categorySlug
      ? [{ slug: form.categorySlug, name: `${form.categorySlug} (current)` }, ...categories]
      : categories;

  return (
    <>
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

      <div className={styles.editorGrid}>
        <div className={styles.editorMain}>
          <form className="form" onSubmit={save} noValidate>
            <div className="field">
              <label className="field-label" htmlFor="article-headline">
                Headline <span className="req">*</span>
              </label>
              <input
                className="input"
                id="article-headline"
                name="headline"
                type="text"
                required
                minLength={6}
                maxLength={200}
                value={form.headline}
                onChange={(event) => update('headline', event.target.value)}
                aria-invalid={fieldErrors.headline ? true : undefined}
                aria-describedby={fieldErrors.headline ? 'article-headline-error' : undefined}
              />
              <div className={styles.counterRow}>
                <span>6–200 characters</span>
                <span>{form.headline.length}/200</span>
              </div>
              {fieldErrors.headline ? (
                <p className="field-error" id="article-headline-error">
                  {fieldErrors.headline}
                </p>
              ) : null}
            </div>

            <div className="field">
              <label className="field-label" htmlFor="article-dek">
                Dek
              </label>
              <textarea
                className="textarea"
                id="article-dek"
                name="dek"
                rows={3}
                maxLength={320}
                value={form.dek}
                onChange={(event) => update('dek', event.target.value)}
                style={{ minHeight: 90 }}
                aria-invalid={fieldErrors.dek ? true : undefined}
                aria-describedby={fieldErrors.dek ? 'article-dek-error' : undefined}
              />
              <div className={styles.counterRow}>
                <span>Optional summary · 320 max</span>
                <span>{form.dek.length}/320</span>
              </div>
              {fieldErrors.dek ? (
                <p className="field-error" id="article-dek-error">
                  {fieldErrors.dek}
                </p>
              ) : null}
            </div>

            <div className="field">
              <label className="field-label" htmlFor="article-body">
                Body <span className="req">*</span>
              </label>
              <textarea
                className="textarea"
                id="article-body"
                name="body"
                required
                minLength={40}
                maxLength={40_000}
                value={form.body}
                onChange={(event) => update('body', event.target.value)}
                aria-invalid={fieldErrors.body ? true : undefined}
                aria-describedby={fieldErrors.body ? 'article-body-error' : undefined}
              />
              <div className={styles.counterRow}>
                <span>40–40,000 characters</span>
                <span>{form.body.length}/40,000</span>
              </div>
              {fieldErrors.body ? (
                <p className="field-error" id="article-body-error">
                  {fieldErrors.body}
                </p>
              ) : null}
            </div>

            <div className="field">
              <label className="field-label" htmlFor="article-category">
                Category <span className="req">*</span>
              </label>
              {categoryChoices.length > 0 ? (
                <select
                  className="select"
                  id="article-category"
                  name="categorySlug"
                  value={form.categorySlug}
                  onChange={(event) => update('categorySlug', event.target.value)}
                  aria-invalid={fieldErrors.categorySlug ? true : undefined}
                >
                  {categoryChoices.map((entry) => (
                    <option key={entry.slug} value={entry.slug}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="input"
                  id="article-category"
                  name="categorySlug"
                  type="text"
                  maxLength={64}
                  value={form.categorySlug}
                  onChange={(event) => update('categorySlug', event.target.value)}
                  aria-invalid={fieldErrors.categorySlug ? true : undefined}
                />
              )}
              {fieldErrors.categorySlug ? (
                <p className="field-error">{fieldErrors.categorySlug}</p>
              ) : null}
            </div>

            <div className="field">
              <label className="field-label" htmlFor="article-tags">
                Tags
              </label>
              <input
                className="input"
                id="article-tags"
                name="tags"
                type="text"
                value={form.tags}
                onChange={(event) => update('tags', event.target.value)}
                placeholder="campus, night desk, investigation"
                aria-invalid={fieldErrors.tags ? true : undefined}
              />
              <p className="field-help">Comma separated, up to 10 tags of 32 characters each.</p>
              {fieldErrors.tags ? <p className="field-error">{fieldErrors.tags}</p> : null}
            </div>

            <div className="field">
              <label className="field-label" htmlFor="article-source">
                Source URL
              </label>
              <input
                className="input"
                id="article-source"
                name="sourceUrl"
                type="url"
                maxLength={2048}
                value={form.sourceUrl}
                onChange={(event) => update('sourceUrl', event.target.value)}
                placeholder="https://example.com/report"
                aria-invalid={fieldErrors.sourceUrl ? true : undefined}
              />
              <p className="field-help">
                Public http(s) link backing the story. Leave blank to remove the source.
              </p>
              {fieldErrors.sourceUrl ? (
                <p className="field-error">{fieldErrors.sourceUrl}</p>
              ) : null}
            </div>

            <div className="field">
              <label className="field-label" htmlFor="article-note">
                Editor note
              </label>
              <input
                className="input"
                id="article-note"
                name="editorNote"
                type="text"
                maxLength={220}
                value={form.editorNote}
                onChange={(event) => update('editorNote', event.target.value)}
              />
              <div className={styles.counterRow}>
                <span>Internal note · 220 max</span>
                <span>{form.editorNote.length}/220</span>
              </div>
              {fieldErrors.editorNote ? (
                <p className="field-error">{fieldErrors.editorNote}</p>
              ) : null}
            </div>

            <div className={styles.formFooter}>
              <button
                className="button button--primary button--sm"
                type="submit"
                disabled={busy !== null}
              >
                {busy === 'save' ? 'Saving…' : 'Save changes'}
              </button>
              <span className={styles.actionNote}>
                Saving does not publish. Use the publish action in the side panel.
              </span>
            </div>
          </form>

          {article.status === 'published' ? (
            <details className={styles.actionCard} style={{ marginTop: 'var(--space-5)' }}>
              <summary>Append a correction</summary>
              <form className={styles.correctionForm} onSubmit={correct}>
                <div className="field">
                  <label className="field-label" htmlFor="correction-summary">
                    Correction summary <span className="req">*</span>
                  </label>
                  <textarea
                    className="textarea"
                    id="correction-summary"
                    name="summary"
                    rows={3}
                    required
                    minLength={10}
                    maxLength={600}
                    value={correctionSummary}
                    onChange={(event) => setCorrectionSummary(event.target.value)}
                  />
                  <p className="field-help">
                    10–600 characters. This text is appended to the published body with today&apos;s
                    date.
                  </p>
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="correction-detail">
                    Internal detail
                  </label>
                  <textarea
                    className="textarea"
                    id="correction-detail"
                    name="detail"
                    rows={3}
                    maxLength={2000}
                    value={correctionDetail}
                    onChange={(event) => setCorrectionDetail(event.target.value)}
                  />
                  <p className="field-help">Optional, up to 2,000 characters.</p>
                </div>
                <div className={styles.actionRow}>
                  <button
                    className="button button--ghost button--sm"
                    type="submit"
                    disabled={busy !== null}
                  >
                    {busy === 'correct' ? 'Appending…' : 'Append correction'}
                  </button>
                </div>
              </form>
            </details>
          ) : null}
        </div>

        <aside className={styles.editorSide} aria-label="Publishing controls">
          <div>
            <h2>Story state</h2>
            <dl className={`kv ${styles.kvTight}`}>
              <dt>Status</dt>
              <dd>
                <span className={statusBadgeClass(article.status)}>{article.status}</span>
              </dd>
              <dt>Author</dt>
              <dd>{article.author_display || 'Unnamed'}</dd>
              <dt>Edition</dt>
              <dd>{article.edition_date}</dd>
              <dt>Published</dt>
              <dd>{publishedLabel(article.published_at)}</dd>
              <dt>Slug</dt>
              <dd className={styles.titleMeta}>/article/{article.slug}</dd>
              <dt>AI model</dt>
              <dd>{article.ai_model || (article.ai_generated === 1 ? 'Unknown' : 'Not AI')}</dd>
              <dt>Placement</dt>
              <dd>{form.placement}</dd>
            </dl>
          </div>

          <div className={styles.checkRow}>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.breaking}
                onChange={(event) => update('breaking', event.target.checked)}
              />
              <span>Breaking</span>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.featured}
                onChange={(event) => update('featured', event.target.checked)}
              />
              <span>Featured</span>
            </label>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="article-placement">
              Placement
            </label>
            <select
              className="select"
              id="article-placement"
              name="placement"
              value={form.placement}
              onChange={(event) =>
                update('placement', event.target.value as ArticleForm['placement'])
              }
            >
              <option value="lead">Lead</option>
              <option value="top">Top</option>
              <option value="standard">Standard</option>
            </select>
          </div>

          <div>
            <h2>Publishing</h2>
            <div className={styles.actionRow}>
              {article.status !== 'published' ? (
                <button
                  className="button button--primary button--sm"
                  type="button"
                  onClick={publish}
                  disabled={busy !== null}
                >
                  {busy === 'publish' ? 'Publishing…' : 'Publish'}
                </button>
              ) : (
                <button
                  className="button button--ghost button--sm"
                  type="button"
                  onClick={unpublish}
                  disabled={busy !== null}
                >
                  {busy === 'unpublish' ? 'Unpublishing…' : 'Unpublish'}
                </button>
              )}
              {article.status === 'published' ? (
                <Link
                  className={styles.panelLink}
                  href={`/article/${encodeURIComponent(article.slug)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View live ↗
                </Link>
              ) : null}
            </div>
            <p className={styles.actionNote}>
              Publishing makes the story live and assigns today&apos;s edition if it has none.
              Unpublishing removes it from the site without deleting it.
            </p>
          </div>

          {article.status === 'published' ? (
            <div className="field">
              <label className="field-label" htmlFor="article-published-at">
                Publication date override
              </label>
              <input
                className="input"
                id="article-published-at"
                name="publishedAt"
                type="datetime-local"
                value={form.publishedAt}
                onChange={(event) => update('publishedAt', event.target.value)}
                aria-invalid={fieldErrors.publishedAt ? true : undefined}
              />
              <p className="field-help">
                Leave blank to keep the current date. Saving applies it only when you enter a new
                value.
              </p>
              {fieldErrors.publishedAt ? (
                <p className="field-error">{fieldErrors.publishedAt}</p>
              ) : null}
            </div>
          ) : null}

          {images.length > 0 ? (
            <div>
              <h2>Images</h2>
              <div className={styles.photoGrid}>
                {images.map((image) => (
                  <figure className={styles.photo} key={image.id}>
                    {/* Uploads come from storage at arbitrary hosts: next/image cannot optimise them. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={image.thumb_url || image.url}
                      alt={image.alt_text || image.caption || 'Article photograph'}
                      loading="lazy"
                    />
                    <figcaption>{image.caption || 'No caption.'}</figcaption>
                  </figure>
                ))}
              </div>
              <p className={styles.actionNote}>Images are read-only in this editor.</p>
            </div>
          ) : null}

          {article.status !== 'deleted' ? (
            <div>
              <h2>Danger zone</h2>
              <p className={styles.actionNote}>
                Soft delete hides the story everywhere. The record and audit trail are kept.
              </p>
              <div className={styles.actionRow}>
                <button
                  className="button button--danger button--sm"
                  type="button"
                  onClick={remove}
                  disabled={busy !== null}
                >
                  {busy === 'delete' ? 'Deleting…' : 'Delete story'}
                </button>
              </div>
            </div>
          ) : null}
        </aside>
      </div>
    </>
  );
}
