import type { Issue } from '../../../src/core/types/index.js';
import { createIssue } from '../shared/test-constants.js';

export class IssueBuilder {
  private readonly overrides: Partial<Issue> = {};

  withKey(key: string): this {
    this.overrides.key = key;
    return this;
  }

  withId(id: string): this {
    this.overrides.id = id;
    return this;
  }

  withProjectKey(projectKey: string): this {
    this.overrides.projectKey = projectKey;
    return this;
  }

  withSummary(summary: string): this {
    this.overrides.summary = summary;
    return this;
  }

  withDescription(description: string | null): this {
    this.overrides.description = description;
    return this;
  }

  withType(issueType: string): this {
    this.overrides.issueType = issueType;
    return this;
  }

  withStatus(status: string): this {
    this.overrides.status = status;
    return this;
  }

  withStatusCategory(statusCategory: string): this {
    this.overrides.statusCategory = statusCategory;
    return this;
  }

  withPriority(priority: string): this {
    this.overrides.priority = priority;
    return this;
  }

  withResolution(resolution: string | null): this {
    this.overrides.resolution = resolution;
    return this;
  }

  withAssignee(assignee: string | null): this {
    this.overrides.assignee = assignee;
    return this;
  }

  withReporter(reporter: string | null): this {
    this.overrides.reporter = reporter;
    return this;
  }

  withResolved(resolved: string | null): this {
    this.overrides.resolved = resolved;
    return this;
  }

  withLabels(labels: string[]): this {
    this.overrides.labels = labels;
    return this;
  }

  withComponents(components: string[]): this {
    this.overrides.components = components;
    return this;
  }

  withSprint(sprint: string | null): this {
    this.overrides.sprint = sprint;
    return this;
  }

  withStoryPoints(storyPoints: number | null): this {
    this.overrides.storyPoints = storyPoints;
    return this;
  }

  withCustomFields(customFields: Record<string, unknown>): this {
    this.overrides.customFields = customFields;
    return this;
  }

  /** Preset: Done issue (status=Done, statusCategory=Done, resolved) */
  done(): this {
    this.overrides.status = 'Done';
    this.overrides.statusCategory = 'Done';
    this.overrides.resolution = 'Done';
    this.overrides.resolved = '2025-01-20T00:00:00.000+0000';
    return this;
  }

  /** Preset: Bug type */
  bug(): this {
    this.overrides.issueType = 'Bug';
    return this;
  }

  /** Preset: Story type */
  story(): this {
    this.overrides.issueType = 'Story';
    return this;
  }

  /** Preset: High priority */
  highPriority(): this {
    this.overrides.priority = 'High';
    return this;
  }

  /** Preset: Unassigned */
  unassigned(): this {
    this.overrides.assignee = null;
    return this;
  }

  build(): Issue {
    return createIssue(this.overrides);
  }
}
