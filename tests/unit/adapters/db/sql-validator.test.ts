import { describe, it, expect } from 'vitest';
import { validateSql } from '../../../../src/adapters/db/sql-validator.js';

describe('validateSql', () => {
  it('allows SELECT statements', () => {
    expect(validateSql('SELECT * FROM users')).toEqual({ valid: true });
  });

  it('allows EXPLAIN statements', () => {
    expect(validateSql('EXPLAIN SELECT * FROM users')).toEqual({ valid: true });
  });

  it('allows SHOW statements', () => {
    expect(validateSql('SHOW TABLES')).toEqual({ valid: true });
  });

  it('allows DESCRIBE statements', () => {
    expect(validateSql('DESCRIBE users')).toEqual({ valid: true });
  });

  it('allows DESC statements', () => {
    expect(validateSql('DESC users')).toEqual({ valid: true });
  });

  it('allows WITH ... SELECT (CTE)', () => {
    expect(validateSql('WITH cte AS (SELECT 1) SELECT * FROM cte')).toEqual({ valid: true });
  });

  it('rejects empty query', () => {
    const result = validateSql('');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Empty query');
  });

  it('rejects whitespace-only query', () => {
    const result = validateSql('   ');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Empty query');
  });

  it('rejects INSERT statements', () => {
    const result = validateSql('INSERT INTO users VALUES (1)');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('INSERT');
  });

  it('rejects UPDATE statements', () => {
    const result = validateSql('UPDATE users SET name = "x"');
    expect(result.valid).toBe(false);
  });

  it('rejects DELETE statements', () => {
    const result = validateSql('DELETE FROM users');
    expect(result.valid).toBe(false);
  });

  it('rejects DROP statements', () => {
    const result = validateSql('DROP TABLE users');
    expect(result.valid).toBe(false);
  });

  it('rejects ALTER statements', () => {
    const result = validateSql('ALTER TABLE users ADD COLUMN age INT');
    expect(result.valid).toBe(false);
  });

  it('rejects TRUNCATE statements', () => {
    const result = validateSql('TRUNCATE TABLE users');
    expect(result.valid).toBe(false);
  });

  it('rejects CREATE statements', () => {
    const result = validateSql('CREATE TABLE x (id INT)');
    expect(result.valid).toBe(false);
  });

  it('rejects multiple statements', () => {
    const result = validateSql('SELECT 1; SELECT 2');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Multiple statements');
  });

  it('allows trailing semicolon', () => {
    expect(validateSql('SELECT 1;')).toEqual({ valid: true });
  });

  it('rejects forbidden keywords inside SELECT', () => {
    const result = validateSql('SELECT * FROM users WHERE DELETE = 1');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('DELETE');
  });

  it('is case-insensitive', () => {
    expect(validateSql('select * from users')).toEqual({ valid: true });
    const result = validateSql('drop table users');
    expect(result.valid).toBe(false);
  });

  it('rejects unknown first keyword', () => {
    const result = validateSql('WHATEVER something');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('WHATEVER');
  });
});
