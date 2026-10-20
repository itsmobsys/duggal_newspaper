'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminErrorMessage, adminFetch, adminFieldErrors } from './api';
import styles from './ops.module.css';

interface CreateAwardResponse {
  ok: boolean;
  id: string;
}

export function AwardForm(): React.JSX.Element {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [winnerName, setWinnerName] = useState('');
  const [citation, setCitation] = useState('');
  const [articleId, setArticleId] = useState('');
  const [editionDate, setEditionDate] = useState('');
  const [sortOrder, setSortOrder] = useState('10');
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'error' | 'success'; message: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function create(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setStatus(null);
    setFieldErrors({});

    const trimmedTitle = title.trim();
    if (trimmedTitle.length < 3 || trimmedTitle.length > 80) {
      setStatus({ kind: 'error', message: 'Title must be between 3 and 80 characters.' });
      return;
    }

    const trimmedWinner = winnerName.trim();
    if (trimmedWinner.length < 1 || trimmedWinner.length > 80) {
      setStatus({ kind: 'error', message: 'Winner name must be between 1 and 80 characters.' });
      return;
    }

    const order = Number(sortOrder);
    if (!Number.isFinite(order) || !Number.isInteger(order) || order < 0 || order > 999) {
      setStatus({ kind: 'error', message: 'Sort order must be a whole number between 0 and 999.' });
      return;
    }

    if (citation.trim().length > 400) {
      setStatus({ kind: 'error', message: 'Citation must be 400 characters or fewer.' });
      return;
    }

    const body: Record<string, unknown> = {
      title: trimmedTitle,
      winnerName: trimmedWinner,
      sortOrder: order,
      active,
    };
    if (category.trim()) body.category = category.trim();
    if (citation.trim()) body.citation = citation.trim();
    if (articleId.trim()) body.articleId = articleId.trim();
    if (editionDate) body.editionDate = editionDate;

    setBusy(true);
    try {
      const result = await adminFetch<CreateAwardResponse>('/awards', {
        method: 'POST',
        body,
      });
      setStatus({
        kind: 'success',
        message: `Award created (${result.id}). It is live on the awards page if active.`,
      });
      setTitle('');
      setCategory('');
      setWinnerName('');
      setCitation('');
      setArticleId('');
      setEditionDate('');
      setSortOrder('10');
      setActive(true);
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
        Manual awards appear alongside the AI&apos;s weekly picks. Only the fields below are
        accepted by the API.
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
          <label htmlFor="award-title">
            Title{' '}
            <span className="req" aria-hidden="true">
              *
            </span>
          </label>
          <span className={styles.fieldKey}>title</span>
        </div>
        <input
          className="input"
          id="award-title"
          type="text"
          value={title}
          onChange={(event) => setTitle(event.currentTarget.value)}
          maxLength={80}
          required
          aria-invalid={Boolean(fieldErrors.title)}
        />
        {fieldErrors.title ? <span className="field-error">{fieldErrors.title}</span> : null}
      </div>

      <div className="field">
        <div className="field-label">
          <label htmlFor="award-winner">
            Winner{' '}
            <span className="req" aria-hidden="true">
              *
            </span>
          </label>
          <span className={styles.fieldKey}>winnerName</span>
        </div>
        <input
          className="input"
          id="award-winner"
          type="text"
          value={winnerName}
          onChange={(event) => setWinnerName(event.currentTarget.value)}
          maxLength={80}
          required
          aria-invalid={Boolean(fieldErrors.winnerName)}
        />
        {fieldErrors.winnerName ? (
          <span className="field-error">{fieldErrors.winnerName}</span>
        ) : null}
      </div>

      <div className="field">
        <div className="field-label">
          <label htmlFor="award-category">Category</label>
          <span className={styles.fieldKey}>category</span>
        </div>
        <input
          className="input"
          id="award-category"
          type="text"
          value={category}
          onChange={(event) => setCategory(event.currentTarget.value)}
          maxLength={40}
          placeholder="manual"
          aria-invalid={Boolean(fieldErrors.category)}
        />
        <p className="field-help">Defaults to &quot;manual&quot; on the API.</p>
      </div>

      <div className="field">
        <div className="field-label">
          <label htmlFor="award-citation">Citation</label>
          <span className={styles.fieldKey}>citation</span>
        </div>
        <textarea
          className="textarea"
          id="award-citation"
          value={citation}
          onChange={(event) => setCitation(event.currentTarget.value)}
          maxLength={400}
          rows={3}
          aria-invalid={Boolean(fieldErrors.citation)}
        />
        {fieldErrors.citation ? <span className="field-error">{fieldErrors.citation}</span> : null}
      </div>

      <div className="field">
        <div className="field-label">
          <label htmlFor="award-article">Article ID</label>
          <span className={styles.fieldKey}>articleId</span>
        </div>
        <input
          className="input"
          id="award-article"
          type="text"
          value={articleId}
          onChange={(event) => setArticleId(event.currentTarget.value)}
          maxLength={80}
          aria-invalid={Boolean(fieldErrors.articleId)}
        />
        <p className="field-help">Optional internal article ID to link the award to a story.</p>
      </div>

      <div className="field">
        <div className="field-label">
          <label htmlFor="award-edition-date">Edition date</label>
          <span className={styles.fieldKey}>editionDate</span>
        </div>
        <input
          className="input"
          id="award-edition-date"
          type="date"
          value={editionDate}
          onChange={(event) => setEditionDate(event.currentTarget.value)}
          aria-invalid={Boolean(fieldErrors.editionDate)}
        />
        <p className="field-help">Defaults to today in the newsroom timezone.</p>
      </div>

      <div className="field">
        <div className="field-label">
          <label htmlFor="award-sort">Sort order</label>
          <span className={styles.fieldKey}>sortOrder</span>
        </div>
        <input
          className="input"
          id="award-sort"
          type="number"
          inputMode="numeric"
          min={0}
          max={999}
          step={1}
          value={sortOrder}
          onChange={(event) => setSortOrder(event.currentTarget.value)}
          aria-invalid={Boolean(fieldErrors.sortOrder)}
        />
        <p className="field-help">Lower numbers appear first.</p>
      </div>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={active}
          onChange={(event) => setActive(event.currentTarget.checked)}
        />
        <span>Active — show this award publicly.</span>
      </label>

      <button className="button button--primary" type="submit" disabled={busy}>
        {busy ? 'Creating...' : 'Create award'}
      </button>
    </form>
  );
}
