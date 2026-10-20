import { describe, expect, it } from 'vitest';
import { splitSqlStatements } from '../src/db/sql-split.js';

describe('splitSqlStatements', () => {
  it('splits simple statements and drops empties', () => {
    const statements = splitSqlStatements('SELECT 1;\n\nSELECT 2;\n');
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('SELECT 1');
    expect(statements[1]).toContain('SELECT 2');
  });

  it('ignores semicolons inside string literals', () => {
    const statements = splitSqlStatements(
      "INSERT INTO t (value) VALUES ('semi;colon');\nSELECT 1;",
    );
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('semi;colon');
  });

  it('ignores escaped quotes inside string literals', () => {
    const statements = splitSqlStatements("INSERT INTO t (value) VALUES ('it''s; fine');SELECT 1;");
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("it''s; fine");
  });

  it('ignores semicolons inside line and block comments', () => {
    const statements = splitSqlStatements(
      ['-- a comment; with semicolon', 'SELECT 1;', '/* block; comment */', 'SELECT 2;'].join('\n'),
    );
    expect(statements).toHaveLength(2);
  });

  it('ignores semicolons inside quoted identifiers', () => {
    const statements = splitSqlStatements('CREATE TABLE "weird;name" (id TEXT);SELECT 1;');
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('"weird;name"');
  });
});
