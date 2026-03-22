const FORBIDDEN_KEYWORDS = new Set([
  'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'TRUNCATE',
  'CREATE', 'GRANT', 'REVOKE', 'EXEC', 'EXECUTE', 'CALL',
  'MERGE', 'UPSERT', 'REPLACE', 'LOCK', 'UNLOCK',
]);

const ALLOWED_FIRST_KEYWORDS = new Set([
  'SELECT', 'EXPLAIN', 'SHOW', 'DESCRIBE', 'DESC', 'WITH',
]);

export interface SqlValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validate that a SQL string is read-only.
 * Only SELECT, EXPLAIN, SHOW, DESCRIBE, and WITH...SELECT are allowed.
 */
export function validateSql(sql: string): SqlValidationResult {
  const trimmed = sql.trim();

  if (!trimmed) {
    return { valid: false, reason: 'Empty query' };
  }

  const upperSql = trimmed.toUpperCase();
  const firstWord = upperSql.split(/[\s(]+/)[0];

  if (!firstWord || !ALLOWED_FIRST_KEYWORDS.has(firstWord)) {
    return { valid: false, reason: `Statement must start with SELECT, EXPLAIN, SHOW, or DESCRIBE. Got: ${firstWord ?? '(empty)'}` };
  }

  if (firstWord === 'WITH') {
    const withoutCtes = upperSql.replace(/WITH\s+[\s\S]*?\)\s*/g, '');
    const afterWith = withoutCtes.trim().split(/[\s(]+/)[0];
    if (afterWith !== 'SELECT') {
      return { valid: false, reason: 'WITH clause must be followed by SELECT' };
    }
  }

  for (const keyword of FORBIDDEN_KEYWORDS) {
    const pattern = new RegExp(`\\b${keyword}\\b`, 'i');
    if (pattern.test(trimmed)) {
      return { valid: false, reason: `Forbidden keyword: ${keyword}` };
    }
  }

  if (/;\s*\S/.test(trimmed)) {
    return { valid: false, reason: 'Multiple statements not allowed' };
  }

  return { valid: true };
}
