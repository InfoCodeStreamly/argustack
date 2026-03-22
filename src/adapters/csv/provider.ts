import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { parse } from 'csv-parse';
import type { ISourceProvider } from '../../core/ports/source-provider.js';
import type { IssueBatch, Project } from '../../core/types/index.js';
import { detectSchema } from './parser.js';
import { mapCsvRow } from './mapper.js';

const BATCH_SIZE = 100;

export class CsvProvider implements ISourceProvider {
  readonly name = 'Jira CSV';

  constructor(private readonly filePath: string) {}

  async getProjects(): Promise<Project[]> {
    const projects = new Map<string, string>();

    for await (const batch of this.pullIssues('__all__')) {
      for (const issue of batch.issues) {
        if (!projects.has(issue.projectKey)) {
          projects.set(issue.projectKey, issue.projectKey);
        }
      }
    }

    return Array.from(projects.keys()).map((key) => ({
      key,
      name: key,
    }));
  }

  async getIssueCount(): Promise<number> {
    const content = await stat(this.filePath);
    if (!content.isFile()) {
      return 0;
    }

    let count = 0;
    const stream = createReadStream(this.filePath);
    const parser = stream.pipe(
      parse({ columns: false, relax_column_count: true, skip_empty_lines: true }),
    );

    let isHeader = true;
    for await (const _row of parser) {
      if (isHeader) {
        isHeader = false;
        continue;
      }
      count++;
    }
    return count;
  }

  async *pullIssues(projectKey: string, since?: string): AsyncGenerator<IssueBatch> {
    const stream = createReadStream(this.filePath);
    const parser = stream.pipe(
      parse({ columns: false, relax_column_count: true, skip_empty_lines: true }),
    );

    let headers: string[] | null = null;
    let schema: ReturnType<typeof detectSchema> | undefined;

    let batch: IssueBatch = {
      issues: [],
      comments: [],
      changelogs: [],
      worklogs: [],
      links: [],
    };

    const sinceDate = since ? new Date(since) : null;

    for await (const row of parser) {
      const cells = row as string[];

      if (!headers) {
        headers = cells;
        schema = detectSchema(headers);
        continue;
      }

      if (!schema) {
        continue;
      }

      const result = mapCsvRow(cells, schema);

      if (projectKey !== '__all__' && result.issue.projectKey !== projectKey) {
        continue;
      }

      if (sinceDate && result.issue.updated) {
        const updatedDate = new Date(result.issue.updated);
        if (updatedDate < sinceDate) {
          continue;
        }
      }

      batch.issues.push(result.issue);
      batch.comments.push(...result.comments);
      batch.worklogs.push(...result.worklogs);
      batch.links.push(...result.links);

      if (batch.issues.length >= BATCH_SIZE) {
        yield batch;
        batch = {
          issues: [],
          comments: [],
          changelogs: [],
          worklogs: [],
          links: [],
        };
      }
    }

    if (batch.issues.length > 0) {
      yield batch;
    }
  }
}
