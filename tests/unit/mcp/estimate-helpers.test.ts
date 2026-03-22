/**
 * Unit tests for pure helper functions exported from the estimate and database MCP tools.
 *
 * All three functions under test are stateless pure functions with no I/O or external
 * dependencies, so no mocking is required.  Each describe block covers the full branch
 * space of one function, following Arrange-Act-Assert.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateFamiliarityFactor,
  calculateBaseHours,
  businessHoursBetween,
} from '../../../src/mcp/tools/estimate.js';
import { formatBytes } from '../../../src/mcp/tools/database.js';
import { ESTIMATE_TEST_IDS } from '../../fixtures/shared/test-constants.js';
import type { FamiliarityRow, SimilarTaskMetrics } from '../../../src/mcp/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFamiliarityRow(component: string, resolvedCount: number): FamiliarityRow {
  return { component, resolved_count: resolvedCount, avg_time_hours: 4, last_resolved: '2025-01-01' };
}

const mKey = (n: number) => `${ESTIMATE_TEST_IDS.metricKeyPrefix}-${n}`;

function makeMetric(issueKey: string, hours: number, weight: number): SimilarTaskMetrics {
  return { issueKey, hours, weight };
}

// ─── calculateFamiliarityFactor ───────────────────────────────────────────────

describe('calculateFamiliarityFactor', () => {
  it('returns factor 1.0 when taskComponents is null', () => {
    const rows = [makeFamiliarityRow('Backend', 3)];

    const result = calculateFamiliarityFactor(rows, null);

    expect(result.factor).toBe(1.0);
    expect(result.explanation).toBe('No component data');
  });

  it('returns factor 1.0 when taskComponents is undefined', () => {
    const rows = [makeFamiliarityRow('Backend', 3)];

    const result = calculateFamiliarityFactor(rows, undefined);

    expect(result.factor).toBe(1.0);
    expect(result.explanation).toBe('No component data');
  });

  it('returns factor 1.0 when taskComponents is an empty array', () => {
    const rows = [makeFamiliarityRow('Backend', 3)];

    const result = calculateFamiliarityFactor(rows, []);

    expect(result.factor).toBe(1.0);
    expect(result.explanation).toBe('No component data');
  });

  it('returns factor 1.0 when familiarityRows is empty', () => {
    const result = calculateFamiliarityFactor([], ['Backend']);

    expect(result.factor).toBe(1.0);
    expect(result.explanation).toBe('No component data');
  });

  it('returns factor 1.0 when no row matches any given component', () => {
    const rows = [makeFamiliarityRow('Payments', 5)];

    const result = calculateFamiliarityFactor(rows, ['Backend', 'Frontend']);

    expect(result.factor).toBe(1.0);
    expect(result.explanation).toBe('No history in these components');
  });

  it('applies 0.08 reduction per resolved task — 1 resolved gives factor 0.92', () => {
    const rows = [makeFamiliarityRow('Backend', 1)];

    const result = calculateFamiliarityFactor(rows, ['Backend']);

    expect(result.factor).toBeCloseTo(0.92, 10);
    expect(result.explanation).toContain('0.92');
  });

  it('applies 0.08 reduction per resolved task — 5 resolved gives factor 0.6', () => {
    const rows = [makeFamiliarityRow('Backend', 5)];

    const result = calculateFamiliarityFactor(rows, ['Backend']);

    expect(result.factor).toBeCloseTo(0.6, 10);
    expect(result.explanation).toContain('0.60');
  });

  it('clamps factor at 0.6 minimum when resolved count is very high', () => {
    const rows = [makeFamiliarityRow('Backend', 10)];

    const result = calculateFamiliarityFactor(rows, ['Backend']);

    expect(result.factor).toBe(0.6);
  });

  it('clamps factor at 0.6 minimum when resolved count exceeds the floor threshold', () => {
    const rows = [makeFamiliarityRow('Backend', 20)];

    const result = calculateFamiliarityFactor(rows, ['Backend']);

    expect(result.factor).toBe(0.6);
  });

  it('performs case-insensitive component matching', () => {
    const rows = [makeFamiliarityRow('backend', 1)];

    const result = calculateFamiliarityFactor(rows, ['BACKEND']);

    expect(result.factor).toBeCloseTo(0.92, 10);
  });

  it('performs case-insensitive matching with mixed case in component name', () => {
    const rows = [makeFamiliarityRow('PaymentsAPI', 2)];

    const result = calculateFamiliarityFactor(rows, ['paymentsapi']);

    expect(result.factor).toBeCloseTo(1.0 - 0.08 * 2, 10);
  });

  it('sums resolved_count across all matching components', () => {
    const rows = [
      makeFamiliarityRow('Backend', 2),
      makeFamiliarityRow('Frontend', 3),
    ];

    const result = calculateFamiliarityFactor(rows, ['Backend', 'Frontend']);

    const expectedFactor = Math.max(0.6, 1.0 - 0.08 * 5);
    expect(result.factor).toBeCloseTo(expectedFactor, 10);
    expect(result.explanation).toContain('5');
  });

  it('ignores rows whose component is not in taskComponents when summing', () => {
    const rows = [
      makeFamiliarityRow('Backend', 2),
      makeFamiliarityRow('Payments', 10),
    ];

    const result = calculateFamiliarityFactor(rows, ['Backend']);

    const expectedFactor = Math.max(0.6, 1.0 - 0.08 * 2);
    expect(result.factor).toBeCloseTo(expectedFactor, 10);
  });

  it('includes component names and resolved counts in the explanation string', () => {
    const rows = [makeFamiliarityRow('Backend', 3)];

    const result = calculateFamiliarityFactor(rows, ['Backend']);

    expect(result.explanation).toContain('Backend(3)');
    expect(result.explanation).toContain('3 resolved');
  });
});

// ─── calculateBaseHours ───────────────────────────────────────────────────────

describe('calculateBaseHours', () => {
  it('returns 0 hours and method "no data" when metrics array is empty', () => {
    const result = calculateBaseHours([]);

    expect(result.hours).toBe(0);
    expect(result.method).toBe('no data');
  });

  it('returns the exact hours of the single metric when only one is provided', () => {
    const metrics = [makeMetric(mKey(1), 8, 0.9)];

    const result = calculateBaseHours(metrics);

    expect(result.hours).toBe(8);
  });

  it('does not trim when metrics count is exactly 5', () => {
    const metrics = [
      makeMetric(mKey(1), 4, 0),
      makeMetric(mKey(2), 6, 0),
      makeMetric(mKey(3), 8, 0),
      makeMetric(mKey(4), 10, 0),
      makeMetric(mKey(5), 12, 0),
    ];

    const result = calculateBaseHours(metrics);

    const expectedAvg = (4 + 6 + 8 + 10 + 12) / 5;
    expect(result.hours).toBeCloseTo(expectedAvg, 10);
    expect(result.method).toContain('5/5');
  });

  it('trims 1 element from each end when metrics count is 6', () => {
    const metrics = [
      makeMetric(mKey(1), 1, 0),
      makeMetric(mKey(2), 4, 0),
      makeMetric(mKey(3), 6, 0),
      makeMetric(mKey(4), 8, 0),
      makeMetric(mKey(5), 10, 0),
      makeMetric(mKey(6), 100, 0),
    ];

    const result = calculateBaseHours(metrics);

    const expectedAvg = (4 + 6 + 8 + 10) / 4;
    expect(result.hours).toBeCloseTo(expectedAvg, 10);
    expect(result.method).toContain('4/6');
  });

  it('trims 1 element from each end when metrics count is 10', () => {
    const metrics = Array.from({ length: 10 }, (_, i) =>
      makeMetric(mKey(i + 1), (i + 1) * 2, 0),
    );

    const result = calculateBaseHours(metrics);

    const sorted = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20];
    const trimmed = sorted.slice(1, 9);
    const expectedAvg = trimmed.reduce((s, v) => s + v, 0) / trimmed.length;
    expect(result.hours).toBeCloseTo(expectedAvg, 10);
    expect(result.method).toContain('8/10');
  });

  it('uses simple average when total weight is 0', () => {
    const metrics = [
      makeMetric(mKey(1), 4, 0),
      makeMetric(mKey(2), 8, 0),
      makeMetric(mKey(3), 12, 0),
    ];

    const result = calculateBaseHours(metrics);

    expect(result.hours).toBeCloseTo((4 + 8 + 12) / 3, 10);
    expect(result.method).toContain('simple average');
  });

  it('uses weighted trimmed mean when total weight is greater than 0', () => {
    const metrics = [
      makeMetric(mKey(1), 4, 0.3),
      makeMetric(mKey(2), 8, 0.5),
      makeMetric(mKey(3), 12, 0.2),
    ];

    const result = calculateBaseHours(metrics);

    const totalWeight = 0.3 + 0.5 + 0.2;
    const expected = (4 * 0.3 + 8 * 0.5 + 12 * 0.2) / totalWeight;
    expect(result.hours).toBeCloseTo(expected, 10);
    expect(result.method).toContain('weighted trimmed mean');
  });

  it('includes task count fraction in the method string', () => {
    const metrics = [
      makeMetric(mKey(1), 4, 0),
      makeMetric(mKey(2), 8, 0),
    ];

    const result = calculateBaseHours(metrics);

    expect(result.method).toContain('2/2');
  });

  it('sorts by hours before trimming so outliers at both ends are removed', () => {
    const metrics = [
      makeMetric(mKey(1), 100, 0),
      makeMetric(mKey(2), 8, 0),
      makeMetric(mKey(3), 6, 0),
      makeMetric(mKey(4), 4, 0),
      makeMetric(mKey(5), 0.1, 0),
      makeMetric(mKey(6), 7, 0),
    ];

    const result = calculateBaseHours(metrics);

    const sorted = [0.1, 4, 6, 7, 8, 100];
    const trimmed = sorted.slice(1, 5);
    const expectedAvg = trimmed.reduce((s, v) => s + v, 0) / trimmed.length;
    expect(result.hours).toBeCloseTo(expectedAvg, 10);
  });
});

// ─── businessHoursBetween ─────────────────────────────────────────────────────
//
// NOTE: All dates use T12:00:00 (midday) to avoid timezone-induced date shifts.
// The function normalises to midnight via setHours(0,0,0,0) in local time;
// using midnight UTC is unsafe because UTC+N timezones advance the date by one day.

describe('businessHoursBetween', () => {
  it('returns 8 hours for start and end on the same weekday', () => {
    const monday = new Date('2025-01-13T12:00:00');
    const same = new Date('2025-01-13T12:00:00');

    const result = businessHoursBetween(monday, same);

    expect(result).toBe(8);
  });

  it('returns 0 hours when start and end fall on the same Saturday', () => {
    const saturday = new Date('2025-01-11T12:00:00');
    const same = new Date('2025-01-11T12:00:00');

    const result = businessHoursBetween(saturday, same);

    expect(result).toBe(0);
  });

  it('returns 0 hours when start and end fall on the same Sunday', () => {
    const sunday = new Date('2025-01-12T12:00:00');
    const same = new Date('2025-01-12T12:00:00');

    const result = businessHoursBetween(sunday, same);

    expect(result).toBe(0);
  });

  it('returns 40 hours for a full Mon-to-Fri week', () => {
    const monday = new Date('2025-01-13T12:00:00');
    const friday = new Date('2025-01-17T12:00:00');

    const result = businessHoursBetween(monday, friday);

    expect(result).toBe(40);
  });

  it('returns 16 hours from Friday to Monday (Friday + Monday, skipping Sat and Sun)', () => {
    const friday = new Date('2025-01-10T12:00:00');
    const monday = new Date('2025-01-13T12:00:00');

    const result = businessHoursBetween(friday, monday);

    expect(result).toBe(16);
  });

  it('returns 0 hours for a Saturday-to-Sunday span', () => {
    const saturday = new Date('2025-01-11T12:00:00');
    const sunday = new Date('2025-01-12T12:00:00');

    const result = businessHoursBetween(saturday, sunday);

    expect(result).toBe(0);
  });

  it('returns 40 hours for Mon-to-Sun span (5 business days, weekend skipped)', () => {
    const monday = new Date('2025-01-13T12:00:00');
    const sunday = new Date('2025-01-19T12:00:00');

    const result = businessHoursBetween(monday, sunday);

    expect(result).toBe(40);
  });

  it('returns 16 hours for Mon-to-Tue span', () => {
    const monday = new Date('2025-01-13T12:00:00');
    const tuesday = new Date('2025-01-14T12:00:00');

    const result = businessHoursBetween(monday, tuesday);

    expect(result).toBe(16);
  });

  it('normalises time-of-day so different intra-day times on the same dates give the same result', () => {
    const startEarly = new Date('2025-01-13T08:00:00');
    const endLate = new Date('2025-01-14T20:00:00');

    const startLate = new Date('2025-01-13T18:00:00');
    const endEarly = new Date('2025-01-14T06:00:00');

    expect(businessHoursBetween(startEarly, endLate)).toBe(
      businessHoursBetween(startLate, endEarly),
    );
  });
});

// ─── formatBytes ──────────────────────────────────────────────────────────────

describe('formatBytes', () => {
  it('returns "0B" for 0 bytes', () => {
    expect(formatBytes(0)).toBe('0B');
  });

  it('returns bytes with "B" suffix when value is less than 1 KB', () => {
    expect(formatBytes(512)).toBe('512B');
  });

  it('returns "1KB" for exactly 1024 bytes', () => {
    expect(formatBytes(1024)).toBe('1KB');
  });

  it('rounds to nearest KB when value is between 1 KB and 1 MB', () => {
    expect(formatBytes(1536)).toBe('2KB');
  });

  it('returns "1MB" for exactly 1 MB', () => {
    expect(formatBytes(1024 * 1024)).toBe('1MB');
  });

  it('rounds to nearest MB when value is between 1 MB and 1 GB', () => {
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('2MB');
  });

  it('returns "1GB" for exactly 1 GB', () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1GB');
  });

  it('rounds to nearest GB when value exceeds 1 GB', () => {
    expect(formatBytes(2.7 * 1024 * 1024 * 1024)).toBe('3GB');
  });

  it('returns bytes with "B" suffix for value 1023 (just below 1 KB threshold)', () => {
    expect(formatBytes(1023)).toBe('1023B');
  });
});
