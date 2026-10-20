/**
 * Dependency-free SQL statement splitter for SQLite migration files.
 * Correctly ignores semicolons inside string literals, quoted identifiers
 * and comments. Schema files in this repo contain no triggers, but the
 * splitter still handles BEGIN ... END blocks conservatively.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;
  let mode: 'normal' | 'single' | 'double' | 'backtick' | 'lineComment' | 'blockComment' = 'normal';

  while (i < sql.length) {
    const ch = sql[i]!;
    const next = sql[i + 1];

    if (mode === 'lineComment') {
      if (ch === '\n') {
        mode = 'normal';
        current += ch;
      }
      i += 1;
      continue;
    }

    if (mode === 'blockComment') {
      if (ch === '*' && next === '/') {
        mode = 'normal';
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (mode === 'single') {
      current += ch;
      if (ch === "'") {
        if (next === "'") {
          current += next;
          i += 2;
          continue;
        }
        mode = 'normal';
      }
      i += 1;
      continue;
    }

    if (mode === 'double') {
      current += ch;
      if (ch === '"') {
        if (next === '"') {
          current += next;
          i += 2;
          continue;
        }
        mode = 'normal';
      }
      i += 1;
      continue;
    }

    if (mode === 'backtick') {
      current += ch;
      if (ch === '`') {
        mode = 'normal';
      }
      i += 1;
      continue;
    }

    // normal mode
    if (ch === '-' && next === '-') {
      mode = 'lineComment';
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      mode = 'blockComment';
      i += 2;
      continue;
    }
    if (ch === "'") {
      mode = 'single';
      current += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      mode = 'double';
      current += ch;
      i += 1;
      continue;
    }
    if (ch === '`') {
      mode = 'backtick';
      current += ch;
      i += 1;
      continue;
    }
    if (ch === ';') {
      const trimmed = current.trim();
      if (trimmed.length > 0) statements.push(trimmed);
      current = '';
      i += 1;
      continue;
    }

    current += ch;
    i += 1;
  }

  const tail = current.trim();
  if (tail.length > 0) statements.push(tail);
  return statements;
}
