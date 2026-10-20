'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminErrorMessage, adminFetch, adminFieldErrors } from './api';
import styles from './ops.module.css';

interface CreateCategoryResponse {
  ok: boolean;
  slug: string;
}

export function CategoryForm(): React.JSX.Element {
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [accent, setAccent] = useState('');
  const [sortOrder, setSortOrder] = useState('50');
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'error' | 'success'; message: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function create(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setStatus(null);
    setFieldErrors({});

    const trimmedName = name.trim();
    if (trimmedName.length < 2 || trimmedName.length > 80) {
      setStatus({ kind: 'error', message: 'Name must be between 2 and 80 characters.' });
      return;
    }

    const order = Number(sortOrder);
    if (!Number.isFinite(order) || !Number.isInteger(order) || order < 0 || order > 999) {
      setStatus({ kind: 'error', message: 'Sort order must be a whole number between 0 and 999.' });
      return;
    }

    const body: Record<string, unknown> = {
      name: trimmedName,
      sortOrder: order,
      enabled,
    };
    if (slug.trim()) body.slug = slug.trim();
    if (description.trim()) body.description = description.trim();
    if (accent.trim()) body.accent = accent.trim();

    setBusy(true);
    try {
      const result = await adminFetch<CreateCategoryResponse>('/categories', {
        method: 'POST',
        body,
      });
      setStatus({
        kind: 'success',
        message: `Category "${result.slug}" created. It is available to submissions now.`,
      });
      setName('');
      setSlug('');
      setDescription('');
      setAccent('');
      setSortOrder('50');
      setEnabled(true);
      router.refresh();
    } catch (error) {
      setFieldErrors(adminFieldErrors(error));
      setStatus({ kind: 'error', message: adminErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={create} noValidate>
      <p className={styles.groupNote}>
        The slug is generated from the name when left blank. Categories feed the public navigation
        and the submission form.
      </p>

      {status ? (
        <div
          className={`alert ${status.kind === 'error' ? 'alert--error' : 'alert--success'}`}
          role={status.kind === 'error' ? 'alert' : 'status'}
        >
          <p>{status.message}</p>
        </div>
      ) : null}

      <div className="field">
        <div className="field-label">
          <label htmlFor="category-name">
            Name{' '}
            <span className="req" aria-hidden="true">
              *
            </span>
          </label>
          <span className={styles.fieldKey}>name</span>
        </div>
        <input
          className="input"
          id="category-name"
          type="text"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          maxLength={80}
          required
          aria-invalid={Boolean(fieldErrors.name)}
          aria-describedby={fieldErrors.name ? 'category-name-error' : undefined}
        />
        {fieldErrors.name ? (
          <span className="field-error" id="category-name-error">
            {fieldErrors.name}
          </span>
        ) : null}
      </div>

      <div className="field">
        <div className="field-label">
          <label htmlFor="category-slug">Slug</label>
          <span className={styles.fieldKey}>slug</span>
        </div>
        <input
          className="input"
          id="category-slug"
          type="text"
          value={slug}
          onChange={(event) => setSlug(event.currentTarget.value)}
          maxLength={64}
          placeholder="generated-from-name"
          aria-invalid={Boolean(fieldErrors.slug)}
        />
        {fieldErrors.slug ? <span className="field-error">{fieldErrors.slug}</span> : null}
      </div>

      <div className="field">
        <div className="field-label">
          <label htmlFor="category-description">Description</label>
          <span className={styles.fieldKey}>description</span>
        </div>
        <textarea
          className="textarea"
          id="category-description"
          value={description}
          onChange={(event) => setDescription(event.currentTarget.value)}
          maxLength={400}
          rows={3}
          aria-invalid={Boolean(fieldErrors.description)}
        />
        {fieldErrors.description ? (
          <span className="field-error">{fieldErrors.description}</span>
        ) : null}
      </div>

      <div className="field">
        <div className="field-label">
          <label htmlFor="category-accent">Accent colour</label>
          <span className={styles.fieldKey}>accent</span>
        </div>
        <input
          className="input"
          id="category-accent"
          type="text"
          value={accent}
          onChange={(event) => setAccent(event.currentTarget.value)}
          maxLength={20}
          placeholder="#c81e1e"
          aria-invalid={Boolean(fieldErrors.accent)}
        />
        <p className="field-help">Any CSS colour value. Used for the section label.</p>
      </div>

      <div className="field">
        <div className="field-label">
          <label htmlFor="category-sort">Sort order</label>
          <span className={styles.fieldKey}>sortOrder</span>
        </div>
        <input
          className="input"
          id="category-sort"
          type="number"
          inputMode="numeric"
          min={0}
          max={999}
          step={1}
          value={sortOrder}
          onChange={(event) => setSortOrder(event.currentTarget.value)}
          aria-invalid={Boolean(fieldErrors.sortOrder)}
        />
        <p className="field-help">Lower numbers appear first in the navigation.</p>
      </div>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.currentTarget.checked)}
        />
        <span>Enabled — show this category publicly.</span>
      </label>

      <button className="button button--primary" type="submit" disabled={busy}>
        {busy ? 'Creating...' : 'Create category'}
      </button>
    </form>
  );
}
