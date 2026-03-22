import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface DiscoveredSkill {
  name: string;
  description: string;
  source: 'project' | 'personal';
  path: string;
}

export function discoverSkills(projectDir?: string): DiscoveredSkill[] {
  const skills = new Map<string, DiscoveredSkill>();

  const personalDir = join(homedir(), '.claude', 'skills');
  if (existsSync(personalDir)) {
    for (const skill of scanSkillsDir(personalDir, 'personal')) {
      skills.set(skill.name, skill);
    }
  }

  if (projectDir) {
    const projectSkillsDir = join(projectDir, '.claude', 'skills');
    if (existsSync(projectSkillsDir)) {
      for (const skill of scanSkillsDir(projectSkillsDir, 'project')) {
        skills.set(skill.name, skill);
      }
    }
  }

  return Array.from(skills.values());
}

function scanSkillsDir(
  dir: string,
  source: 'project' | 'personal',
): DiscoveredSkill[] {
  const results: DiscoveredSkill[] = [];

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    const skillMdPath = join(dir, entry, 'SKILL.md');
    if (!existsSync(skillMdPath)) {
      continue;
    }

    const description = extractSkillDescription(skillMdPath);
    results.push({
      name: entry,
      description,
      source,
      path: join(dir, entry),
    });
  }

  return results;
}

function extractSkillDescription(skillMdPath: string): string {
  try {
    const content = readFileSync(skillMdPath, 'utf-8');
    const fmMatch = /^---\s*\n([\s\S]*?)\n---/.exec(content);
    if (!fmMatch?.[1]) {
      return '';
    }
    const descMatch = /description:\s*["']?(.+?)["']?\s*$/m.exec(fmMatch[1]);
    return descMatch?.[1]?.trim() ?? '';
  } catch {
    return '';
  }
}
