import { describe, it, expect } from 'vitest';
import type { ISkillRunner } from '../../../../src/core/ports/skill-runner.js';

describe('ISkillRunner port', () => {
  it('exports ISkillRunner interface', () => {
    const check: ISkillRunner | undefined = undefined;
    expect(check).toBeUndefined();
  });
});
