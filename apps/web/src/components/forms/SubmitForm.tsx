'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { formatTime, pluralise } from '@/lib/format';
import type { CategoryView, PublicSettings } from '@/lib/types';
import {
  ACCEPTED_IMAGE_TYPES,
  isAcceptedImage,
  putUpload,
  requestUploadTickets,
  UploadError,
} from '@/lib/upload';
import styles from './forms.module.css';

/**
 * The filing desk. Everything is validated twice: here for a useful message,
 * and again at the API, which is the only opinion that actually counts.
 */

type FieldName = 'headline' | 'story' | 'categorySlug' | 'sourceUrl' | 'photos' | 'consent';

type FieldErrors = Partial<Record<FieldName, string>>;

type PhotoState = 'pending' | 'uploading' | 'done' | 'error';

interface PhotoEntry {
  key: string;
  file: File;
  previewUrl: string;
  state: PhotoState;
  percent: number;
  error: string | null;
}

interface SubmissionResponse {
  id?: string;
  token?: string;
  status?: string;
  message?: string;
}

interface SuccessState {
  token: string;
  url: string;
  message: string;
}

export interface SubmitFormProps {
  settings: PublicSettings['submissions'];
  categories: CategoryView[];
  timeZone: string;
  user: { displayName: string; username: string; avatarUrl: string | null };
}

const FIELD_ORDER: FieldName[] = [
  'headline',
  'story',
  'categorySlug',
  'sourceUrl',
  'photos',
  'consent',
];

const FIELD_LABELS: Record<FieldName, string> = {
  headline: 'Headline',
  story: 'Story',
  categorySlug: 'Section',
  sourceUrl: 'Source link',
  photos: 'Photos',
  consent: 'Confirmation',
};

