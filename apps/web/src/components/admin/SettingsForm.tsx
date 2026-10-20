'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminErrorMessage, adminFetch, adminFieldErrors } from './api';
import styles from './ops.module.css';

export type SettingType = 'string' | 'number' | 'boolean' | 'stringlist';

/** Mirrors `SettingDef & { key }` returned by GET /admin/settings. */
export interface SettingDefinition {
  key: string;
  type: SettingType;
  default: string | number | boolean | string[];
  label: string;
  description: string;
  group?: string;
  public?: boolean;
  min?: number;
  max?: number;
  multiline?: boolean;
}

type DraftValue = string | boolean;
type Draft = Record<string, DraftValue>;
type Baseline = Record<string, unknown>;

interface SaveStatus {
  kind: 'error' | 'success' | 'info';
  message: string;
}

const GROUP_ORDER = [
  'site',
  'submissions',
  'content',
  'moderation',
  'autonomy',
  'ai',
  'appearance',
  'storage',
];

const GROUP_LABELS: Record<string, string> = {
  site: 'Site',
  submissions: 'Submissions',
  content: 'Content',
  moderation: 'Moderation',
  autonomy: 'Autonomy',
  ai: 'AI desk',
  appearance: 'Appearance',
  storage: 'Storage',
};

const GROUP_NOTES: Record<string, string> = {
  site: 'Masthead, canonical URL and the timezone every edition date is calculated in.',
  submissions: 'Intake limits for the public submission form and the API behind it.',
  content: 'Editorial switches and the phrase lists that force a story into human review.',
  moderation: 'Thresholds between 0 and 1. Higher duplicate/spam values are stricter.',
  autonomy:
    'The robot runs on its own. These switches decide whether it may publish, build editions and hand out awards without a human.',
  ai: 'Prompt-level guidance for the AI editor. Keep voice notes stylistic, never factual instructions.',
  appearance: 'What the public front page shows and how much of it.',
  storage: 'Storage is configured through server environment variables, not through settings.',
};

function isSecretKey(key: string): boolean {
  return /secret|password|token|api[_-]?key/i.test(key);
}

function titleCase(value: string): string {
  if (!value) return 'Other';
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/[-_]/g, ' ');
}

function buildDraft(definitions: readonly SettingDefinition[], values: Baseline): Draft {
  const draft: Draft = {};
  for (const def of definitions) {
    const value = values[def.key];

    if (def.type === 'boolean') {
      draft[def.key] = value === true;
    } else if (def.type === 'stringlist') {
      draft[def.key] = Array.isArray(value)
        ? value.map((item) => String(item)).join('\n')
        : typeof value === 'string'
          ? value
          : '';
    } else if (isSecretKey(def.key) && def.type === 'string') {
      // Secrets are never sent back to the browser, so start blank.
      draft[def.key] = '';
    } else if (def.type === 'number') {
      draft[def.key] =
        typeof value === 'number' && Number.isFinite(value)
          ? String(value)
          : typeof value === 'string'
            ? value
            : String(def.default ?? '');
    } else {
      draft[def.key] = value === undefined || value === null ? '' : String(value);
    }
  }
  return draft;
}

function normalizeValue(def: SettingDefinition, value: unknown): unknown {
  switch (def.type) {
    case 'boolean':
      return value === true;
    case 'number': {
      const numeric = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    }
    case 'stringlist':
      return Array.isArray(value) ? value.map((item) => String(item)) : [];
    default:
      return value === undefined || value === null ? '' : String(value);
  }
}

interface Group {
  prefix: string;
  definitions: SettingDefinition[];
}

function groupDefinitions(definitions: readonly SettingDefinition[]): Group[] {
  const buckets = new Map<string, SettingDefinition[]>();

  for (const def of definitions) {
    const dot = def.key.indexOf('.');
    const prefix = dot === -1 ? 'other' : def.key.slice(0, dot);
    const bucket = buckets.get(prefix);
    if (bucket) bucket.push(def);
    else buckets.set(prefix, [def]);
  }

  const groups: Group[] = [];
  for (const prefix of GROUP_ORDER) {
    const bucket = buckets.get(prefix);
    if (bucket && bucket.length > 0) {
      groups.push({ prefix, definitions: bucket });
      buckets.delete(prefix);
    }
  }
  for (const [prefix, bucket] of buckets) {
    if (bucket.length > 0) groups.push({ prefix, definitions: bucket });
  }
  return groups;
}

