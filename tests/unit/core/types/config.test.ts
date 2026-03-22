import { describe, it, expect, beforeAll } from 'vitest';
import type { SourceType } from '../../../../src/core/types/config.js';

type SourceMetaMap = Record<SourceType, { label: string; description: string }>;

const ALL_SOURCE_TYPES: SourceType[] = ['jira', 'git', 'github', 'csv', 'db'];

describe('core/types/config module', () => {
  it('imports without errors', async () => {
    const mod = await import('../../../../src/core/types/config.js');
    expect(mod).toBeDefined();
  });

  it('exports SOURCE_META', async () => {
    const { SOURCE_META } = await import('../../../../src/core/types/config.js');
    expect(SOURCE_META).toBeDefined();
    expect(SOURCE_META.jira).toBeDefined();
  });

  it('exports ALL_SOURCES', async () => {
    const { ALL_SOURCES } = await import('../../../../src/core/types/config.js');
    expect(Array.isArray(ALL_SOURCES)).toBe(true);
    expect(ALL_SOURCES.length).toBeGreaterThan(0);
  });

  describe('SOURCE_META', () => {
    let SOURCE_META: SourceMetaMap;

    beforeAll(async () => {
      ({ SOURCE_META } = await import('../../../../src/core/types/config.js'));
    });

    it('has an entry for every source type', () => {
      for (const type of ALL_SOURCE_TYPES) {
        expect(SOURCE_META[type], `Missing SOURCE_META entry for '${type}'`).toBeDefined();
      }
    });

    it('has exactly the expected set of source type keys', () => {
      const keys = Object.keys(SOURCE_META).sort();
      expect(keys).toEqual([...ALL_SOURCE_TYPES].sort());
    });

    it('every source meta entry has a non-empty label', () => {
      for (const type of ALL_SOURCE_TYPES) {
        const meta = SOURCE_META[type];
        expect(typeof meta.label, `label for '${type}' must be a string`).toBe('string');
        expect(meta.label.length, `label for '${type}' must not be empty`).toBeGreaterThan(0);
      }
    });

    it('every source meta entry has a non-empty description', () => {
      for (const type of ALL_SOURCE_TYPES) {
        const meta = SOURCE_META[type];
        expect(typeof meta.description, `description for '${type}' must be a string`).toBe('string');
        expect(meta.description.length, `description for '${type}' must not be empty`).toBeGreaterThan(0);
      }
    });

    it('jira label is exactly "Jira"', () => {
      expect(SOURCE_META.jira.label).toBe('Jira');
    });

    it('jira description mentions Jira and projects', () => {
      expect(SOURCE_META.jira.description).toContain('Jira');
      expect(SOURCE_META.jira.description.length).toBeGreaterThan(20);
    });

    it('git label contains "Git"', () => {
      expect(SOURCE_META.git.label).toContain('Git');
    });

    it('git description mentions commit history', () => {
      expect(SOURCE_META.git.description.toLowerCase()).toContain('commit');
    });

    it('github label contains "GitHub"', () => {
      expect(SOURCE_META.github.label).toContain('GitHub');
    });

    it('github description mentions pull requests', () => {
      expect(SOURCE_META.github.description.toLowerCase()).toContain('pr');
    });

    it('csv label contains "CSV"', () => {
      expect(SOURCE_META.csv.label).toContain('CSV');
    });

    it('csv description mentions CSV file', () => {
      expect(SOURCE_META.csv.description.toLowerCase()).toContain('csv');
    });

    it('db label contains "Database" or "DB"', () => {
      const label = SOURCE_META.db.label;
      const hasDb = label.includes('Database') || label.includes('DB') || label.includes('database');
      expect(hasDb).toBe(true);
    });

    it('db description mentions database', () => {
      expect(SOURCE_META.db.description.toLowerCase()).toContain('database');
    });

    it('no source meta entry has a label identical to its description', () => {
      for (const type of ALL_SOURCE_TYPES) {
        const meta = SOURCE_META[type];
        expect(meta.label).not.toBe(meta.description);
      }
    });
  });

  describe('ALL_SOURCES', () => {
    let ALL_SOURCES: SourceType[];

    beforeAll(async () => {
      ({ ALL_SOURCES } = await import('../../../../src/core/types/config.js'));
    });

    it('contains exactly 5 source types', () => {
      expect(ALL_SOURCES).toHaveLength(5);
    });

    it('contains "jira"', () => {
      expect(ALL_SOURCES).toContain('jira');
    });

    it('contains "git"', () => {
      expect(ALL_SOURCES).toContain('git');
    });

    it('contains "github"', () => {
      expect(ALL_SOURCES).toContain('github');
    });

    it('contains "csv"', () => {
      expect(ALL_SOURCES).toContain('csv');
    });

    it('contains "db"', () => {
      expect(ALL_SOURCES).toContain('db');
    });

    it('matches exact values in exact order: jira, csv, git, github, db', () => {
      expect(ALL_SOURCES).toEqual(['jira', 'csv', 'git', 'github', 'db']);
    });

    it('contains no duplicate values', () => {
      const unique = new Set(ALL_SOURCES);
      expect(unique.size).toBe(ALL_SOURCES.length);
    });

    it('every value matches a key in SOURCE_META', async () => {
      const { SOURCE_META } = await import('../../../../src/core/types/config.js');
      for (const source of ALL_SOURCES) {
        expect(SOURCE_META[source], `'${source}' in ALL_SOURCES has no entry in SOURCE_META`).toBeDefined();
      }
    });

    it('every SOURCE_META key is in ALL_SOURCES', async () => {
      const { SOURCE_META } = await import('../../../../src/core/types/config.js');
      for (const key of Object.keys(SOURCE_META) as SourceType[]) {
        expect(ALL_SOURCES).toContain(key);
      }
    });

    it('jira comes before csv in ordering', () => {
      expect(ALL_SOURCES.indexOf('jira')).toBeLessThan(ALL_SOURCES.indexOf('csv'));
    });

    it('csv comes before git in ordering', () => {
      expect(ALL_SOURCES.indexOf('csv')).toBeLessThan(ALL_SOURCES.indexOf('git'));
    });

    it('git comes before github in ordering', () => {
      expect(ALL_SOURCES.indexOf('git')).toBeLessThan(ALL_SOURCES.indexOf('github'));
    });

    it('github comes before db in ordering', () => {
      expect(ALL_SOURCES.indexOf('github')).toBeLessThan(ALL_SOURCES.indexOf('db'));
    });
  });
});