const API_FIELD_MAP: Record<string, FieldName | null> = {
  headline: 'headline',
  story: 'story',
  categorySlug: 'categorySlug',
  sourceUrl: 'sourceUrl',
  uploadIds: 'photos',
  consent: 'consent',
  website: null,
  formStartedAt: null,
  anonymous: null,
  contactEmail: null,
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
    if (typeof value === 'number' && Number.isFinite(value)) return value;
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

export function SubmitForm({
  settings,
  categories,
  timeZone,
  user,
}: SubmitFormProps): React.JSX.Element {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const websiteRef = useRef<HTMLInputElement | null>(null);
  const startedAtRef = useRef<number>(Date.now());
  const objectUrlsRef = useRef<Set<string>>(new Set());
  const uploadIdsRef = useRef<Map<string, string>>(new Map());
  const photoKeyRef = useRef(0);

  const defaultCategory = categories.some((category) => category.slug === 'server-news')
    ? 'server-news'
    : (categories[0]?.slug ?? '');

  const [headline, setHeadline] = useState('');
  const [story, setStory] = useState('');
  const [categorySlug, setCategorySlug] = useState(defaultCategory);
  const [sourceUrl, setSourceUrl] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [consent, setConsent] = useState(false);
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const [photoNotice, setPhotoNotice] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyNote, setBusyNote] = useState('');
  const [success, setSuccess] = useState<SuccessState | null>(null);
  const [copied, setCopied] = useState(false);

  const maxBytes = settings.maxImageMb * 1024 * 1024;
  const accept = ACCEPTED_IMAGE_TYPES.join(',');

  // The clock starts when the form is on screen; the API uses it to swat bots.
  useEffect(() => {
    startedAtRef.current = Date.now();
  }, []);

  // Revoke every preview URL still alive when the form unmounts.
  useEffect(() => {
    const urls = objectUrlsRef.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  function clearError(field: FieldName): void {
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function handleFiles(selected: FileList | null): void {
    if (!selected) return;
    const incoming = Array.from(selected);
    if (incoming.length === 0) return;

    const problems: string[] = [];
    const accepted: PhotoEntry[] = [];
    const room = Math.max(0, settings.maxImages - photos.length);

    if (room === 0) {
      setPhotoNotice(
        `The desk takes ${pluralise(settings.maxImages, 'photo')} at a time. Remove one first.`,
      );
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    if (incoming.length > room) {
      problems.push(`Only ${pluralise(room, 'more photo')} fit — the rest were ignored.`);
    }

    for (const file of incoming.slice(0, room)) {
      if (!isAcceptedImage(file)) {
        problems.push(`“${file.name}” is not a JPEG, PNG or WebP.`);
        continue;
      }
      if (file.size > maxBytes) {
        problems.push(
          `“${file.name}” is ${formatBytes(file.size)}; the limit is ${settings.maxImageMb} MB.`,
        );
        continue;
      }
      const previewUrl = URL.createObjectURL(file);
      objectUrlsRef.current.add(previewUrl);
      photoKeyRef.current += 1;
      accepted.push({
        key: `photo-${photoKeyRef.current}`,
        file,
        previewUrl,
        state: 'pending',
        percent: 0,
        error: null,
      });
    }

    if (accepted.length > 0) setPhotos((current) => [...current, ...accepted]);
    setPhotoNotice(problems.length > 0 ? problems.join(' ') : null);
    // Allow picking the same file again after a validation complaint.
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removePhoto(key: string): void {
    const target = photos.find((photo) => photo.key === key);
    if (target) {
      URL.revokeObjectURL(target.previewUrl);
      objectUrlsRef.current.delete(target.previewUrl);
      uploadIdsRef.current.delete(key);
    }
    setPhotos((current) => current.filter((photo) => photo.key !== key));
  }

  function updatePhoto(key: string, patch: Partial<PhotoEntry>): void {
    setPhotos((current) =>
      current.map((photo) => (photo.key === key ? { ...photo, ...patch } : photo)),
    );
  }

  function validate(): FieldErrors {
    const next: FieldErrors = {};

    const cleanHeadline = headline.trim();
    if (!cleanHeadline) {
      next.headline = 'Add a headline first.';
    } else if (cleanHeadline.length < 6) {
      next.headline = 'A headline needs at least 6 characters.';
    } else if (cleanHeadline.length > settings.maxHeadlineChars) {
      next.headline = `Trim the headline to ${settings.maxHeadlineChars} characters.`;
    }

    const cleanStory = story.trim();
    if (!cleanStory) {
      next.story = 'The story is still empty.';
    } else if (cleanStory.length < settings.minStoryChars) {
      next.story = `The desk needs at least ${settings.minStoryChars} characters — ${settings.minStoryChars - cleanStory.length} to go.`;
    } else if (cleanStory.length > settings.maxStoryChars) {
      next.story = `The desk stops reading at ${settings.maxStoryChars} characters. Cut ${cleanStory.length - settings.maxStoryChars}.`;
    }

    if (!categorySlug) {
      next.categorySlug = 'Pick a section.';
    } else if (!categories.some((category) => category.slug === categorySlug)) {
      next.categorySlug = 'That section is closed. Pick another.';
    }

    const cleanUrl = sourceUrl.trim();
    if (!cleanUrl) {
      if (settings.requireSourceUrl) {
        next.sourceUrl = 'This paper requires a link to the original source.';
      }
    } else if (cleanUrl.length > 2048) {
      next.sourceUrl = 'That link is longer than 2048 characters.';
    } else {
      try {
        const parsed = new URL(cleanUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          next.sourceUrl = 'Use a public http:// or https:// link.';
        }
      } catch {
        next.sourceUrl = 'That does not look like a full link. Include https://';
      }
    }

    if (photos.length > settings.maxImages) {
      next.photos = `Attach at most ${pluralise(settings.maxImages, 'photo')}.`;
    }

    if (!consent) next.consent = 'Tick the box before filing.';

    return next;
  }

  async function uploadPhotos(): Promise<string[]> {
    const needed = photos.filter((photo) => !uploadIdsRef.current.has(photo.key));

    if (needed.length > 0) {
      setBusyNote('Reserving upload slots…');
      const tickets = await requestUploadTickets(
        needed.map((photo) => ({
          name: photo.file.name,
          type: photo.file.type,
          size: photo.file.size,
        })),
      );

      if (tickets.length < needed.length) {
        throw new UploadError(
          'The newsroom could not prepare every photo. Remove one and try again.',
        );
      }

      for (let index = 0; index < needed.length; index += 1) {
        const photo = needed[index];
        const ticket = tickets[index];
        if (!photo || !ticket) {
          throw new UploadError('The photo upload could not be prepared.');
        }

        updatePhoto(photo.key, { state: 'uploading', percent: 0, error: null });
        setBusyNote(`Uploading ${index + 1} of ${needed.length}: ${photo.file.name}`);

        try {
          await putUpload(ticket, photo.file, (percent) => updatePhoto(photo.key, { percent }));
        } catch (error) {
          const message =
            error instanceof Error && error.message ? error.message : 'The photo upload failed.';
          updatePhoto(photo.key, { state: 'error', error: message, percent: 0 });
          throw error instanceof UploadError ? error : new UploadError(message);
        }

        uploadIdsRef.current.set(photo.key, ticket.uploadId);
        updatePhoto(photo.key, { state: 'done', percent: 100, error: null });
      }
    }

    // Preserve the order the photos were attached in.
    return photos.flatMap((photo) => {
      const uploadId = uploadIdsRef.current.get(photo.key);
      return uploadId ? [uploadId] : [];
    });
  }

  function applyApiError(response: Response, payload: unknown): void {
    const envelope =
      payload !== null && typeof payload === 'object'
        ? (payload as {
            error?: { code?: unknown; message?: unknown; details?: unknown; issues?: unknown };
          })
        : {};
    const error = envelope.error;
    const code = typeof error?.code === 'string' ? error.code : '';
    let message =
      typeof error?.message === 'string' && error.message
        ? error.message
        : 'The desk could not take that. Try again.';

    if (response.status === 429) {
      const retryAfter =
        readRetrySeconds(error?.details) ?? Number(response.headers.get('retry-after') ?? '');
      if (Number.isFinite(retryAfter) && retryAfter > 0) {
        message = `${message} Try again in ${formatWait(retryAfter)}.`;
      }
    }

    if (response.status === 503 && code === 'STORAGE_NOT_CONFIGURED') {
      message = `${message} Remove the photos and file the text on its own.`;
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
        } else {
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
        : document.getElementById('submit-error-summary');
      element?.focus();
    }, 0);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;

    setFormError(null);
    setPhotoNotice(null);

    const nextErrors = validate();
    setErrors(nextErrors);

    const firstInvalid = FIELD_ORDER.find((field) => nextErrors[field]);
    if (firstInvalid) {
      document.getElementById(firstInvalid)?.focus();
      return;
    }

    setBusy(true);
    setBusyNote('Preparing the filing…');

    try {
      const uploadIds = photos.length > 0 ? await uploadPhotos() : [];

      setBusyNote('Sending it to the desk…');
      const response = await fetch('/api/public/submissions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          headline: headline.trim(),
          story: story.trim(),
          categorySlug,
          sourceUrl: sourceUrl.trim() || undefined,
          anonymous: settings.anonymousAllowed ? anonymous : false,
          uploadIds,
          consent: true,
          website: websiteRef.current?.value ?? '',
          formStartedAt: startedAtRef.current,
        }),
      });

      const payload = await readJson(response);

      if (!response.ok) {
        applyApiError(response, payload);
        return;
      }

      const data = payload as SubmissionResponse | null;
      const token = typeof data?.token === 'string' ? data.token : '';
      if (!token) {
        setFormError(
          'The desk accepted the story but did not return a tracking token. Do not file it again yet — tell the newsroom.',
        );
        return;
      }

      const url = `${window.location.origin}/status/${encodeURIComponent(token)}`;
      setSuccess({
        token,
        url,
        message:
          typeof data?.message === 'string' && data.message
            ? data.message
            : 'Received. The AI editor is on it.',
      });
      router.push(`/status/${encodeURIComponent(token)}`);
    } catch (error) {
      if (error instanceof UploadError) {
        if (error.code === 'STORAGE_NOT_CONFIGURED') {
          setFormError(
            'Photo storage is not configured on the server yet, so the photos cannot be uploaded. Remove them and file the text on its own — stories without photos still work.',
          );
        } else if (error.code === 'STORAGE_QUOTA_EXHAUSTED' || error.code === 'STORAGE_DEGRADED') {
          // The free Blob allowance is spent or the store is temporarily
          // unavailable. Never let a photo problem cost the story itself.
          setFormError(
            `${error.message} Remove the photos and file the story as text — text-only filings always go through.`,
          );
        } else {
          setFormError(
            `${error.message} Photos that finished are kept — press the button again to retry the rest.`,
          );
        }
        if (photos.length > 0) document.getElementById('photos')?.focus();
      } else if (error instanceof Error && error.message) {
        setFormError(`The filing failed: ${error.message}`);
      } else {
        setFormError('The filing failed. Check the connection and try again.');
      }
    } finally {
      setBusy(false);
      setBusyNote('');
    }
  }

  async function copyToken(): Promise<void> {
    if (!success) return;
    try {
      await navigator.clipboard.writeText(success.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  if (success) {
    return (
      <div className={`alert alert--success ${styles.success}`} role="status">
        <div>
          <h3>Filed.</h3>
          <p>{success.message}</p>
        </div>
        <p className={styles.note}>
          Keep this tracking link. It is the only key to this story, and the desk does not hand out
          replacements. Filed at {formatTime(new Date(), timeZone)} ({timeZone}).
        </p>
        <code className={styles.tokenBox}>{success.token}</code>
        <div className={styles.copyRow}>
          <a className="button button--sm" href={`/status/${encodeURIComponent(success.token)}`}>
            Open the tracking page
          </a>
          <button className="button button--sm button--ghost" type="button" onClick={copyToken}>
            Copy the link
          </button>
          {copied ? (
            <span className={styles.copyStatus} role="status">
              Copied.
            </span>
          ) : null}
        </div>
        <p className={styles.note}>
          If the page did not move on its own, use the link above. Nothing was saved in this
          browser, so bookmark it now.
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

  const disabled = busy || categories.length === 0;

  return (
    <form className="form" onSubmit={handleSubmit} noValidate aria-busy={busy}>
      {summaryEntries.length > 0 ? (
        <div
          className={`alert alert--error ${styles.errorSummary}`}
          id="submit-error-summary"
          role="alert"
          tabIndex={-1}
        >
          <h3>Nothing was filed yet</h3>
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
        <label className="field-label" htmlFor="headline">
          <span>Headline</span>
          <span className="count">
            {headline.length} / {settings.maxHeadlineChars}
          </span>
        </label>
        <input
          id="headline"
          name="headline"
          className="input"
          type="text"
          value={headline}
          onChange={(event) => {
            setHeadline(event.target.value);
            clearError('headline');
          }}
          required
          maxLength={settings.maxHeadlineChars}
          autoComplete="off"
          aria-invalid={errors.headline ? true : undefined}
          aria-describedby={errors.headline ? 'headline-help headline-error' : 'headline-help'}
        />
        <p className="field-help" id="headline-help">
          One line. The AI desk rewrites it into house style, so do not agonise.
        </p>
        {errors.headline ? (
          <p className="field-error" id="headline-error">
            {errors.headline}
          </p>
        ) : null}
      </div>

      <div className="field">
        <label className="field-label" htmlFor="story">
          <span>Story</span>
          <span className="count">
            {story.length} / {settings.maxStoryChars}
          </span>
        </label>
        <textarea
          id="story"
          name="story"
          className="textarea"
          value={story}
          onChange={(event) => {
            setStory(event.target.value);
            clearError('story');
          }}
          required
          rows={12}
          aria-invalid={errors.story ? true : undefined}
          aria-describedby={
            errors.story ? 'story-help story-count story-error' : 'story-help story-count'
          }
        />
        <p className="field-help" id="story-help">
          Plain text. Leave a blank line between paragraphs. No HTML, no formatting, no screenshots
          of text.
        </p>
        <p className="field-help" id="story-count">
          Minimum {settings.minStoryChars} characters. You have {story.trim().length}.
        </p>
        {errors.story ? (
          <p className="field-error" id="story-error">
            {errors.story}
          </p>
        ) : null}
      </div>

      <div className="field">
        <p className="field-label">Filing as</p>
        <div className={styles.identity}>
          {user.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className={styles.identityAvatar}
              src={user.avatarUrl}
              alt=""
              width={36}
              height={36}
              loading="lazy"
            />
          ) : (
            <span className={styles.identityAvatar} aria-hidden="true" />
          )}
          <span className={styles.identityText}>
            <strong>{user.displayName}</strong>
            <span className={styles.identityHandle}>@{user.username}</span>
          </span>
        </div>
        <p className="field-help">
          {anonymous && settings.anonymousAllowed
            ? 'Your name is hidden from readers on this story. The desk still knows who filed it.'
            : 'This is the byline if the story runs. Change it on Discord if that is not the name you want printed.'}
        </p>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="categorySlug">
          <span>Section</span>
        </label>
        <select
          id="categorySlug"
          name="categorySlug"
          className="select"
          value={categorySlug}
          onChange={(event) => {
            setCategorySlug(event.target.value);
            clearError('categorySlug');
          }}
          required
          aria-invalid={errors.categorySlug ? true : undefined}
          aria-describedby={
            errors.categorySlug ? 'categorySlug-help categorySlug-error' : 'categorySlug-help'
          }
        >
          {categories.length === 0 ? <option value="">No sections are open</option> : null}
          {categories.map((category) => (
            <option key={category.slug} value={category.slug}>
              {category.name}
            </option>
          ))}
        </select>
        <p className="field-help" id="categorySlug-help">
          Where the desk should file it. The editor may move it anyway.
        </p>
        {errors.categorySlug ? (
          <p className="field-error" id="categorySlug-error">
            {errors.categorySlug}
          </p>
        ) : null}
      </div>

      <div className="field">
        <label className="field-label" htmlFor="sourceUrl">
          <span>
            Source link{' '}
            {settings.requireSourceUrl ? (
              <span className="req" aria-hidden="true">
                *
              </span>
            ) : (
              <span className={styles.optional}>Optional</span>
            )}
          </span>
        </label>
        <input
          id="sourceUrl"
          name="sourceUrl"
          className="input"
          type="url"
          inputMode="url"
          value={sourceUrl}
          onChange={(event) => {
            setSourceUrl(event.target.value);
            clearError('sourceUrl');
          }}
          required={settings.requireSourceUrl}
          maxLength={2048}
          autoComplete="url"
          placeholder="https://"
          aria-invalid={errors.sourceUrl ? true : undefined}
          aria-describedby={errors.sourceUrl ? 'sourceUrl-help sourceUrl-error' : 'sourceUrl-help'}
        />
        <p className="field-help" id="sourceUrl-help">
          A public link to the original post or source. The desk checks it; a link to a private chat
          will not survive that check.
          {settings.requireSourceUrl ? ' Required by this paper.' : ''}
        </p>
        {errors.sourceUrl ? (
          <p className="field-error" id="sourceUrl-error">
            {errors.sourceUrl}
          </p>
        ) : null}
      </div>

      {settings.anonymousAllowed ? (
        <div className="field">
          <label className="checkbox" htmlFor="anonymous">
            <input
              id="anonymous"
              name="anonymous"
              type="checkbox"
              checked={anonymous}
              onChange={(event) => setAnonymous(event.target.checked)}
            />
            <span>
              <strong>File anonymously</strong>
              <span className="field-help" style={{ display: 'block' }}>
                Your name will not be published. The desk still sees which Discord account filed it.
              </span>
            </span>
          </label>
        </div>
      ) : null}

      <div className="field">
        <label className="field-label" htmlFor="photos">
          <span>
            Photos <span className={styles.optional}>Optional</span>
          </span>
          <span className="count">
            {photos.length} / {settings.maxImages}
          </span>
        </label>
        <input
          ref={fileInputRef}
          id="photos"
          name="photos"
          className={styles.fileInput}
          type="file"
          multiple
          accept={accept}
          onChange={(event) => handleFiles(event.target.files)}
          disabled={busy}
          aria-invalid={photoNotice ? true : undefined}
          aria-describedby={photoNotice ? 'photos-help photos-notice' : 'photos-help'}
        />
        <p className="field-help" id="photos-help">
          Up to {pluralise(settings.maxImages, 'photo')}, JPEG, PNG or WebP, {settings.maxImageMb}{' '}
          MB each. Photos are published as submitted. AI-generated images are not accepted.
        </p>
        {photoNotice ? (
          <p className="field-error" id="photos-notice" role="alert">
            {photoNotice}
          </p>
        ) : null}

        {photos.length > 0 ? (
          <ul className={styles.photoList}>
            {photos.map((photo) => (
              <li key={photo.key} className={styles.photoItem}>
                {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
                <img
                  className={styles.photoThumb}
                  src={photo.previewUrl}
                  alt=""
                  width={84}
                  height={84}
                />
                <div className={styles.photoMeta}>
                  <span className={styles.photoName}>{photo.file.name}</span>
                  <span className={styles.photoState}>
                    {formatBytes(photo.file.size)}
                    {photo.state === 'pending' ? ' · Queued' : null}
                    {photo.state === 'uploading' ? ` · Uploading ${photo.percent}%` : null}
                    {photo.state === 'done' ? ' · Uploaded' : null}
                    {photo.state === 'error' ? ' · Upload failed' : null}
                  </span>
                  {photo.state === 'uploading' ? (
                    <div className="progress" aria-hidden="true">
                      <span style={{ width: `${photo.percent}%` }} />
                    </div>
                  ) : null}
                  {photo.error ? (
                    <span className={`${styles.photoState} ${styles.photoError}`}>
                      {photo.error}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className={styles.remove}
                    onClick={() => removePhoto(photo.key)}
                    disabled={busy}
                    aria-label={`Remove ${photo.file.name}`}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        <p className={styles.note}>
          Submitted photos are kept as sent — the desk does not retouch them. Do not send pictures
          of other people without their say-so.
        </p>
      </div>

      <div className="field">
        <label className="checkbox" htmlFor="consent">
          <input
            id="consent"
            name="consent"
            type="checkbox"
            checked={consent}
            onChange={(event) => {
              setConsent(event.target.checked);
              clearError('consent');
            }}
            required
            aria-invalid={errors.consent ? true : undefined}
            aria-describedby={errors.consent ? 'consent-error' : undefined}
          />
          <span>
            I confirm this is my own account of events and I have the right to share these photos.
          </span>
        </label>
        {errors.consent ? (
          <p className="field-error" id="consent-error">
            {errors.consent}
          </p>
        ) : null}
      </div>

      <div className="visually-hidden" aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input
          ref={websiteRef}
          id="website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          defaultValue=""
        />
      </div>

      <div className={styles.formActions}>
        <button type="submit" className="button button--primary" disabled={disabled}>
          {busy ? 'Filing…' : 'File the story'}
        </button>
        {busy ? (
          <p className={styles.busyNote} aria-live="polite">
            {busyNote || 'Working…'}
          </p>
        ) : (
          <p className={styles.note}>
            You will get a tracking token. Keep it — the desk will not email it to you.
          </p>
        )}
      </div>

      {categories.length === 0 ? (
        <p className="alert alert--warn" role="alert">
          The desk has not opened any sections yet, so nothing can be filed. Try again once the
          editor has set up the paper.
        </p>
      ) : null}
    </form>
  );
}
