import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import type {
  EstimateSimilarRow,
  FamiliarityRow,
  SimilarTaskMetrics,
  EstimateWorklogRow,
  EstimateCommitRow,
  EstimateBugRow,
  EstimateRawRow,
  DevCoefficientRow,
} from '../types.js';
import {
  loadWorkspace,
  createAdapters,
  textResponse,
  errorResponse,
  getErrorMessage,
} from '../helpers.js';

export function calculateFamiliarityFactor(
  familiarityRows: FamiliarityRow[],
  taskComponents: string[] | null | undefined,
): { factor: number; explanation: string } {
  if (!taskComponents || taskComponents.length === 0 || familiarityRows.length === 0) {
    return { factor: 1.0, explanation: 'No component data' };
  }

  const matching = familiarityRows.filter(
    (f) => taskComponents.some((c) => c.toLowerCase() === f.component.toLowerCase()),
  );

  if (matching.length === 0) {
    return { factor: 1.0, explanation: 'No history in these components' };
  }

  const totalResolved = matching.reduce((sum, c) => sum + c.resolved_count, 0);
  const factor = Math.max(0.6, Math.min(1.0, 1.0 - 0.08 * totalResolved));
  const compNames = matching.map((c) => `${c.component}(${String(c.resolved_count)})`).join(', ');

  return { factor, explanation: `${String(totalResolved)} resolved in ${compNames} — ×${factor.toFixed(2)}` };
}

export function calculateBaseHours(metrics: SimilarTaskMetrics[]): { hours: number; method: string } {
  if (metrics.length === 0) {
    return { hours: 0, method: 'no data' };
  }

  const sorted = [...metrics].sort((a, b) => a.hours - b.hours);
  const trimCount = metrics.length > 5 ? Math.max(1, Math.floor(metrics.length * 0.1)) : 0;
  const trimmed = sorted.slice(trimCount, sorted.length - trimCount || undefined);

  const totalWeight = trimmed.reduce((sum, m) => sum + m.weight, 0);
  if (totalWeight === 0) {
    const simple = trimmed.reduce((sum, m) => sum + m.hours, 0) / trimmed.length;
    return { hours: simple, method: `simple average (${String(trimmed.length)}/${String(metrics.length)} tasks)` };
  }

  const weighted = trimmed.reduce((sum, m) => sum + m.hours * m.weight, 0) / totalWeight;
  return { hours: weighted, method: `weighted trimmed mean (${String(trimmed.length)}/${String(metrics.length)} tasks)` };
}

export function businessHoursBetween(start: Date, end: Date): number {
  let hours = 0;
  const current = new Date(start);
  current.setHours(0, 0, 0, 0);
  const endDate = new Date(end);
  endDate.setHours(0, 0, 0, 0);

  while (current <= endDate) {
    const day = current.getDay();
    if (day !== 0 && day !== 6) {
      hours += 8;
    }
    current.setDate(current.getDate() + 1);
  }
  return hours;
}

