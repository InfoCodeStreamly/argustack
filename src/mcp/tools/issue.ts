import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import type {
  FullIssueRow,
  CommentRow,
  ChangelogRow,
  CountRow,
  StatusCountRow,
  TypeCountRow,
  ProjectCountRow,
  AssigneeCountRow,
  CommitRow,
  PrRow,
  TimelineEvent,
} from '../types.js';
import {
  loadWorkspace,
  createAdapters,
  textResponse,
  errorResponse,
  getErrorMessage,
  str,
} from '../helpers.js';
import { groupReviewsByPr, groupFilesByCommit } from './formatters.js';
import type { ReviewRow } from './formatters.js';

export function registerIssueTools(server: McpServer): void {
  server.registerTool(
    'get_issue',
    {
      description: 'Get full details of a specific issue by key — description, comments, changelogs, worklogs, links, all custom fields. Use for deep-dive into a single issue. For cross-source timeline use issue_timeline instead.',
      inputSchema: {
        issue_key: z.string().describe('Issue key (e.g. "PROJ-123")'),
      },
    },
    async ({ issue_key: issueKey }) => {
      const ws = loadWorkspace();
      if (!ws.ok) {
        return errorResponse(`Workspace not found: ${ws.reason}`);
      }

      const { storage } = await createAdapters(ws.root);
      const key = issueKey.toUpperCase();

      try {
        const issueResult = await storage.query(
          `SELECT * FROM issues WHERE issue_key = $1`,
          [key]
        );

        if (issueResult.rows.length === 0) {
          await storage.close();
          return errorResponse(`Issue ${issueKey} not found in local database.`);
        }

        const issue = issueResult.rows[0] as unknown as FullIssueRow;

        const commentsResult = await storage.query(
          `SELECT author, body, created FROM issue_comments WHERE issue_key = $1 ORDER BY created`,
          [key]
        );

        const changelogsResult = await storage.query(
          `SELECT author, field, from_value, to_value, changed_at
           FROM issue_changelogs WHERE issue_key = $1 ORDER BY changed_at DESC LIMIT 20`,
          [key]
        );

        await storage.close();

        const sections: string[] = [];

        sections.push(`# ${str(issue.issue_key)}: ${str(issue.summary)}`);
        sections.push('');
        sections.push(`Type: ${str(issue.issue_type) || 'N/A'} | Status: ${str(issue.status) || 'N/A'} | Priority: ${str(issue.priority) || 'N/A'}`);
        sections.push(`Assignee: ${str(issue.assignee) || 'Unassigned'} | Reporter: ${str(issue.reporter) || 'N/A'}`);
        sections.push(`Created: ${str(issue.created) || 'N/A'} | Updated: ${str(issue.updated) || 'N/A'}`);

        if (Array.isArray(issue.labels) && issue.labels.length > 0) {
          sections.push(`Labels: ${issue.labels.join(', ')}`);
        }
        if (Array.isArray(issue.components) && issue.components.length > 0) {
          sections.push(`Components: ${issue.components.join(', ')}`);
        }
        if (issue.parent_key) {
          sections.push(`Parent: ${issue.parent_key}`);
        }

        sections.push('');
        sections.push('## Description');
        sections.push(str(issue.description) || '(no description)');

        if (issue.custom_fields && Object.keys(issue.custom_fields).length > 0) {
          sections.push('');
          sections.push('## Custom Fields');
          for (const [field, value] of Object.entries(issue.custom_fields)) {
            if (value !== null && value !== undefined) {
              sections.push(`  ${field}: ${typeof value === 'object' ? JSON.stringify(value) : str(value)}`);
            }
          }
        }

        if (commentsResult.rows.length > 0) {
          sections.push('');
          sections.push(`## Comments (${String(commentsResult.rows.length)})`);
          for (const rawComment of commentsResult.rows) {
            const c = rawComment as unknown as CommentRow;
            sections.push(`--- ${str(c.author)} (${str(c.created)}) ---`);
            sections.push(str(c.body) || '(empty)');
            sections.push('');
          }
        }

        if (changelogsResult.rows.length > 0) {
          sections.push('');
          sections.push(`## Recent Changes (${String(changelogsResult.rows.length)})`);
          for (const rawChangelog of changelogsResult.rows) {
            const ch = rawChangelog as unknown as ChangelogRow;
            sections.push(`  ${str(ch.changed_at)}: ${str(ch.author)} changed ${str(ch.field)}: "${str(ch.from_value)}" → "${str(ch.to_value)}"`);
          }
        }

        return textResponse(sections.join('\n'));
      } catch (err: unknown) {
        return errorResponse(`Failed to get issue: ${getErrorMessage(err)}`);
      }
    }
  );

  server.registerTool(
    'issue_stats',
    {
      description: 'Get aggregate statistics about issues — counts by status, type, project, assignee. Use for project health overview, sprint planning, or answering "how many bugs do we have?" Returns grouped counts, not individual issues.',
      inputSchema: {
        project: z.string().optional().describe('Filter stats by project key'),
      },
    },
    async ({ project }) => {
      const ws = loadWorkspace();
      if (!ws.ok) {
        return errorResponse(`Workspace not found: ${ws.reason}`);
      }

      const { storage } = await createAdapters(ws.root);

      try {
        const filterClause = project ? `WHERE project_key = $1` : '';
        const filterParams: unknown[] = project ? [project.toUpperCase()] : [];

        const [total, byStatus, byType, byProject, byAssignee] = await Promise.all([
          storage.query(`SELECT COUNT(*) as count FROM issues ${filterClause}`, filterParams),
          storage.query(`SELECT status, COUNT(*) as count FROM issues ${filterClause} GROUP BY status ORDER BY count DESC`, filterParams),
          storage.query(`SELECT issue_type, COUNT(*) as count FROM issues ${filterClause} GROUP BY issue_type ORDER BY count DESC`, filterParams),
          storage.query(`SELECT project_key, COUNT(*) as count FROM issues ${filterClause} GROUP BY project_key ORDER BY count DESC`, filterParams),
          storage.query(`SELECT assignee, COUNT(*) as count FROM issues ${filterClause} GROUP BY assignee ORDER BY count DESC LIMIT 15`, filterParams),
        ]);

        await storage.close();

        const sections: string[] = [];
        const totalRow = total.rows[0] as unknown as CountRow | undefined;
        sections.push(`# Issue Statistics${project ? ` (${project})` : ''}`);
        sections.push(`Total issues: ${str(totalRow?.count)}`);

        sections.push('');
        sections.push('## By Status');
        for (const rawRow of byStatus.rows) {
          const r = rawRow as unknown as StatusCountRow;
          sections.push(`  ${str(r.status) || 'null'}: ${str(r.count)}`);
        }

        sections.push('');
        sections.push('## By Type');
        for (const rawRow of byType.rows) {
          const r = rawRow as unknown as TypeCountRow;
          sections.push(`  ${str(r.issue_type) || 'null'}: ${str(r.count)}`);
        }

        if (!project) {
          sections.push('');
          sections.push('## By Project');
          for (const rawRow of byProject.rows) {
            const r = rawRow as unknown as ProjectCountRow;
            sections.push(`  ${str(r.project_key)}: ${str(r.count)}`);
          }
        }

        sections.push('');
        sections.push('## Top Assignees');
        for (const rawRow of byAssignee.rows) {
          const r = rawRow as unknown as AssigneeCountRow;
          sections.push(`  ${str(r.assignee) || 'Unassigned'}: ${str(r.count)}`);
        }

        return textResponse(sections.join('\n'));
      } catch (err: unknown) {
        return errorResponse(`Stats query failed: ${getErrorMessage(err)}`);
      }
    }
  );

  server.registerTool(
    'issue_commits',
    {
      description: 'Cross-reference: find all Git commits that mention a Jira issue key in commit message. Shows what code was actually changed. Requires Git sync. For full timeline with PRs use issue_timeline.',
      inputSchema: {
        issue_key: z.string().describe('Issue key (e.g. "PROJ-123")'),
        repo_path: z.string().optional().describe('Filter by repository path (substring match)'),
      },
    },
    async ({ issue_key: issueKey, repo_path: repoPath }) => {
      const ws = loadWorkspace();
      if (!ws.ok) {
        return errorResponse(`Workspace not found: ${ws.reason}`);
      }

      const { storage } = await createAdapters(ws.root);
      const key = issueKey.toUpperCase();

      try {
        const repoFilter = repoPath ? `AND c.repo_path ILIKE $2` : '';
        const commitsParams: unknown[] = [key];
        if (repoPath) {
          commitsParams.push(`%${repoPath}%`);
        }

        const commitsResult = await storage.query(
          `SELECT c.hash, c.message, c.author, c.committed_at, c.repo_path
           FROM commits c
           JOIN commit_issue_refs r ON c.hash = r.commit_hash
           WHERE r.issue_key = $1 ${repoFilter}
           ORDER BY c.committed_at DESC`,
          commitsParams
        );

        if (commitsResult.rows.length === 0) {
          await storage.close();
          return textResponse(`No commits found mentioning ${issueKey}. Make sure you've run "argustack sync git".`);
        }

        const hashes = commitsResult.rows.map((r) => (r as unknown as CommitRow).hash).filter(Boolean) as string[];
        const hashPlaceholders = hashes.map((_, i) => `$${String(i + 1)}`).join(',');
        const filesResult = await storage.query(
          `SELECT commit_hash, file_path, status, additions, deletions
           FROM commit_files WHERE commit_hash IN (${hashPlaceholders})`,
          hashes
        );

        await storage.close();

        const filesByCommit = groupFilesByCommit(filesResult.rows);

        const sections: string[] = [];
        sections.push(`# Commits for ${issueKey} (${String(commitsResult.rows.length)})`);
        sections.push('');

        for (const rawRow of commitsResult.rows) {
          const row = rawRow as unknown as CommitRow;
          const shortHash = (row.hash ?? '').substring(0, 7);

          sections.push(`## ${shortHash} — ${str(row.author)} (${str(row.committed_at).substring(0, 10)})`);
          sections.push(str(row.message));

          const files = filesByCommit.get(row.hash ?? '') ?? [];
          if (files.length > 0) {
            sections.push('Files:');
            for (const file of files) {
              sections.push(`  ${str(file.status)} ${str(file.file_path)} (+${str(file.additions)} -${str(file.deletions)})`);
            }
          }
          sections.push('');
        }

        return textResponse(sections.join('\n'));
      } catch (err: unknown) {
        return errorResponse(`Query failed: ${getErrorMessage(err)}`);
      }
    }
  );

  server.registerTool(
    'issue_prs',
    {
      description: 'Cross-reference: find all GitHub PRs that mention a Jira issue key. Shows which PRs implemented a ticket, with review status and merge info. Requires GitHub sync.',
      inputSchema: {
        issue_key: z.string().describe('Issue key (e.g. "PROJ-123")'),
      },
    },
    async ({ issue_key: issueKey }) => {
      const ws = loadWorkspace();
      if (!ws.ok) {
        return errorResponse(`Workspace not found: ${ws.reason}`);
      }

      const { storage } = await createAdapters(ws.root);
      const key = issueKey.toUpperCase();

      try {
        const prsResult = await storage.query(
          `SELECT p.number, p.title, p.state, p.author, p.created_at, p.merged_at,
                  p.additions, p.deletions, p.base_ref, p.head_ref, p.repo_full_name
           FROM pull_requests p
           JOIN pr_issue_refs r ON p.repo_full_name = r.repo_full_name AND p.number = r.pr_number
           WHERE r.issue_key = $1
           ORDER BY p.created_at DESC`,
          [key]
        );

        if (prsResult.rows.length === 0) {
          await storage.close();
          return textResponse(`No PRs found mentioning ${issueKey}. Make sure GitHub sync is configured.`);
        }

        const prNumbers = prsResult.rows.map((r) => (r as { number: number }).number);
        const repoFullName = (prsResult.rows[0] as { repo_full_name?: string }).repo_full_name;

        const reviewPlaceholders = prNumbers.map((_, i) => `$${String(i + 2)}`).join(',');
        const reviewsResult = await storage.query(
          `SELECT pr_number, reviewer, state, submitted_at FROM pr_reviews
           WHERE repo_full_name = $1 AND pr_number IN (${reviewPlaceholders})
           ORDER BY submitted_at`,
          [repoFullName, ...prNumbers]
        );

        await storage.close();

        const reviewsByPr = groupReviewsByPr(reviewsResult.rows);

        const sections: string[] = [];
        sections.push(`# Pull Requests for ${issueKey} (${String(prsResult.rows.length)})`);
        sections.push('');

        for (const rawRow of prsResult.rows) {
          const pr = rawRow as unknown as PrRow & { head_ref?: string };
          sections.push(`## #${str(pr.number)} — ${str(pr.title)}`);
          sections.push(`State: ${str(pr.state)} | Author: ${str(pr.author)} | ${str(pr.base_ref)} ← ${str(pr.head_ref)}`);
          sections.push(`+${str(pr.additions)} -${str(pr.deletions)} | Created: ${str(pr.created_at ?? '').substring(0, 10)}${pr.merged_at ? ` | Merged: ${str(pr.merged_at).substring(0, 10)}` : ''}`);

          const reviews = reviewsByPr.get(pr.number ?? 0) ?? [];
          if (reviews.length > 0) {
            sections.push('Reviews:');
            for (const r of reviews) {
              sections.push(`  ${str(r.reviewer)}: ${str(r.state)} (${str(r.submitted_at ?? '').substring(0, 10)})`);
            }
          }

          sections.push('');
        }

        return textResponse(sections.join('\n'));
      } catch (err: unknown) {
        return errorResponse(`Query failed: ${getErrorMessage(err)}`);
      }
    }
  );

  server.registerTool(
    'issue_timeline',
    {
      description: 'Full cross-source timeline for a Jira issue: changelog events, Git commits, GitHub PRs with reviews — all in chronological order. Best tool for understanding the complete history of a ticket. Combines data from Jira + Git + GitHub in one call.',
      inputSchema: {
        issue_key: z.string().describe('Issue key (e.g. "PROJ-123")'),
      },
    },
    async ({ issue_key: issueKey }) => {
      const ws = loadWorkspace();
      if (!ws.ok) {
        return errorResponse(`Workspace not found: ${ws.reason}`);
      }

      const { storage } = await createAdapters(ws.root);
      const key = issueKey.toUpperCase();

      try {
        const [issueResult, changelogsResult, commitsResult, prsResult, commitFilesResult] = await Promise.all([
          storage.query(
            `SELECT issue_key, summary, status, issue_type, assignee, reporter, created, updated, resolved FROM issues WHERE issue_key = $1`,
            [key]
          ),
          storage.query(
            `SELECT author, field, from_value, to_value, changed_at FROM issue_changelogs WHERE issue_key = $1 ORDER BY changed_at`,
            [key]
          ),
          storage.query(
            `SELECT c.hash, c.message, c.author, c.email, c.committed_at
             FROM commits c JOIN commit_issue_refs r ON c.hash = r.commit_hash
             WHERE r.issue_key = $1 ORDER BY c.committed_at`,
            [key]
          ),
          storage.query(
            `SELECT p.number, p.title, p.state, p.author, p.created_at, p.merged_at, p.base_ref,
                    p.additions, p.deletions, p.repo_full_name
             FROM pull_requests p JOIN pr_issue_refs r ON p.repo_full_name = r.repo_full_name AND p.number = r.pr_number
             WHERE r.issue_key = $1 ORDER BY p.created_at`,
            [key]
          ),
          storage.query(
            `SELECT cf.commit_hash, cf.file_path, cf.status, cf.additions, cf.deletions
             FROM commit_files cf JOIN commit_issue_refs r ON cf.commit_hash = r.commit_hash
             WHERE r.issue_key = $1`,
            [key]
          ),
        ]);

        if (issueResult.rows.length === 0) {
          await storage.close();
          return textResponse(`Issue ${key} not found.`);
        }

        const issue = issueResult.rows[0] as {
          issue_key: string; summary: string; status?: string; issue_type?: string;
          assignee?: string; reporter?: string; created?: string; updated?: string; resolved?: string;
        };

        const prRows = prsResult.rows as {
          number: number; title?: string; state?: string; author?: string;
          created_at?: string; merged_at?: string; base_ref?: string;
          additions?: number; deletions?: number; repo_full_name?: string;
        }[];

        let reviewsByPr = new Map<number, ReviewRow[]>();
        if (prRows.length > 0) {
          const prNumbers = prRows.map((pr) => pr.number);
          const repoFullName = prRows[0]?.repo_full_name;
          const reviewPlaceholders = prNumbers.map((_, i) => `$${String(i + 2)}`).join(',');
          const reviewsResult = await storage.query(
            `SELECT pr_number, reviewer, state, submitted_at FROM pr_reviews
             WHERE repo_full_name = $1 AND pr_number IN (${reviewPlaceholders})
             ORDER BY submitted_at`,
            [repoFullName, ...prNumbers]
          );
          reviewsByPr = groupReviewsByPr(reviewsResult.rows);
        }

        await storage.close();

        const filesByCommit = groupFilesByCommit(commitFilesResult.rows);

        const events: TimelineEvent[] = [];

        if (issue.created) {
          events.push({ date: str(issue.created), type: 'created', text: 'Issue created' });
        }

        for (const raw of changelogsResult.rows) {
          const ch = raw as ChangelogRow;
          if (ch.changed_at) {
            events.push({
              date: str(ch.changed_at),
              type: 'changelog',
              text: `${str(ch.author)} changed ${str(ch.field)}: "${str(ch.from_value)}" → "${str(ch.to_value)}"`,
            });
          }
        }

        for (const raw of commitsResult.rows) {
          const c = raw as { hash: string; message?: string; author?: string; committed_at?: string };
          if (c.committed_at) {
            const firstLine = (c.message ?? '').split('\n')[0];
            events.push({
              date: str(c.committed_at),
              type: 'commit',
              text: `Commit ${c.hash.substring(0, 7)} — "${firstLine}" (${str(c.author)})`,
            });
          }
        }

        for (const pr of prRows) {
          if (pr.created_at) {
            events.push({
              date: str(pr.created_at),
              type: 'pr_opened',
              text: `PR #${String(pr.number)} opened — "${str(pr.title)}" (${str(pr.author)})`,
            });
          }
          const reviews = reviewsByPr.get(pr.number) ?? [];
          for (const r of reviews) {
            if (r.submitted_at) {
              events.push({
                date: str(r.submitted_at),
                type: 'pr_reviewed',
                text: `PR #${String(pr.number)} reviewed — ${str(r.state)} (${str(r.reviewer)})`,
              });
            }
          }
          if (pr.merged_at) {
            events.push({
              date: str(pr.merged_at),
              type: 'pr_merged',
              text: `PR #${String(pr.number)} merged into ${str(pr.base_ref)}`,
            });
          }
        }

        events.sort((a, b) => a.date.localeCompare(b.date));

        const sections: string[] = [];

        sections.push(`=== ISSUE: ${key} ===`);
        sections.push(`Summary: ${str(issue.summary)}`);
        sections.push(`Status: ${str(issue.status)} | Type: ${str(issue.issue_type)} | Assignee: ${str(issue.assignee)}`);
        sections.push(`Created: ${str(issue.created ?? '').substring(0, 10)} | Resolved: ${str(issue.resolved ?? '').substring(0, 10) || 'n/a'}`);
        sections.push('');

        sections.push(`--- TIMELINE (${String(events.length)} events) ---`);
        for (const ev of events) {
          sections.push(`[${ev.date.substring(0, 10)}] ${ev.text}`);
        }
        sections.push('');

        const commitRows = commitsResult.rows as { hash: string; message?: string; author?: string }[];
        if (commitRows.length > 0) {
          sections.push(`--- COMMITS (${String(commitRows.length)}) ---`);
          for (const c of commitRows) {
            const firstLine = (c.message ?? '').split('\n')[0];
            const files = filesByCommit.get(c.hash) ?? [];
            const adds = files.reduce((s, f) => s + (f.additions ?? 0), 0);
            const dels = files.reduce((s, f) => s + (f.deletions ?? 0), 0);
            sections.push(`${c.hash.substring(0, 7)} — ${firstLine} (+${String(adds)}/-${String(dels)}, ${String(files.length)} files)`);
          }
          sections.push('');
        }

        if (prRows.length > 0) {
          sections.push(`--- PULL REQUESTS (${String(prRows.length)}) ---`);
          for (const pr of prRows) {
            const reviews = reviewsByPr.get(pr.number) ?? [];
            const approvals = reviews.filter((r) => r.state === 'APPROVED').map((r) => str(r.reviewer));
            const reviewInfo = approvals.length > 0 ? ` (${approvals.join(', ')} approved)` : '';
            sections.push(`#${String(pr.number)} — ${str(pr.title)} [${str(pr.state)}]${reviewInfo}`);
          }
          sections.push('');
        }

        return textResponse(sections.join('\n'));
      } catch (err: unknown) {
        return errorResponse(`Query failed: ${getErrorMessage(err)}`);
      }
    }
  );

  server.registerTool(
    'commit_stats',
    {
      description: 'Aggregate statistics about Git commits — total count, top authors, most changed files, commits per day/week. Use for "who is most active?" or "what files change most?" questions. Requires Git sync.',
      inputSchema: {
        since: z.string().optional().describe('Stats from this date (YYYY-MM-DD)'),
        author: z.string().optional().describe('Filter stats by author name'),
        repo_path: z.string().optional().describe('Filter by repository path (substring match)'),
      },
    },
    async ({ since, author, repo_path: repoPath }) => {
      const ws = loadWorkspace();
      if (!ws.ok) {
        return errorResponse(`Workspace not found: ${ws.reason}`);
      }

      const { storage } = await createAdapters(ws.root);

      try {
        const conditions: string[] = [];
        const joinConditions: string[] = [];
        const params: unknown[] = [];
        let paramIdx = 1;

        if (since) {
          conditions.push(`committed_at >= $${String(paramIdx)}`);
          joinConditions.push(`c.committed_at >= $${String(paramIdx)}`);
          params.push(since);
          paramIdx++;
        }
        if (author) {
          conditions.push(`author ILIKE $${String(paramIdx)}`);
          joinConditions.push(`c.author ILIKE $${String(paramIdx)}`);
          params.push(`%${author}%`);
          paramIdx++;
        }
        if (repoPath) {
          conditions.push(`repo_path ILIKE $${String(paramIdx)}`);
          joinConditions.push(`c.repo_path ILIKE $${String(paramIdx)}`);
          params.push(`%${repoPath}%`);
          paramIdx++;
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const joinWhere = joinConditions.length > 0 ? `WHERE ${joinConditions.join(' AND ')}` : '';

        const [total, byAuthor, hotFiles, issueRefCount] = await Promise.all([
          storage.query(`SELECT COUNT(*) as count FROM commits ${where}`, params),
          storage.query(`SELECT author, COUNT(*) as count FROM commits ${where} GROUP BY author ORDER BY count DESC LIMIT 15`, params),
          storage.query(
            `SELECT cf.file_path, COUNT(*) as changes
             FROM commit_files cf
             JOIN commits c ON cf.commit_hash = c.hash
             ${joinWhere}
             GROUP BY cf.file_path ORDER BY changes DESC LIMIT 15`,
            params
          ),
          storage.query(`SELECT COUNT(DISTINCT issue_key) as count FROM commit_issue_refs`, []),
        ]);

        await storage.close();

        const sections: string[] = [];
        const totalRow = total.rows[0] as unknown as CountRow | undefined;
        const refsRow = issueRefCount.rows[0] as unknown as CountRow | undefined;

        sections.push(`# Git Statistics${since ? ` (since ${since})` : ''}${author ? ` (author: ${author})` : ''}`);
        sections.push(`Total commits: ${str(totalRow?.count)}`);
        sections.push(`Linked issue keys: ${str(refsRow?.count)}`);

        sections.push('');
        sections.push('## Top Authors');
        for (const rawRow of byAuthor.rows) {
          const r = rawRow as { author?: string; count?: string };
          sections.push(`  ${str(r.author) || 'unknown'}: ${str(r.count)}`);
        }

        sections.push('');
        sections.push('## Most Changed Files');
        for (const rawRow of hotFiles.rows) {
          const r = rawRow as { file_path?: string; changes?: string };
          sections.push(`  ${str(r.file_path)}: ${str(r.changes)} changes`);
        }

        return textResponse(sections.join('\n'));
      } catch (err: unknown) {
        return errorResponse(`Stats failed: ${getErrorMessage(err)}`);
      }
    }
  );
}
