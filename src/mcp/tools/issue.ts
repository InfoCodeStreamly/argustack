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
  workspaceNotFoundResponse,
  getErrorMessage,
  str,
  strOr,
  hasText,
  ANNOTATIONS,
} from '../helpers.js';
import { groupReviewsByPr, groupFilesByCommit } from './formatters.js';
import type { ReviewRow } from './formatters.js';

const workspaceIdParam = z.string().optional().describe('Workspace id or name (defaults to active workspace)');

export function registerIssueTools(server: McpServer): void {
  server.registerTool(
    'get_issue',
    {
      title: 'Get issue details',
      description: 'Get full details of an issue by key — fields, comments, changelog. For full cross-source timeline use issue_timeline.',
      inputSchema: {
        workspace_id: workspaceIdParam,
        issue_key: z.string().describe('Issue key (e.g. "PROJ-123")'),
      },
      annotations: ANNOTATIONS.READ_ONLY,
    },
    async ({ workspace_id: workspaceIdInput, issue_key: issueKey }) => {
      const ws = await loadWorkspace(workspaceIdInput);
      if (!ws.ok) { return workspaceNotFoundResponse(ws.reason); }
      const { storage, workspaceId } = await createAdapters(ws.workspaceId);
      const key = issueKey.toUpperCase();

      try {
        const issueResult = await storage.queryForWorkspace(
          workspaceId,
          `SELECT * FROM issues WHERE workspace_id = $1 AND issue_key = $2`,
          [key],
        );

        if (issueResult.rows.length === 0) {
          return errorResponse(`Issue ${issueKey} not found in workspace ${workspaceId}.`);
        }

        const issue = issueResult.rows[0] as unknown as FullIssueRow;

        const commentsResult = await storage.queryForWorkspace(
          workspaceId,
          `SELECT author, body, created FROM issue_comments WHERE workspace_id = $1 AND issue_key = $2 ORDER BY created`,
          [key],
        );

        const changelogsResult = await storage.queryForWorkspace(
          workspaceId,
          `SELECT author, field, from_value, to_value, changed_at
           FROM issue_changelogs WHERE workspace_id = $1 AND issue_key = $2 ORDER BY changed_at DESC LIMIT 20`,
          [key],
        );

        const sections: string[] = [];
        sections.push(`# ${str(issue.issue_key)}: ${str(issue.summary)}`);
        sections.push('');
        sections.push(`Type: ${strOr(issue.issue_type, 'N/A')} | Status: ${strOr(issue.status, 'N/A')} | Priority: ${strOr(issue.priority, 'N/A')}`);
        sections.push(`Assignee: ${strOr(issue.assignee, 'Unassigned')} | Reporter: ${strOr(issue.reporter, 'N/A')}`);
        sections.push(`Created: ${strOr(issue.created, 'N/A')} | Updated: ${strOr(issue.updated, 'N/A')}`);

        if (Array.isArray(issue.labels) && issue.labels.length > 0) {
          sections.push(`Labels: ${issue.labels.join(', ')}`);
        }
        if (Array.isArray(issue.components) && issue.components.length > 0) {
          sections.push(`Components: ${issue.components.join(', ')}`);
        }
        if (hasText(issue.parent_key)) {
          sections.push(`Parent: ${issue.parent_key}`);
        }

        sections.push('');
        sections.push('## Description');
        sections.push(strOr(issue.description, '(no description)'));

        if (issue.custom_fields !== undefined && Object.keys(issue.custom_fields).length > 0) {
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
          for (const raw of commentsResult.rows) {
            const c = raw as unknown as CommentRow;
            sections.push(`--- ${str(c.author)} (${str(c.created)}) ---`);
            sections.push(strOr(c.body, '(empty)'));
            sections.push('');
          }
        }

        if (changelogsResult.rows.length > 0) {
          sections.push('');
          sections.push(`## Recent Changes (${String(changelogsResult.rows.length)})`);
          for (const raw of changelogsResult.rows) {
            const ch = raw as unknown as ChangelogRow;
            sections.push(`  ${str(ch.changed_at)}: ${str(ch.author)} changed ${str(ch.field)}: "${str(ch.from_value)}" → "${str(ch.to_value)}"`);
          }
        }

        return textResponse(sections.join('\n'));
      } catch (err) {
        return errorResponse(`Failed to get issue: ${getErrorMessage(err)}`);
      }
    },
  );

  server.registerTool(
    'issue_stats',
    {
      title: 'Issue statistics',
      description: 'Aggregate issue statistics for the active workspace — counts by status, type, project, assignee.',
      inputSchema: {
        workspace_id: workspaceIdParam,
        project: z.string().optional().describe('Filter by project key'),
      },
      annotations: ANNOTATIONS.READ_ONLY,
    },
    async ({ workspace_id: workspaceIdInput, project }) => {
      const ws = await loadWorkspace(workspaceIdInput);
      if (!ws.ok) { return workspaceNotFoundResponse(ws.reason); }
      const { storage, workspaceId } = await createAdapters(ws.workspaceId);

      try {
        const projectClause = hasText(project) ? `AND project_key = $2` : '';
        const params: unknown[] = hasText(project) ? [project.toUpperCase()] : [];

        const [total, byStatus, byType, byProject, byAssignee] = await Promise.all([
          storage.queryForWorkspace(workspaceId, `SELECT COUNT(*) as count FROM issues WHERE workspace_id = $1 ${projectClause}`, params),
          storage.queryForWorkspace(workspaceId, `SELECT status, COUNT(*) as count FROM issues WHERE workspace_id = $1 ${projectClause} GROUP BY status ORDER BY count DESC`, params),
          storage.queryForWorkspace(workspaceId, `SELECT issue_type, COUNT(*) as count FROM issues WHERE workspace_id = $1 ${projectClause} GROUP BY issue_type ORDER BY count DESC`, params),
          storage.queryForWorkspace(workspaceId, `SELECT project_key, COUNT(*) as count FROM issues WHERE workspace_id = $1 ${projectClause} GROUP BY project_key ORDER BY count DESC`, params),
          storage.queryForWorkspace(workspaceId, `SELECT assignee, COUNT(*) as count FROM issues WHERE workspace_id = $1 ${projectClause} GROUP BY assignee ORDER BY count DESC LIMIT 15`, params),
        ]);

        const sections: string[] = [];
        const totalRow = total.rows[0] as unknown as CountRow | undefined;
        sections.push(`# Issue Statistics${hasText(project) ? ` (${project})` : ''} — workspace ${workspaceId}`);
        sections.push(`Total issues: ${str(totalRow?.count)}`);

        sections.push('\n## By Status');
        for (const raw of byStatus.rows) {
          const r = raw as unknown as StatusCountRow;
          sections.push(`  ${strOr(r.status, 'null')}: ${str(r.count)}`);
        }
        sections.push('\n## By Type');
        for (const raw of byType.rows) {
          const r = raw as unknown as TypeCountRow;
          sections.push(`  ${strOr(r.issue_type, 'null')}: ${str(r.count)}`);
        }
        if (!hasText(project)) {
          sections.push('\n## By Project');
          for (const raw of byProject.rows) {
            const r = raw as unknown as ProjectCountRow;
            sections.push(`  ${str(r.project_key)}: ${str(r.count)}`);
          }
        }
        sections.push('\n## Top Assignees');
        for (const raw of byAssignee.rows) {
          const r = raw as unknown as AssigneeCountRow;
          sections.push(`  ${strOr(r.assignee, 'Unassigned')}: ${str(r.count)}`);
        }
        return textResponse(sections.join('\n'));
      } catch (err) {
        return errorResponse(`Stats query failed: ${getErrorMessage(err)}`);
      }
    },
  );

  server.registerTool(
    'issue_commits',
    {
      title: 'Commits for an issue',
      description: 'Git commits mentioning the issue key. Requires Git sync.',
      inputSchema: {
        workspace_id: workspaceIdParam,
        issue_key: z.string().describe('Issue key (e.g. "PROJ-123")'),
        repo_path: z.string().optional().describe('Filter by repo path substring'),
      },
      annotations: ANNOTATIONS.READ_ONLY,
    },
    async ({ workspace_id: workspaceIdInput, issue_key: issueKey, repo_path: repoPath }) => {
      const ws = await loadWorkspace(workspaceIdInput);
      if (!ws.ok) { return workspaceNotFoundResponse(ws.reason); }
      const { storage, workspaceId } = await createAdapters(ws.workspaceId);
      const key = issueKey.toUpperCase();

      try {
        const repoFilter = hasText(repoPath) ? `AND c.repo_path ILIKE $3` : '';
        const params: unknown[] = hasText(repoPath) ? [key, `%${repoPath}%`] : [key];

        const commitsResult = await storage.queryForWorkspace(
          workspaceId,
          `SELECT c.hash, c.message, c.author, c.committed_at, c.repo_path
           FROM commits c
           JOIN commit_issue_refs r ON r.workspace_id = c.workspace_id AND r.commit_hash = c.hash
           WHERE c.workspace_id = $1 AND r.issue_key = $2 ${repoFilter}
           ORDER BY c.committed_at DESC`,
          params,
        );

        if (commitsResult.rows.length === 0) {
          return textResponse(`No commits mentioning ${issueKey}. Run "argustack sync git" with this workspace.`);
        }

        const hashes = commitsResult.rows.map((r) => (r as unknown as CommitRow).hash).filter(Boolean) as string[];
        const hashPlaceholders = hashes.map((_, i) => `$${String(i + 2)}`).join(',');
        const filesResult = await storage.queryForWorkspace(
          workspaceId,
          `SELECT commit_hash, file_path, status, additions, deletions
           FROM commit_files WHERE workspace_id = $1 AND commit_hash IN (${hashPlaceholders})`,
          hashes,
        );

        const filesByCommit = groupFilesByCommit(filesResult.rows);
        const sections: string[] = [];
        sections.push(`# Commits for ${issueKey} (${String(commitsResult.rows.length)})`);
        sections.push('');
        for (const raw of commitsResult.rows) {
          const row = raw as unknown as CommitRow;
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
      } catch (err) {
        return errorResponse(`Query failed: ${getErrorMessage(err)}`);
      }
    },
  );

  server.registerTool(
    'issue_prs',
    {
      title: 'PRs for an issue',
      description: 'GitHub PRs mentioning the issue key. Requires GitHub sync.',
      inputSchema: {
        workspace_id: workspaceIdParam,
        issue_key: z.string().describe('Issue key (e.g. "PROJ-123")'),
      },
      annotations: ANNOTATIONS.READ_ONLY,
    },
    async ({ workspace_id: workspaceIdInput, issue_key: issueKey }) => {
      const ws = await loadWorkspace(workspaceIdInput);
      if (!ws.ok) { return workspaceNotFoundResponse(ws.reason); }
      const { storage, workspaceId } = await createAdapters(ws.workspaceId);
      const key = issueKey.toUpperCase();

      try {
        const prsResult = await storage.queryForWorkspace(
          workspaceId,
          `SELECT p.number, p.title, p.state, p.author, p.created_at, p.merged_at,
                  p.additions, p.deletions, p.base_ref, p.head_ref, p.repo_full_name
           FROM pull_requests p
           JOIN pr_issue_refs r ON r.workspace_id = p.workspace_id
             AND r.repo_full_name = p.repo_full_name AND r.pr_number = p.number
           WHERE p.workspace_id = $1 AND r.issue_key = $2
           ORDER BY p.created_at DESC`,
          [key],
        );

        if (prsResult.rows.length === 0) {
          return textResponse(
            `No PRs mentioning ${issueKey}.\n` +
            'If you expected results, run `argustack sync github` to refresh GitHub sync data.',
          );
        }

        const prNumbers = prsResult.rows.map((r) => (r as { number: number }).number);
        const repoFullName = (prsResult.rows[0] as { repo_full_name?: string }).repo_full_name ?? '';
        const reviewPlaceholders = prNumbers.map((_, i) => `$${String(i + 3)}`).join(',');
        const reviewsResult = await storage.queryForWorkspace(
          workspaceId,
          `SELECT pr_number, reviewer, state, submitted_at FROM pr_reviews
           WHERE workspace_id = $1 AND repo_full_name = $2 AND pr_number IN (${reviewPlaceholders})
           ORDER BY submitted_at`,
          [repoFullName, ...prNumbers],
        );

        const reviewsByPr = groupReviewsByPr(reviewsResult.rows);
        const sections: string[] = [];
        sections.push(`# Pull Requests for ${issueKey} (${String(prsResult.rows.length)})`);
        sections.push('');
        for (const raw of prsResult.rows) {
          const pr = raw as unknown as PrRow & { head_ref?: string };
          sections.push(`## #${str(pr.number)} — ${str(pr.title)}`);
          sections.push(`State: ${str(pr.state)} | Author: ${str(pr.author)} | ${str(pr.base_ref)} ← ${str(pr.head_ref)}`);
          sections.push(`+${str(pr.additions)} -${str(pr.deletions)} | Created: ${str(pr.created_at ?? '').substring(0, 10)}${hasText(pr.merged_at) ? ` | Merged: ${str(pr.merged_at).substring(0, 10)}` : ''}`);
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
      } catch (err) {
        return errorResponse(`Query failed: ${getErrorMessage(err)}`);
      }
    },
  );

  server.registerTool(
    'issue_timeline',
    {
      title: 'Cross-source issue timeline',
      description: 'Cross-source timeline for an issue: changelog + commits + PRs in chronological order.',
      inputSchema: {
        workspace_id: workspaceIdParam,
        issue_key: z.string().describe('Issue key (e.g. "PROJ-123")'),
      },
      annotations: ANNOTATIONS.READ_ONLY,
    },
    async ({ workspace_id: workspaceIdInput, issue_key: issueKey }) => {
      const ws = await loadWorkspace(workspaceIdInput);
      if (!ws.ok) { return workspaceNotFoundResponse(ws.reason); }
      const { storage, workspaceId } = await createAdapters(ws.workspaceId);
      const key = issueKey.toUpperCase();

      try {
        const [issueResult, changelogsResult, commitsResult, prsResult, commitFilesResult] = await Promise.all([
          storage.queryForWorkspace(workspaceId,
            `SELECT issue_key, summary, status, issue_type, assignee, reporter, created, updated, resolved
             FROM issues WHERE workspace_id = $1 AND issue_key = $2`,
            [key]),
          storage.queryForWorkspace(workspaceId,
            `SELECT author, field, from_value, to_value, changed_at FROM issue_changelogs
             WHERE workspace_id = $1 AND issue_key = $2 ORDER BY changed_at`,
            [key]),
          storage.queryForWorkspace(workspaceId,
            `SELECT c.hash, c.message, c.author, c.email, c.committed_at
             FROM commits c JOIN commit_issue_refs r ON r.workspace_id = c.workspace_id AND r.commit_hash = c.hash
             WHERE c.workspace_id = $1 AND r.issue_key = $2 ORDER BY c.committed_at`,
            [key]),
          storage.queryForWorkspace(workspaceId,
            `SELECT p.number, p.title, p.state, p.author, p.created_at, p.merged_at, p.base_ref,
                    p.additions, p.deletions, p.repo_full_name
             FROM pull_requests p JOIN pr_issue_refs r ON r.workspace_id = p.workspace_id
               AND r.repo_full_name = p.repo_full_name AND r.pr_number = p.number
             WHERE p.workspace_id = $1 AND r.issue_key = $2 ORDER BY p.created_at`,
            [key]),
          storage.queryForWorkspace(workspaceId,
            `SELECT cf.commit_hash, cf.file_path, cf.status, cf.additions, cf.deletions
             FROM commit_files cf
             JOIN commit_issue_refs r ON r.workspace_id = cf.workspace_id AND r.commit_hash = cf.commit_hash
             WHERE cf.workspace_id = $1 AND r.issue_key = $2`,
            [key]),
        ]);

        if (issueResult.rows.length === 0) {
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
          const repoFullName = prRows[0]?.repo_full_name ?? '';
          const reviewPlaceholders = prNumbers.map((_, i) => `$${String(i + 3)}`).join(',');
          const reviewsResult = await storage.queryForWorkspace(workspaceId,
            `SELECT pr_number, reviewer, state, submitted_at FROM pr_reviews
             WHERE workspace_id = $1 AND repo_full_name = $2 AND pr_number IN (${reviewPlaceholders})
             ORDER BY submitted_at`,
            [repoFullName, ...prNumbers],
          );
          reviewsByPr = groupReviewsByPr(reviewsResult.rows);
        }

        const filesByCommit = groupFilesByCommit(commitFilesResult.rows);
        const events: TimelineEvent[] = [];

        if (hasText(issue.created)) {
          events.push({ date: str(issue.created), type: 'created', text: 'Issue created' });
        }
        for (const raw of changelogsResult.rows) {
          const ch = raw as ChangelogRow;
          if (hasText(ch.changed_at)) {
            events.push({
              date: str(ch.changed_at), type: 'changelog',
              text: `${str(ch.author)} changed ${str(ch.field)}: "${str(ch.from_value)}" → "${str(ch.to_value)}"`,
            });
          }
        }
        for (const raw of commitsResult.rows) {
          const c = raw as { hash: string; message?: string; author?: string; committed_at?: string };
          if (hasText(c.committed_at)) {
            const firstLine = (c.message ?? '').split('\n')[0];
            events.push({
              date: str(c.committed_at), type: 'commit',
              text: `Commit ${c.hash.substring(0, 7)} — "${firstLine}" (${str(c.author)})`,
            });
          }
        }
        for (const pr of prRows) {
          if (hasText(pr.created_at)) {
            events.push({
              date: str(pr.created_at), type: 'pr_opened',
              text: `PR #${String(pr.number)} opened — "${str(pr.title)}" (${str(pr.author)})`,
            });
          }
          const reviews = reviewsByPr.get(pr.number) ?? [];
          for (const r of reviews) {
            if (hasText(r.submitted_at)) {
              events.push({
                date: str(r.submitted_at), type: 'pr_reviewed',
                text: `PR #${String(pr.number)} reviewed — ${str(r.state)} (${str(r.reviewer)})`,
              });
            }
          }
          if (hasText(pr.merged_at)) {
            events.push({
              date: str(pr.merged_at), type: 'pr_merged',
              text: `PR #${String(pr.number)} merged into ${str(pr.base_ref)}`,
            });
          }
        }
        events.sort((a, b) => a.date.localeCompare(b.date));

        const sections: string[] = [];
        sections.push(`=== ISSUE: ${key} ===`);
        sections.push(`Summary: ${str(issue.summary)}`);
        sections.push(`Status: ${str(issue.status)} | Type: ${str(issue.issue_type)} | Assignee: ${str(issue.assignee)}`);
        sections.push(`Created: ${str(issue.created ?? '').substring(0, 10)} | Resolved: ${strOr(str(issue.resolved ?? '').substring(0, 10), 'n/a')}`);
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
      } catch (err) {
        return errorResponse(`Query failed: ${getErrorMessage(err)}`);
      }
    },
  );

  server.registerTool(
    'commit_stats',
    {
      title: 'Git commit statistics',
      description: 'Aggregate Git commit statistics for the active workspace.',
      inputSchema: {
        workspace_id: workspaceIdParam,
        since: z.string().optional(),
        author: z.string().optional(),
        repo_path: z.string().optional(),
      },
      annotations: ANNOTATIONS.READ_ONLY,
    },
    async ({ workspace_id: workspaceIdInput, since, author, repo_path: repoPath }) => {
      const ws = await loadWorkspace(workspaceIdInput);
      if (!ws.ok) { return workspaceNotFoundResponse(ws.reason); }
      const { storage, workspaceId } = await createAdapters(ws.workspaceId);

      try {
        const conditions: string[] = ['workspace_id = $1'];
        const joinConditions: string[] = ['c.workspace_id = $1'];
        const params: unknown[] = [];
        let paramIdx = 2;

        if (hasText(since)) {
          conditions.push(`committed_at >= $${String(paramIdx)}`);
          joinConditions.push(`c.committed_at >= $${String(paramIdx)}`);
          params.push(since); paramIdx++;
        }
        if (hasText(author)) {
          conditions.push(`author ILIKE $${String(paramIdx)}`);
          joinConditions.push(`c.author ILIKE $${String(paramIdx)}`);
          params.push(`%${author}%`); paramIdx++;
        }
        if (hasText(repoPath)) {
          conditions.push(`repo_path ILIKE $${String(paramIdx)}`);
          joinConditions.push(`c.repo_path ILIKE $${String(paramIdx)}`);
          params.push(`%${repoPath}%`); paramIdx++;
        }
        const where = `WHERE ${conditions.join(' AND ')}`;
        const joinWhere = `WHERE ${joinConditions.join(' AND ')}`;

        const [total, byAuthor, hotFiles, issueRefCount] = await Promise.all([
          storage.queryForWorkspace(workspaceId, `SELECT COUNT(*) as count FROM commits ${where}`, params),
          storage.queryForWorkspace(workspaceId, `SELECT author, COUNT(*) as count FROM commits ${where} GROUP BY author ORDER BY count DESC LIMIT 15`, params),
          storage.queryForWorkspace(workspaceId,
            `SELECT cf.file_path, COUNT(*) as changes
             FROM commit_files cf JOIN commits c ON c.workspace_id = cf.workspace_id AND c.hash = cf.commit_hash
             ${joinWhere}
             GROUP BY cf.file_path ORDER BY changes DESC LIMIT 15`,
            params),
          storage.queryForWorkspace(workspaceId,
            `SELECT COUNT(DISTINCT issue_key) as count FROM commit_issue_refs WHERE workspace_id = $1`, []),
        ]);

        const sections: string[] = [];
        const totalRow = total.rows[0] as unknown as CountRow | undefined;
        const refsRow = issueRefCount.rows[0] as unknown as CountRow | undefined;
        sections.push(`# Git Statistics${hasText(since) ? ` (since ${since})` : ''}${hasText(author) ? ` (author: ${author})` : ''} — workspace ${workspaceId}`);
        sections.push(`Total commits: ${str(totalRow?.count)}`);
        sections.push(`Linked issue keys: ${str(refsRow?.count)}`);
        sections.push('\n## Top Authors');
        for (const raw of byAuthor.rows) {
          const r = raw as { author?: string; count?: string };
          sections.push(`  ${strOr(r.author, 'unknown')}: ${str(r.count)}`);
        }
        sections.push('\n## Most Changed Files');
        for (const raw of hotFiles.rows) {
          const r = raw as { file_path?: string; changes?: string };
          sections.push(`  ${str(r.file_path)}: ${str(r.changes)} changes`);
        }
        return textResponse(sections.join('\n'));
      } catch (err) {
        return errorResponse(`Stats failed: ${getErrorMessage(err)}`);
      }
    },
  );
}
