/**
 * Tests for the board skill-discovery module.
 *
 * Verifies that personal and project skill directories are scanned
 * correctly, that SKILL.md description extraction works, and that
 * project-level skills override personal ones with the same name.
 * Node filesystem calls are fully mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({
  readdirSync: vi.fn(),
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/home/testuser'),
}));

import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { discoverSkills } from '../../../../src/adapters/board/skill-discovery.js';

const PERSONAL_SKILLS_DIR = '/home/testuser/.claude/skills';
const PROJECT_DIR = '/workspace/my-project';
const PROJECT_SKILLS_DIR = `${PROJECT_DIR}/.claude/skills`;

function makeSkillMd(description: string): string {
  return `---
description: ${description}
version: 1
---

# Skill content here
`;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(existsSync).mockReturnValue(false);
  vi.mocked(readdirSync).mockReturnValue([]);
});

describe('discoverSkills', () => {
  describe('when no skill directories exist', () => {
    it('returns empty array when both personal and project dirs are absent', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = discoverSkills(PROJECT_DIR);

      expect(result).toEqual([]);
    });

    it('returns empty array when called without project dir', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = discoverSkills();

      expect(result).toEqual([]);
    });
  });

  describe('personal skills', () => {
    it('discovers a single personal skill with description', () => {
      vi.mocked(existsSync).mockImplementation((p) => {
        if (p === PERSONAL_SKILLS_DIR) {return true;}
        if (p === `${PERSONAL_SKILLS_DIR}/code-review/SKILL.md`) {return true;}
        return false;
      });
      vi.mocked(readdirSync).mockImplementation((dir) => {
        if (dir === PERSONAL_SKILLS_DIR) {return ['code-review'] as unknown as ReturnType<typeof readdirSync>;}
        return [] as unknown as ReturnType<typeof readdirSync>;
      });
      vi.mocked(readFileSync).mockReturnValue(makeSkillMd('Automated code review'));

      const result = discoverSkills();

      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('code-review');
      expect(result[0]?.source).toBe('personal');
      expect(result[0]?.description).toBe('Automated code review');
      expect(result[0]?.path).toBe(`${PERSONAL_SKILLS_DIR}/code-review`);
    });

    it('discovers multiple personal skills', () => {
      vi.mocked(existsSync).mockImplementation((p) => {
        if (p === PERSONAL_SKILLS_DIR) {return true;}
        if (String(p).endsWith('SKILL.md')) {return true;}
        return false;
      });
      vi.mocked(readdirSync).mockImplementation((dir) => {
        if (dir === PERSONAL_SKILLS_DIR) {return ['skill-a', 'skill-b'] as unknown as ReturnType<typeof readdirSync>;}
        return [] as unknown as ReturnType<typeof readdirSync>;
      });
      vi.mocked(readFileSync).mockReturnValue(makeSkillMd('A skill'));

      const result = discoverSkills();

      expect(result).toHaveLength(2);
      expect(result.map((s) => s.name)).toEqual(expect.arrayContaining(['skill-a', 'skill-b']));
    });

    it('skips entries in personal dir that have no SKILL.md', () => {
      vi.mocked(existsSync).mockImplementation((p) => {
        if (p === PERSONAL_SKILLS_DIR) {return true;}
        if (p === `${PERSONAL_SKILLS_DIR}/has-skill/SKILL.md`) {return true;}
        if (p === `${PERSONAL_SKILLS_DIR}/no-skill/SKILL.md`) {return false;}
        return false;
      });
      vi.mocked(readdirSync).mockImplementation((dir) => {
        if (dir === PERSONAL_SKILLS_DIR) {return ['has-skill', 'no-skill'] as unknown as ReturnType<typeof readdirSync>;}
        return [] as unknown as ReturnType<typeof readdirSync>;
      });
      vi.mocked(readFileSync).mockReturnValue(makeSkillMd('Has a skill file'));

      const result = discoverSkills();

      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('has-skill');
    });
  });

  describe('project skills', () => {
    it('discovers a single project skill with description', () => {
      vi.mocked(existsSync).mockImplementation((p) => {
        if (p === PROJECT_SKILLS_DIR) {return true;}
        if (p === `${PROJECT_SKILLS_DIR}/deploy/SKILL.md`) {return true;}
        return false;
      });
      vi.mocked(readdirSync).mockImplementation((dir) => {
        if (dir === PROJECT_SKILLS_DIR) {return ['deploy'] as unknown as ReturnType<typeof readdirSync>;}
        return [] as unknown as ReturnType<typeof readdirSync>;
      });
      vi.mocked(readFileSync).mockReturnValue(makeSkillMd('Deployment automation'));

      const result = discoverSkills(PROJECT_DIR);

      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('deploy');
      expect(result[0]?.source).toBe('project');
      expect(result[0]?.path).toBe(`${PROJECT_SKILLS_DIR}/deploy`);
    });

    it('does not scan project dir when projectDir argument is omitted', () => {
      vi.mocked(existsSync).mockImplementation((p) => p === PROJECT_SKILLS_DIR);

      discoverSkills();

      expect(readdirSync).not.toHaveBeenCalledWith(PROJECT_SKILLS_DIR);
    });
  });

  describe('project overrides personal for same skill name', () => {
    it('project skill replaces personal skill when names collide', () => {
      const sharedSkillName = 'code-review';

      vi.mocked(existsSync).mockImplementation((p) => {
        if (p === PERSONAL_SKILLS_DIR) {return true;}
        if (p === PROJECT_SKILLS_DIR) {return true;}
        if (p === `${PERSONAL_SKILLS_DIR}/${sharedSkillName}/SKILL.md`) {return true;}
        if (p === `${PROJECT_SKILLS_DIR}/${sharedSkillName}/SKILL.md`) {return true;}
        return false;
      });
      vi.mocked(readdirSync).mockImplementation((dir) => {
        if (dir === PERSONAL_SKILLS_DIR) {return [sharedSkillName] as unknown as ReturnType<typeof readdirSync>;}
        if (dir === PROJECT_SKILLS_DIR) {return [sharedSkillName] as unknown as ReturnType<typeof readdirSync>;}
        return [] as unknown as ReturnType<typeof readdirSync>;
      });
      vi.mocked(readFileSync)
        .mockReturnValueOnce(makeSkillMd('Personal version'))
        .mockReturnValueOnce(makeSkillMd('Project version'));

      const result = discoverSkills(PROJECT_DIR);

      expect(result).toHaveLength(1);
      expect(result[0]?.source).toBe('project');
      expect(result[0]?.description).toBe('Project version');
    });

    it('merges non-overlapping personal and project skills', () => {
      vi.mocked(existsSync).mockImplementation((p) => {
        if (p === PERSONAL_SKILLS_DIR) {return true;}
        if (p === PROJECT_SKILLS_DIR) {return true;}
        if (p === `${PERSONAL_SKILLS_DIR}/personal-only/SKILL.md`) {return true;}
        if (p === `${PROJECT_SKILLS_DIR}/project-only/SKILL.md`) {return true;}
        return false;
      });
      vi.mocked(readdirSync).mockImplementation((dir) => {
        if (dir === PERSONAL_SKILLS_DIR) {return ['personal-only'] as unknown as ReturnType<typeof readdirSync>;}
        if (dir === PROJECT_SKILLS_DIR) {return ['project-only'] as unknown as ReturnType<typeof readdirSync>;}
        return [] as unknown as ReturnType<typeof readdirSync>;
      });
      vi.mocked(readFileSync).mockReturnValue(makeSkillMd('A skill'));

      const result = discoverSkills(PROJECT_DIR);

      expect(result).toHaveLength(2);
      const sources = result.map((s) => s.source);
      expect(sources).toContain('personal');
      expect(sources).toContain('project');
    });
  });

  describe('description extraction', () => {
    it('returns empty string when SKILL.md has no frontmatter', () => {
      vi.mocked(existsSync).mockImplementation((p) => {
        if (p === PERSONAL_SKILLS_DIR) {return true;}
        if (p === `${PERSONAL_SKILLS_DIR}/bare-skill/SKILL.md`) {return true;}
        return false;
      });
      vi.mocked(readdirSync).mockImplementation((dir) => {
        if (dir === PERSONAL_SKILLS_DIR) {return ['bare-skill'] as unknown as ReturnType<typeof readdirSync>;}
        return [] as unknown as ReturnType<typeof readdirSync>;
      });
      vi.mocked(readFileSync).mockReturnValue('# No frontmatter here\nJust content.');

      const result = discoverSkills();

      expect(result[0]?.description).toBe('');
    });

    it('returns empty string when frontmatter has no description key', () => {
      vi.mocked(existsSync).mockImplementation((p) => {
        if (p === PERSONAL_SKILLS_DIR) {return true;}
        if (p === `${PERSONAL_SKILLS_DIR}/no-desc/SKILL.md`) {return true;}
        return false;
      });
      vi.mocked(readdirSync).mockImplementation((dir) => {
        if (dir === PERSONAL_SKILLS_DIR) {return ['no-desc'] as unknown as ReturnType<typeof readdirSync>;}
        return [] as unknown as ReturnType<typeof readdirSync>;
      });
      vi.mocked(readFileSync).mockReturnValue('---\nversion: 2\n---\n# Skill');

      const result = discoverSkills();

      expect(result[0]?.description).toBe('');
    });

    it('returns empty string when readFileSync throws for SKILL.md', () => {
      vi.mocked(existsSync).mockImplementation((p) => {
        if (p === PERSONAL_SKILLS_DIR) {return true;}
        if (p === `${PERSONAL_SKILLS_DIR}/broken-skill/SKILL.md`) {return true;}
        return false;
      });
      vi.mocked(readdirSync).mockImplementation((dir) => {
        if (dir === PERSONAL_SKILLS_DIR) {return ['broken-skill'] as unknown as ReturnType<typeof readdirSync>;}
        return [] as unknown as ReturnType<typeof readdirSync>;
      });
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const result = discoverSkills();

      expect(result[0]?.description).toBe('');
    });
  });

  describe('error resilience', () => {
    it('returns empty array when readdirSync throws for personal dir', () => {
      vi.mocked(existsSync).mockImplementation((p) => p === PERSONAL_SKILLS_DIR);
      vi.mocked(readdirSync).mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      const result = discoverSkills();

      expect(result).toEqual([]);
    });
  });
});