export function registerEstimateTools(server: McpServer): void {
  server.registerTool(
    'estimate',
    {
      description: 'Estimate task duration for a developer. Returns TWO predictions: (1) "without bugs" = pure dev time, (2) "with bugs" = real cost including bug aftermath. Based on similar completed tasks, developer coefficient, and component familiarity. Requires: description + assignee. Optional: issue_type, components (improve accuracy). If 0 similar tasks found, try broader description or omit components. Present both estimates to the user with the "with bugs" as the realistic one.',
      inputSchema: {
        description: z.string().describe('Description of the new task (e.g. "Stripe payment integration with subscriptions")'),
        assignee: z.string().describe('Developer name to predict for (e.g. "John Smith")'),
        issue_type: z.string().optional().describe('Issue type: Bug, Task, Story — finds same-type analogs and uses type-specific coefficients'),
        components: z.array(z.string()).optional().describe('Component names (e.g. ["Payments", "Export"]) — finds tasks in same area and calculates familiarity'),
        exclude_key: z.string().optional().describe('Issue key to exclude from results (e.g. "PROJ-123") — use when estimating a task that already exists in DB'),
        limit: z.number().optional().describe('Number of similar tasks to analyze (default: 10)'),
      },
    },
    async ({ description, assignee, issue_type: issueTypeInput, components, exclude_key: excludeKey, limit }) => {
      const ws = loadWorkspace();
      if (!ws.ok) {
        return errorResponse(`Workspace not found: ${ws.reason}`);
      }

      const { storage } = await createAdapters(ws.root);
      try {
        const maxResults = limit ?? 10;
        const issueType = issueTypeInput ?? null;
        const comps = components && components.length > 0 ? components : null;

        const similarResult = await storage.query(
          `WITH text_matches AS (
            SELECT issue_key, summary, issue_type, status, assignee, created,
                   COALESCE(resolved, updated) as resolved,
                   parent_key, story_points, components, labels, original_estimate, time_spent,
                   ts_rank(search_vector, plainto_tsquery('english', $1)) as text_rank
            FROM issues
            WHERE search_vector @@ plainto_tsquery('english', $1)
              AND status_category = 'Done'
              AND status != 'Canceled'
              AND ($5::text IS NULL OR issue_key != $5)
          ),
          scored AS (
            SELECT *,
              CASE WHEN $3::text IS NOT NULL AND issue_type = $3 THEN 1.0 ELSE 0.0 END as type_match,
              CASE WHEN $4::text[] IS NOT NULL AND array_length($4::text[], 1) > 0
                THEN COALESCE((
                  SELECT COUNT(*)::float / array_length($4::text[], 1)
                  FROM unnest($4::text[]) q_comp
                  WHERE q_comp = ANY(components)
                ), 0)
                ELSE 0.0
              END as component_overlap,
              1.0 / (1.0 + EXTRACT(EPOCH FROM (NOW() - resolved)) / (86400.0 * 365)) as temporal_weight,
              (
                LEAST(text_rank * 10, 1.0) * 0.3
                + CASE WHEN $3::text IS NOT NULL AND issue_type = $3 THEN 0.25 ELSE 0.0 END
                + CASE WHEN $4::text[] IS NOT NULL AND array_length($4::text[], 1) > 0
                    THEN COALESCE((
                      SELECT COUNT(*)::float / array_length($4::text[], 1)
                      FROM unnest($4::text[]) q_comp
                      WHERE q_comp = ANY(components)
                    ), 0) * 0.35
                    ELSE 0.0
                  END
                + (1.0 / (1.0 + EXTRACT(EPOCH FROM (NOW() - resolved)) / (86400.0 * 365))) * 0.1
              ) as composite_score
            FROM text_matches
          )
          SELECT *, composite_score as rank
          FROM scored
          ORDER BY composite_score DESC
          LIMIT $2`,
          [description, maxResults, issueType, comps, excludeKey ?? null],
        );

        const similar = [...similarResult.rows] as unknown as EstimateSimilarRow[];

        if (similar.length === 0) {
          const fallbackResult = await storage.query(
            `SELECT issue_key, summary, issue_type, status, assignee,
                    created, resolved, components,
                    0.0 as composite_score, 0 as type_match, 0.0 as component_overlap,
                    0.5 as temporal_weight, 0.0 as text_rank
             FROM issues
             WHERE resolved IS NOT NULL
               AND ($1::text IS NULL OR issue_key != $1)
             ORDER BY resolved DESC
             LIMIT $2`,
            [excludeKey ?? null, maxResults],
          );
          const fallbackRows = fallbackResult.rows as unknown as EstimateSimilarRow[];
          if (fallbackRows.length === 0) {
            await storage.close();
            return textResponse(`No completed tasks found for estimation.\n\nTry syncing more data: argustack sync jira`);
          }
          similar.push(...fallbackRows);
        }

        const usedFallback = similarResult.rows.length === 0 && similar.length > 0;
        const issueKeys = similar.map((r) => r.issue_key);
        const keysParam = issueKeys.map((_, i) => `$${String(i + 1)}`).join(',');

        const worklogsResult = await storage.query(
          `SELECT issue_key, author, SUM(time_spent_seconds) as total_seconds
           FROM issue_worklogs
           WHERE issue_key IN (${keysParam})
           GROUP BY issue_key, author`,
          issueKeys,
        );
        const worklogs = worklogsResult.rows as unknown as EstimateWorklogRow[];

        const devChangelogResult = await storage.query(
          `SELECT DISTINCT ON (issue_key) issue_key, to_value as dev_assignee
           FROM issue_changelogs
           WHERE issue_key IN (${keysParam})
             AND field = 'assignee'
             AND to_value IS NOT NULL
             AND to_value != ''
           ORDER BY issue_key, changed_at`,
          issueKeys,
        );
        const devChangelogs = devChangelogResult.rows as unknown as { issue_key: string; dev_assignee: string }[];
        const realDevMap = new Map<string, string>();
        for (const d of devChangelogs) {
          realDevMap.set(d.issue_key, d.dev_assignee);
        }

        const commitsResult = await storage.query(
          `SELECT r.issue_key,
                  COUNT(*) as commits,
                  STRING_AGG(DISTINCT c.author, ', ') as authors,
                  SUM(cf_agg.additions) as total_additions,
                  SUM(cf_agg.deletions) as total_deletions,
                  MIN(c.committed_at) as first_commit,
                  MAX(c.committed_at) as last_commit
           FROM commit_issue_refs r
           JOIN commits c ON r.commit_hash = c.hash
           LEFT JOIN (
             SELECT commit_hash, SUM(additions) as additions, SUM(deletions) as deletions
             FROM commit_files GROUP BY commit_hash
           ) cf_agg ON c.hash = cf_agg.commit_hash
           WHERE r.issue_key IN (${keysParam})
           GROUP BY r.issue_key`,
          issueKeys,
        );
        const commitData = commitsResult.rows as unknown as EstimateCommitRow[];

        const notInParam = issueKeys.map((_, i) => `$${String(i + 1 + issueKeys.length)}`).join(',');
        const childrenResult = await storage.query(
          `SELECT i.parent_key as related_to, i.issue_key as bug_key, i.summary, i.issue_type, i.resolved, i.created, i.time_spent as bug_time_spent
           FROM issues i
           WHERE i.parent_key IN (${keysParam})
             AND i.issue_key NOT IN (${notInParam})`,
          [...issueKeys, ...issueKeys],
        );
        const linkedResult = await storage.query(
          `SELECT il.source_key as related_to, i.issue_key as bug_key, i.summary, i.issue_type, i.resolved, i.created, i.time_spent as bug_time_spent
           FROM issue_links il
           JOIN issues i ON i.issue_key = il.target_key
           WHERE il.source_key IN (${keysParam})
             AND i.issue_key NOT IN (${notInParam})`,
          [...issueKeys, ...issueKeys],
        );
        const bugs = [
          ...(childrenResult.rows as unknown as (EstimateBugRow & { related_to: string; issue_type: string })[]),
          ...(linkedResult.rows as unknown as (EstimateBugRow & { related_to: string; issue_type: string })[]),
        ];

        const rawEstimates = await storage.query(
          `SELECT issue_key, original_estimate, time_spent
           FROM issues
           WHERE issue_key IN (${keysParam})`,
          issueKeys,
        );
        const estimates = rawEstimates.rows as unknown as EstimateRawRow[];

        let familiarity: { factor: number; explanation: string } = { factor: 1.0, explanation: 'No component data' };
        if (assignee && comps) {
          const familiarityResult = await storage.query(
            `SELECT
               unnest(components) as component,
               COUNT(DISTINCT issue_key) as resolved_count,
               AVG(time_spent::float / 3600) as avg_time_hours,
               MAX(resolved)::text as last_resolved
             FROM issues
             WHERE assignee ILIKE $1
               AND status_category = 'Done'
               AND time_spent IS NOT NULL AND time_spent > 0
               AND components IS NOT NULL AND array_length(components, 1) > 0
             GROUP BY unnest(components)
             ORDER BY resolved_count DESC`,
            [`%${assignee}%`],
          );
          const familiarityRows = familiarityResult.rows as unknown as FamiliarityRow[];
          familiarity = calculateFamiliarityFactor(familiarityRows, comps);
        }

        const coefficientResult = await storage.query(
          `WITH base AS (
            SELECT
              parent.assignee,
              parent.issue_type,
              parent.issue_key,
              parent.original_estimate,
              parent.time_spent,
              COALESCE(bug_agg.bug_time, 0) as bug_time
            FROM issues parent
            LEFT JOIN (
              SELECT parent_ref, SUM(bug_ts) as bug_time
              FROM (
                SELECT i.parent_key as parent_ref, i.time_spent as bug_ts
                FROM issues i
                WHERE i.issue_type IN ('Bug', 'Sub-bug')
                  AND i.time_spent IS NOT NULL AND i.time_spent > 0
                UNION ALL
                SELECT il.source_key as parent_ref, i.time_spent as bug_ts
                FROM issue_links il
                JOIN issues i ON i.issue_key = il.target_key
                WHERE i.issue_type IN ('Bug', 'Sub-bug')
                  AND i.time_spent IS NOT NULL AND i.time_spent > 0
              ) bugs
              GROUP BY parent_ref
            ) bug_agg ON bug_agg.parent_ref = parent.issue_key
            WHERE parent.status_category = 'Done'
              AND parent.original_estimate IS NOT NULL AND parent.original_estimate > 0
              AND parent.time_spent IS NOT NULL AND parent.time_spent > 0
              AND parent.issue_type NOT IN ('Bug', 'Sub-bug')
              AND CAST(parent.time_spent AS FLOAT) / parent.original_estimate < 5.0
          ),
          context_coeffs AS (
            SELECT
              assignee,
              COUNT(DISTINCT issue_key)::text as task_count,
              PERCENTILE_CONT(0.5) WITHIN GROUP (
                ORDER BY CAST(time_spent AS FLOAT) / original_estimate
              ) as coeff_no_bugs,
              PERCENTILE_CONT(0.5) WITHIN GROUP (
                ORDER BY CAST(time_spent + bug_time AS FLOAT) / original_estimate
              ) as coeff_with_bugs,
              AVG(CAST(bug_time AS FLOAT) / NULLIF(time_spent, 0)) as bug_ratio,
              COALESCE($1, 'all types') as context_label
            FROM base
            WHERE ($1::text IS NULL OR issue_type = $1)
            GROUP BY assignee
            HAVING COUNT(DISTINCT issue_key) >= 3
          ),
          global_coeffs AS (
            SELECT
              assignee,
              COUNT(DISTINCT issue_key)::text as task_count,
              PERCENTILE_CONT(0.5) WITHIN GROUP (
                ORDER BY CAST(time_spent AS FLOAT) / original_estimate
              ) as coeff_no_bugs,
              PERCENTILE_CONT(0.5) WITHIN GROUP (
                ORDER BY CAST(time_spent + bug_time AS FLOAT) / original_estimate
              ) as coeff_with_bugs,
              AVG(CAST(bug_time AS FLOAT) / NULLIF(time_spent, 0)) as bug_ratio,
              'all types (fallback)' as context_label
            FROM base
            GROUP BY assignee
            HAVING COUNT(DISTINCT issue_key) >= 3
          )
          SELECT * FROM context_coeffs
          UNION ALL
          SELECT * FROM global_coeffs
          WHERE assignee NOT IN (SELECT assignee FROM context_coeffs)`,
          [issueType],
        );
        const coefficients = coefficientResult.rows as unknown as DevCoefficientRow[];

        await storage.close();

        const sections: string[] = [];
        sections.push(`# Estimate Prediction`);
        const metaParts = [assignee ? `Developer: ${assignee}` : '', issueType ? `Type: ${issueType}` : '', comps ? `Components: ${comps.join(', ')}` : ''].filter(Boolean);
        sections.push(`Query: "${description}"${metaParts.length > 0 ? ` | ${metaParts.join(' | ')}` : ''}`);
        sections.push(`Based on ${String(similar.length)} similar completed tasks`);
        sections.push(`Scoring: text 30% + type ${issueType ? '25%' : '0%'} + component ${comps ? '35%' : '0%'} + recency 10%\n`);
        if (usedFallback) {
          sections.push('> Note: No similar tasks found by description. Using project-wide statistics for same issue type.\n');
        }

        const worklogMap = new Map<string, EstimateWorklogRow[]>();
        for (const w of worklogs) {
          const arr = worklogMap.get(w.issue_key) ?? [];
          arr.push(w);
          worklogMap.set(w.issue_key, arr);
        }

        const commitMap = new Map<string, EstimateCommitRow>();
        for (const c of commitData) {
          commitMap.set(c.issue_key, c);
        }

        const estimateMap = new Map<string, EstimateRawRow>();
        for (const e of estimates) {
          estimateMap.set(e.issue_key, e);
        }

        const bugMap = new Map<string, (EstimateBugRow & { related_to: string; issue_type: string })[]>();
        for (const b of bugs) {
          const arr = bugMap.get(b.related_to) ?? [];
          arr.push(b);
          bugMap.set(b.related_to, arr);
        }

        sections.push('## Similar Tasks\n');

        let totalCycleHours = 0;
        let totalCodingHours = 0;
        let totalBugs = 0;
        let validCycleCount = 0;
        let validCodingCount = 0;
        const developerStats = new Map<string, { tasks: number; cycleHours: number; codingHours: number; bugs: number; commits: number }>();

        for (const issue of similar) {
          const cycleHours = issue.resolved
            ? (new Date(issue.resolved).getTime() - new Date(issue.created).getTime()) / 3600000
            : null;

          if (cycleHours !== null) {
            totalCycleHours += cycleHours;
            validCycleCount++;
          }

          const issueWorklogs = worklogMap.get(issue.issue_key) ?? [];
          const issueCommits = commitMap.get(issue.issue_key);
          const issueBugs = bugMap.get(issue.issue_key) ?? [];
          const issueEstimate = estimateMap.get(issue.issue_key);

          const codingHours = (issueCommits?.first_commit && issueCommits.last_commit)
            ? (new Date(issueCommits.last_commit).getTime() - new Date(issueCommits.first_commit).getTime()) / 3600000
            : null;

          if (codingHours !== null && codingHours > 0) {
            totalCodingHours += codingHours;
            validCodingCount++;
          }

          totalBugs += issueBugs.length;

          const realDev = realDevMap.get(issue.issue_key);
          const devName = realDev ?? (issueWorklogs.length > 0 ? issueWorklogs[0]?.author : null) ?? issueCommits?.authors ?? issue.assignee ?? 'unknown';
          if (devName) {
            const stats = developerStats.get(devName) ?? { tasks: 0, cycleHours: 0, codingHours: 0, bugs: 0, commits: 0 };
            stats.tasks++;
            stats.cycleHours += cycleHours ?? 0;
            stats.codingHours += codingHours ?? 0;
            stats.bugs += issueBugs.length;
            stats.commits += Number(issueCommits?.commits ?? 0);
            developerStats.set(devName, stats);
          }

          const estH = issueEstimate?.original_estimate ? Number(issueEstimate.original_estimate) / 3600 : null;
          const actualH = issueEstimate?.time_spent ? Number(issueEstimate.time_spent) / 3600 : null;
          const bugTimeH = issueBugs
            .filter((b) => b.bug_time_spent !== null)
            .reduce((sum, b) => sum + (b.bug_time_spent ?? 0), 0) / 3600;
          const realCostH = (actualH ?? 0) + bugTimeH;
          const taskCoeff = estH && estH > 0 && actualH ? actualH / estH : null;
          const taskCoeffBugs = estH && estH > 0 ? realCostH / estH : null;

          const cycleBizDays = issue.resolved ? businessHoursBetween(new Date(issue.created), new Date(issue.resolved)) / 8 : null;
          const cycleStr = cycleBizDays !== null ? `${cycleBizDays.toFixed(0)}d cycle` : 'open';
          const codingStr = codingHours !== null && codingHours > 0 ? ` | ${codingHours.toFixed(1)}h coding` : '';

          const scoreStr = `score: ${Number(issue.composite_score).toFixed(2)}`;
          const matchParts = [issue.type_match > 0 ? 'type' : '', issue.component_overlap > 0 ? `comp:${(issue.component_overlap * 100).toFixed(0)}%` : ''].filter(Boolean);
          const matchStr = matchParts.length > 0 ? ` [${matchParts.join(', ')}]` : '';

          sections.push(`### ${issue.issue_key}: ${issue.summary}`);
          sections.push(`Type: ${issue.issue_type} | Dev: ${devName} | ${cycleStr}${codingStr} | ${scoreStr}${matchStr}`);
          if (estH !== null || actualH !== null) {
            const estStr = estH !== null ? `${Math.round(estH)}h est` : '';
            const actStr = actualH !== null ? `${Math.round(actualH)}h actual` : '';
            const coeffStr = taskCoeff !== null ? ` (×${taskCoeff.toFixed(2)})` : '';
            sections.push(`Estimate: ${[estStr, actStr].filter(Boolean).join(' → ')}${coeffStr}`);
          }
          if (bugTimeH > 0) {
            sections.push(`Bug aftermath: ${bugTimeH.toFixed(1)}h → real cost: ${realCostH.toFixed(1)}h (×${taskCoeffBugs?.toFixed(2) ?? '?'})`);
          }
          if (issueCommits) {
            sections.push(`Code: ${issueCommits.commits} commits, +${issueCommits.total_additions}/-${issueCommits.total_deletions} lines (${issueCommits.authors})`);
          }
          if (issueWorklogs.length > 0) {
            const wlLines = issueWorklogs.map((w) => `  ${w.author}: ${(Number(w.total_seconds) / 3600).toFixed(1)}h`);
            sections.push(`Worklogs:\n${wlLines.join('\n')}`);
          }
          if (issueBugs.length > 0) {
            const bugLines = issueBugs.map((b) => {
              const bTimeStr = b.bug_time_spent ? ` [${(b.bug_time_spent / 3600).toFixed(1)}h]` : '';
              return `  ${b.bug_key} [${b.issue_type}]${bTimeStr} ${b.summary}`;
            });
            sections.push(`Related issues (${String(issueBugs.length)}):\n${bugLines.join('\n')}`);
          }
          sections.push('');
        }

        const taskMetrics: SimilarTaskMetrics[] = [];
        for (const issue of similar) {
          const issueWorklogs = worklogMap.get(issue.issue_key) ?? [];
          const issueCommits = commitMap.get(issue.issue_key);
          const issueEstimate = estimateMap.get(issue.issue_key);

          const codingHours = (issueCommits?.first_commit && issueCommits.last_commit)
            ? (new Date(issueCommits.last_commit).getTime() - new Date(issueCommits.first_commit).getTime()) / 3600000
            : null;
          const worklogHours = issueWorklogs.reduce((sum, w) => sum + Number(w.total_seconds), 0) / 3600;
          const actualH = issueEstimate?.time_spent ? Number(issueEstimate.time_spent) / 3600 : null;
          const estimateH = issueEstimate?.original_estimate ? Number(issueEstimate.original_estimate) / 3600 : null;
          const cycleBusinessH = issue.resolved
            ? businessHoursBetween(new Date(issue.created), new Date(issue.resolved))
            : null;
          const hours = actualH ?? (worklogHours > 0 ? worklogHours : null) ?? (codingHours && codingHours > 0 ? codingHours : null) ?? estimateH ?? (cycleBusinessH && cycleBusinessH > 0 ? cycleBusinessH : null);
          const isCycleFallback = hours !== null && hours === cycleBusinessH && actualH === null && !(worklogHours > 0) && !(codingHours && codingHours > 0) && estimateH === null;
          if (hours !== null && hours > 0) {
            taskMetrics.push({ issueKey: issue.issue_key, hours, weight: Number(issue.temporal_weight), isCycleFallback });
          }
        }

        const base = calculateBaseHours(taskMetrics);

        sections.push('## Similar Tasks Summary\n');

        const avgCycle = validCycleCount > 0 ? totalCycleHours / validCycleCount : 0;
        const avgCoding = validCodingCount > 0 ? totalCodingHours / validCodingCount : 0;
        const avgBugs = similar.length > 0 ? totalBugs / similar.length : 0;

        const allCycleFallback = taskMetrics.length > 0 && taskMetrics.every((m) => m.isCycleFallback);

        if (!allCycleFallback) {
          sections.push(`Base hours: ${base.hours.toFixed(1)}h (${base.method})`);
          if (avgCoding > 0 && avgCycle > 0) {
            sections.push(`Cycle time: ${avgCycle.toFixed(1)}h — coding was ${((avgCoding / avgCycle) * 100).toFixed(0)}% of it`);
          }
        }
        sections.push(`Bug rate: ${avgBugs.toFixed(1)} bugs per task`);

        if (!allCycleFallback && developerStats.size > 0) {
          sections.push('\n## Developer Profiles (similar tasks)\n');
          for (const [dev, stats] of developerStats) {
            if (assignee && !dev.toLowerCase().includes(assignee.toLowerCase())) {
              continue;
            }
            const avgDevCoding = stats.tasks > 0 ? stats.codingHours / stats.tasks : 0;
            const avgDevCycle = stats.tasks > 0 ? stats.cycleHours / stats.tasks : 0;
            const devBestHours = avgDevCoding > 0 ? avgDevCoding : avgDevCycle;
            const bugRate = stats.tasks > 0 ? stats.bugs / stats.tasks : 0;
            sections.push(`**${dev}**: ${String(stats.tasks)} similar tasks, avg ${devBestHours.toFixed(1)}h (${(devBestHours / 8).toFixed(1)}d), ${bugRate.toFixed(1)} bugs/task, ${String(stats.commits)} commits`);
          }
        }

        if (!allCycleFallback && familiarity.factor < 1.0) {
          sections.push(`\n## Developer Familiarity\n`);
          sections.push(`${assignee}: ${familiarity.explanation}`);
        }

        if (!allCycleFallback && coefficients.length > 0) {
          sections.push('\n## Developer Coefficients\n');
          const relevantCoeffs = assignee
            ? coefficients.filter((c) => c.assignee.toLowerCase().includes(assignee.toLowerCase()))
            : coefficients;
          for (const c of relevantCoeffs) {
            const noBugs = Number(c.coeff_no_bugs).toFixed(2);
            const withBugs = Number(c.coeff_with_bugs).toFixed(2);
            const ratio = (Number(c.bug_ratio) * 100).toFixed(0);
            sections.push(`**${c.assignee}**: ×${noBugs} without bugs, ×${withBugs} with bugs (${c.task_count} tasks, bug overhead ${ratio}%, ${c.context_label}, median, outliers excluded)`);
          }
        }

        const baseHours = base.hours;

        if (allCycleFallback) {
          const cycleDays = taskMetrics.map((m) => m.hours / 8);
          const minDays = Math.min(...cycleDays).toFixed(0);
          const maxDays = Math.max(...cycleDays).toFixed(0);
          const rangeStr = minDays === maxDays ? minDays : `${minDays}–${maxDays}`;

          sections.push('\n## Resolution Timeline (cycle time only)\n');
          sections.push(`Similar tasks were closed in **${rangeStr} business days** from creation.`);
          sections.push(`This is lead time (backlog wait + development + code review), NOT active development time.`);
          sections.push(`\n⚠ No effort tracking data available (time_spent, worklogs, commit history).`);
          sections.push(`Connect **Jira API** or **Git** for actual work hours and per-developer predictions.`);
        } else if (baseHours === 0) {
          sections.push('\n## Prediction\n');
          sections.push('**No data available for prediction.**\n');
          sections.push('Similar tasks have no effort data and no resolved dates.');
          sections.push('Need at least one of: time_spent, worklogs, commit history, estimates, or resolved date.');
        } else {
          sections.push('\n## Prediction\n');
          const contextCoeffs = coefficients.filter((c) => c.context_label !== 'all types (fallback)');
          const globalCoeffs = coefficients.filter((c) => c.context_label === 'all types (fallback)');

          const buildDevPrediction = (dev: DevCoefficientRow): string[] => {
            const noBugs = Number(dev.coeff_no_bugs);
            const withBugs = Number(dev.coeff_with_bugs);
            const overhead = noBugs > 0 ? ((withBugs - noBugs) / noBugs * 100).toFixed(0) : '0';
            const predNoBugs = baseHours * noBugs;
            const predWithBugs = baseHours * withBugs;
            const lines: string[] = [];
            lines.push(`### ${dev.assignee}`);
            lines.push(`Without bugs: ${baseHours.toFixed(1)}h ×${noBugs.toFixed(2)} = **${predNoBugs.toFixed(1)}h** (${(predNoBugs / 8).toFixed(1)}d)`);
            lines.push(`With bugs: ${baseHours.toFixed(1)}h ×${withBugs.toFixed(2)} = **${predWithBugs.toFixed(1)}h** (${(predWithBugs / 8).toFixed(1)}d) — bug overhead +${overhead}%`);
            lines.push(`Based on ${dev.task_count} completed tasks, ${dev.context_label}\n`);
            return lines;
          };

          const devCtx = contextCoeffs.find((c) => c.assignee.toLowerCase().includes(assignee.toLowerCase()));
          const devGlob = globalCoeffs.find((c) => c.assignee.toLowerCase().includes(assignee.toLowerCase()));
          const dev = devCtx ?? devGlob;
          if (dev) {
            sections.push(...buildDevPrediction(dev));
          } else {
            sections.push(`No coefficient data for "${assignee}". Need ≥3 completed tasks.`);
            sections.push(`**${baseHours.toFixed(1)}h** based on similar tasks (no personal coefficient)\n`);
          }

          if (avgBugs > 0.5) {
            sections.push(`High bug rate (${avgBugs.toFixed(1)}/task) among similar tasks`);
          }
        }

        return textResponse(sections.join('\n'));
      } catch (err: unknown) {
        await storage.close();
        return errorResponse(`Estimate failed: ${getErrorMessage(err)}`);
      }
    },
  );
}