export interface SettingsFormProps {
  definitions: SettingDefinition[];
  values: Baseline;
}

export function SettingsForm({ definitions, values }: SettingsFormProps): React.JSX.Element {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => buildDraft(definitions, values));
  const [baseline, setBaseline] = useState<Baseline>(values);
  const [status, setStatus] = useState<SaveStatus | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const groups = groupDefinitions(definitions);

  function updateValue(key: string, value: DraftValue): void {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFieldErrors({});
    setStatus(null);

    const patch: Record<string, unknown> = {};

    for (const def of definitions) {
      const raw = draft[def.key];
      const current = baseline[def.key];

      if (def.type === 'boolean') {
        const next = raw === true;
        if (next !== (current === true)) patch[def.key] = next;
        continue;
      }

      if (def.type === 'number') {
        const text = typeof raw === 'string' ? raw.trim() : '';
        const numeric = Number(text);
        if (text === '' || !Number.isFinite(numeric)) {
          setStatus({ kind: 'error', message: `${def.label} must be a number.` });
          return;
        }
        if (def.min !== undefined && numeric < def.min) {
          setStatus({ kind: 'error', message: `${def.label} must be at least ${def.min}.` });
          return;
        }
        if (def.max !== undefined && numeric > def.max) {
          setStatus({ kind: 'error', message: `${def.label} must be at most ${def.max}.` });
          return;
        }
        if (JSON.stringify(numeric) !== JSON.stringify(normalizeValue(def, current))) {
          patch[def.key] = numeric;
        }
        continue;
      }

      if (def.type === 'stringlist') {
        const text = typeof raw === 'string' ? raw : '';
        const list = text
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
        if (JSON.stringify(list) !== JSON.stringify(normalizeValue(def, current))) {
          patch[def.key] = list;
        }
        continue;
      }

      const text = typeof raw === 'string' ? raw : '';

      if (isSecretKey(def.key)) {
        // Blank means "leave the stored secret untouched".
        if (text.trim() === '') continue;
        patch[def.key] = text;
        continue;
      }

      if (text !== normalizeValue(def, current)) patch[def.key] = text;
    }

    if (Object.keys(patch).length === 0) {
      setStatus({ kind: 'info', message: 'No changes to save.' });
      return;
    }

    setBusy(true);
    try {
      const result = await adminFetch<{ ok: boolean; values: Baseline }>('/settings', {
        method: 'PUT',
        body: patch,
      });
      const savedValues = result.values ?? baseline;
      setBaseline(savedValues);
      setDraft(buildDraft(definitions, savedValues));
      const count = Object.keys(patch).length;
      setStatus({
        kind: 'success',
        message: `Saved ${count} setting${count === 1 ? '' : 's'}. Public pages were revalidated.`,
      });
      router.refresh();
    } catch (error) {
      setFieldErrors(adminFieldErrors(error));
      setStatus({ kind: 'error', message: adminErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  function renderField(def: SettingDefinition): React.JSX.Element {
    const inputId = `setting-${def.key.replace(/[^a-zA-Z0-9]+/g, '-')}`;
    const helpId = `${inputId}-help`;
    const error = fieldErrors[def.key];
    const raw = draft[def.key];
    const describedBy = error ? `${helpId} ${helpId}-error` : helpId;

    if (def.type === 'boolean') {
      return (
        <div className={`field ${styles.fieldWide}`} key={def.key}>
          <label className="checkbox">
            <input
              id={inputId}
              type="checkbox"
              checked={raw === true}
              onChange={(event) => updateValue(def.key, event.currentTarget.checked)}
              aria-describedby={describedBy}
            />
            <span>{def.label}</span>
          </label>
          <p className="field-help" id={helpId}>
            {def.description} <span className={styles.fieldKey}>{def.key}</span>
          </p>
          {error ? (
            <span className="field-error" id={`${helpId}-error`}>
              {error}
            </span>
          ) : null}
        </div>
      );
    }

    const range =
      def.type === 'number' && (def.min !== undefined || def.max !== undefined) ? (
        <span className={styles.rangeHint}>
          {' '}
          Range {def.min ?? '—'}–{def.max ?? '—'}.
        </span>
      ) : null;

    const listHint =
      def.type === 'stringlist' ? (
        <span className={styles.secretHint}> One entry per line.</span>
      ) : null;

    const control =
      def.type === 'stringlist' || def.multiline || isSecretKey(def.key) ? (
        isSecretKey(def.key) ? (
          <input
            className="input"
            id={inputId}
            type="password"
            value={typeof raw === 'string' ? raw : ''}
            onChange={(event) => updateValue(def.key, event.currentTarget.value)}
            placeholder="Unchanged - leave blank to keep the current value"
            autoComplete="new-password"
            aria-describedby={describedBy}
            aria-invalid={Boolean(error)}
          />
        ) : (
          <textarea
            className="textarea"
            id={inputId}
            value={typeof raw === 'string' ? raw : ''}
            onChange={(event) => updateValue(def.key, event.currentTarget.value)}
            rows={def.type === 'stringlist' ? 5 : 6}
            aria-describedby={describedBy}
            aria-invalid={Boolean(error)}
          />
        )
      ) : def.type === 'number' ? (
        <input
          className="input"
          id={inputId}
          type="number"
          inputMode="numeric"
          value={typeof raw === 'string' ? raw : ''}
          min={def.min}
          max={def.max}
          step="any"
          onChange={(event) => updateValue(def.key, event.currentTarget.value)}
          aria-describedby={describedBy}
          aria-invalid={Boolean(error)}
        />
      ) : (
        <input
          className="input"
          id={inputId}
          type="text"
          value={typeof raw === 'string' ? raw : ''}
          onChange={(event) => updateValue(def.key, event.currentTarget.value)}
          aria-describedby={describedBy}
          aria-invalid={Boolean(error)}
        />
      );

    return (
      <div className={`field ${def.multiline ? styles.fieldWide : ''}`} key={def.key}>
        <div className="field-label">
          <label htmlFor={inputId}>{def.label}</label>
          <span className={styles.fieldKey}>{def.key}</span>
        </div>
        {control}
        <p className="field-help" id={helpId}>
          {def.description}
          {range}
          {listHint}
        </p>
        {error ? (
          <span className="field-error" id={`${helpId}-error`}>
            {error}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <form className="stack" onSubmit={save} noValidate>
      {status ? (
        <div
          className={`alert ${
            status.kind === 'error'
              ? 'alert--error'
              : status.kind === 'success'
                ? 'alert--success'
                : ''
          } ${styles.noticeBar}`}
          role={status.kind === 'error' ? 'alert' : 'status'}
        >
          <p>{status.message}</p>
        </div>
      ) : null}

      {groups.map((group) => {
        const label = GROUP_LABELS[group.prefix] ?? titleCase(group.prefix);
        const note = GROUP_NOTES[group.prefix];
        return (
          <section
            className="panel"
            key={group.prefix}
            aria-labelledby={`settings-group-${group.prefix}`}
          >
            <div className={styles.groupHead}>
              <h2 id={`settings-group-${group.prefix}`}>{label}</h2>
              <span className="badge badge--muted">{group.definitions.length} keys</span>
            </div>
            {note ? <p className={styles.groupNote}>{note}</p> : null}

            {group.prefix === 'autonomy' ? (
              <div className="alert alert--warn">
                <h3>How the 11 PM / midnight handover works</h3>
                <p>
                  The paper that goes live at midnight is assembled the evening before.
                  <code> autonomy.edition_hour</code> is that hour in newsroom time:{' '}
                  <strong>23</strong> means the AI starts building at <strong>11 PM IST</strong> so
                  the edition is ready by <strong>12 AM</strong>. Turning off{' '}
                  <code>autonomy.daily_edition</code> skips the nightly build;{' '}
                  <code>autonomy.enabled</code> is the master switch for the whole autonomous
                  newsroom.
                </p>
                <p className={styles.actionMessage}>
                  Edition rebuilds and AI publishing are audited. Changing these switches does not
                  rewrite stories that are already live.
                </p>
              </div>
            ) : null}

            <div className={styles.fieldGrid}>{group.definitions.map(renderField)}</div>
          </section>
        );
      })}

      <div className="cluster" style={{ marginTop: 'var(--space-2)' }}>
        <button className="button button--primary" type="submit" disabled={busy}>
          {busy ? 'Saving...' : 'Save settings'}
        </button>
        <span className={styles.pageNote} style={{ margin: 0 }}>
          Only changed keys are sent. Everything else keeps its current value.
        </span>
      </div>
    </form>
  );
}
