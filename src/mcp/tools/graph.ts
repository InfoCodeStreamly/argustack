import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import {
  loadWorkspace,
  createAdapters,
  textResponse,
  errorResponse,
  workspaceNotFoundResponse,
  getErrorMessage,
  hasText,
  ANNOTATIONS,
} from '../helpers.js';

const workspaceIdParam = z.string().optional().describe('Workspace id or name (defaults to active workspace)');

export function registerGraphTools(server: McpServer): void {
  server.registerTool(
    'impact_analysis',
    {
      title: 'Knowledge-graph impact analysis',
      description: 'Impact analysis for a file/module via knowledge graph (entities, developers, PRs).',
      inputSchema: {
        workspace_id: workspaceIdParam,
        file_or_module: z.string().describe('File path or module name'),
        depth: z.number().optional().describe('Traversal depth (default 2)'),
      },
      annotations: ANNOTATIONS.READ_ONLY,
    },
    async ({ workspace_id: workspaceIdInput, file_or_module: target, depth }) => {
      const ws = await loadWorkspace(workspaceIdInput);
      if (!ws.ok) { return workspaceNotFoundResponse(ws.reason); }
      const { storage, workspaceId } = await createAdapters(ws.workspaceId);

      try {
        await storage.initialize();
        const result = await storage.queryGraph(workspaceId, target, depth ?? 2);

        if (result.entities.length === 0) {
          return textResponse(`No graph data for "${target}". Run "argustack graph build --workspace ${workspaceId}".`);
        }
        const issues = result.entities.filter((e) => e.type === 'issue');
        const developers = result.entities.filter((e) => e.type === 'developer');
        const prs = result.entities.filter((e) => e.type === 'pr');
        const modules = result.entities.filter((e) => e.type === 'module');
        const lines = [
          `# Impact Analysis: ${target}`,
          '',
          `**${String(issues.length)} issues**, **${String(developers.length)} developers**, **${String(prs.length)} PRs**, **${String(modules.length)} modules** connected`,
          '',
        ];
        if (issues.length > 0) {
          lines.push('## Connected Issues');
          for (const issue of issues.slice(0, 20)) {
            const props = issue.properties;
            lines.push(`- **${issue.name}** — ${typeof props['status'] === 'string' ? props['status'] : '?'} | ${typeof props['summary'] === 'string' ? props['summary'] : ''}`);
          }
          lines.push('');
        }
        if (developers.length > 0) {
          lines.push('## Developers');
          const devWeights = developers.map((dev) => {
            const rels = result.relationships.filter((r) => r.sourceId === dev.id || r.targetId === dev.id);
            return { name: dev.name, connections: rels.length };
          }).sort((a, b) => b.connections - a.connections);
          for (const dev of devWeights.slice(0, 10)) {
            lines.push(`- ${dev.name} — ${String(dev.connections)} connections`);
          }
          lines.push('');
        }
        if (result.observations.length > 0) {
          lines.push('## Observations');
          for (const obs of result.observations) {
            const entity = result.entities.find((e) => e.id === obs.entityId);
            lines.push(`- [${entity?.name ?? '?'}] ${obs.content}`);
          }
          lines.push('');
        }
        return textResponse(lines.join('\n'));
      } catch (err) {
        return errorResponse(`Impact analysis failed: ${getErrorMessage(err)}`);
      }
    },
  );

  server.registerTool(
    'developer_expertise',
    {
      title: 'Developer expertise ranking',
      description: 'Rank developers for a topic via knowledge graph.',
      inputSchema: {
        workspace_id: workspaceIdParam,
        area: z.string(),
        limit: z.number().optional(),
      },
      annotations: ANNOTATIONS.READ_ONLY,
    },
    async ({ workspace_id: workspaceIdInput, area, limit }) => {
      const ws = await loadWorkspace(workspaceIdInput);
      if (!ws.ok) { return workspaceNotFoundResponse(ws.reason); }
      const { storage, workspaceId } = await createAdapters(ws.workspaceId);

      try {
        await storage.initialize();
        const result = await storage.queryGraph(workspaceId, area, 2);
        if (result.entities.length === 0) {
          return textResponse(`No graph data for "${area}".`);
        }
        const developers = result.entities.filter((e) => e.type === 'developer');
        const ranked = developers.map((dev) => {
          const rels = result.relationships.filter((r) => r.sourceId === dev.id || r.targetId === dev.id);
          const commits = rels.filter((r) => r.type === 'authored_commit_for' || r.type === 'changed').length;
          const reviews = rels.filter((r) => r.type === 'reviewed').length;
          const assigned = rels.filter((r) => r.type === 'assigned_to').length;
          return { name: dev.name, total: rels.length, commits, reviews, assigned };
        }).sort((a, b) => b.total - a.total).slice(0, limit ?? 10);

        const lines = [`# Developer Expertise: ${area}`, ''];
        for (let i = 0; i < ranked.length; i++) {
          const dev = ranked[i];
          if (dev === undefined) { continue; }
          lines.push(`${String(i + 1)}. **${dev.name}** — ${String(dev.commits)} commits, ${String(dev.reviews)} reviews, ${String(dev.assigned)} assignments`);
        }
        return textResponse(lines.join('\n'));
      } catch (err) {
        return errorResponse(`Developer expertise failed: ${getErrorMessage(err)}`);
      }
    },
  );

  server.registerTool(
    'related_issues',
    {
      title: 'Related issues (graph)',
      description: 'Issues related to a given issue via knowledge graph traversal.',
      inputSchema: {
        workspace_id: workspaceIdParam,
        issue_key: z.string(),
        depth: z.number().optional(),
      },
      annotations: ANNOTATIONS.READ_ONLY,
    },
    async ({ workspace_id: workspaceIdInput, issue_key: issueKey, depth }) => {
      const ws = await loadWorkspace(workspaceIdInput);
      if (!ws.ok) { return workspaceNotFoundResponse(ws.reason); }
      const { storage, workspaceId } = await createAdapters(ws.workspaceId);

      try {
        await storage.initialize();
        const result = await storage.queryGraph(workspaceId, issueKey, depth ?? 3);
        const related = result.entities.filter((e) => e.type === 'issue' && e.name !== issueKey);
        if (related.length === 0) {
          return textResponse(`No related issues for ${issueKey}.`);
        }
        const lines = [`# Related Issues: ${issueKey}`, `Found ${String(related.length)} related issue(s)`, ''];
        for (const issue of related.slice(0, 30)) {
          const props = issue.properties;
          const source = result.relationships.some((r) =>
            (r.sourceId === issue.id || r.targetId === issue.id) && r.source === 'claude'
          ) ? ' (semantic)' : '';
          lines.push(`- **${issue.name}**${source} — ${typeof props['status'] === 'string' ? props['status'] : '?'} | ${typeof props['summary'] === 'string' ? props['summary'] : ''}`);
        }
        return textResponse(lines.join('\n'));
      } catch (err) {
        return errorResponse(`Related issues failed: ${getErrorMessage(err)}`);
      }
    },
  );

  server.registerTool(
    'code_dependencies',
    {
      title: 'Code dependencies (graph)',
      description: 'Code dependencies for a file/module.',
      inputSchema: {
        workspace_id: workspaceIdParam,
        file_or_module: z.string(),
        depth: z.number().optional(),
      },
      annotations: ANNOTATIONS.READ_ONLY,
    },
    async ({ workspace_id: workspaceIdInput, file_or_module: target, depth }) => {
      const ws = await loadWorkspace(workspaceIdInput);
      if (!ws.ok) { return workspaceNotFoundResponse(ws.reason); }
      const { storage, workspaceId } = await createAdapters(ws.workspaceId);

      try {
        await storage.initialize();
        const result = await storage.queryGraph(workspaceId, target, depth ?? 2);
        const coChanges = result.relationships.filter((r) => r.type === 'co_changes').sort((a, b) => b.weight - a.weight);
        const imports = result.relationships.filter((r) => r.type === 'imports');
        const pkgDeps = result.relationships.filter((r) => r.type === 'depends_on_pkg');

        const lines = [`# Code Dependencies: ${target}`, ''];
        if (coChanges.length > 0) {
          lines.push('## Co-changed Modules (coupling)');
          for (const rel of coChanges.slice(0, 15)) {
            const other = result.entities.find((e) => e.id === rel.sourceId || e.id === rel.targetId);
            if (other !== undefined) { lines.push(`- ${other.name} (${String(rel.weight)}x together)`); }
          }
          lines.push('');
        }
        if (imports.length > 0) {
          lines.push('## Imports');
          for (const rel of imports.slice(0, 20)) {
            const importedModule = result.entities.find((e) => e.id === rel.targetId);
            if (importedModule !== undefined) { lines.push(`- ${importedModule.name}`); }
          }
          lines.push('');
        }
        if (pkgDeps.length > 0) {
          lines.push('## Package Dependencies');
          for (const rel of pkgDeps.slice(0, 20)) {
            const pkg = result.entities.find((e) => e.id === rel.targetId);
            if (pkg !== undefined) { lines.push(`- ${pkg.name}`); }
          }
          lines.push('');
        }
        if (coChanges.length === 0 && imports.length === 0 && pkgDeps.length === 0) {
          return textResponse(`No code dependency data for "${target}".`);
        }
        return textResponse(lines.join('\n'));
      } catch (err) {
        return errorResponse(`Code dependencies failed: ${getErrorMessage(err)}`);
      }
    },
  );

  server.registerTool(
    'business_context',
    {
      title: 'Business context (graph)',
      description: 'Business context for a topic from the workspace knowledge graph.',
      inputSchema: {
        workspace_id: workspaceIdParam,
        topic: z.string(),
        depth: z.number().optional(),
      },
      annotations: ANNOTATIONS.READ_ONLY,
    },
    async ({ workspace_id: workspaceIdInput, topic, depth }) => {
      const ws = await loadWorkspace(workspaceIdInput);
      if (!ws.ok) { return workspaceNotFoundResponse(ws.reason); }
      const { storage, workspaceId } = await createAdapters(ws.workspaceId);

      try {
        await storage.initialize();
        const result = await storage.queryGraph(workspaceId, topic, depth ?? 2);
        const processes = result.entities.filter((e) => e.type === 'business_process');
        const features = result.entities.filter((e) => e.type === 'feature');
        const issues = result.entities.filter((e) => e.type === 'issue');

        const lines = [`# Business Context: ${topic}`, ''];
        if (processes.length > 0) {
          lines.push('## Business Processes');
          for (const p of processes) { lines.push(`- **${p.name}**`); }
          lines.push('');
        }
        if (features.length > 0) {
          lines.push('## Features');
          for (const f of features) { lines.push(`- ${f.name}`); }
          lines.push('');
        }
        if (issues.length > 0) {
          lines.push(`## Related Issues (${String(issues.length)})`);
          for (const issue of issues.slice(0, 15)) {
            lines.push(`- **${issue.name}** — ${typeof issue.properties['status'] === 'string' ? issue.properties['status'] : '?'} | ${typeof issue.properties['summary'] === 'string' ? issue.properties['summary'] : ''}`);
          }
          lines.push('');
        }
        if (result.observations.length > 0) {
          lines.push('## Knowledge & Notes');
          for (const obs of result.observations) { lines.push(`- ${obs.content}`); }
          lines.push('');
        }
        if (processes.length === 0 && features.length === 0 && issues.length === 0) {
          return textResponse(`No business context for "${topic}". Run \`build_business_graph\`.`);
        }
        return textResponse(lines.join('\n'));
      } catch (err) {
        return errorResponse(`Business context failed: ${getErrorMessage(err)}`);
      }
    },
  );

  server.registerTool(
    'build_business_graph',
    {
      title: 'Build business graph',
      description: 'Analyse issues to discover business processes/features for further enrichment.',
      inputSchema: {
        workspace_id: workspaceIdParam,
        project: z.string().optional(),
        batch_size: z.number().optional(),
      },
      annotations: ANNOTATIONS.LOCAL_WRITE,
    },
    async ({ workspace_id: workspaceIdInput, project, batch_size: batchSize }) => {
      const ws = await loadWorkspace(workspaceIdInput);
      if (!ws.ok) { return workspaceNotFoundResponse(ws.reason); }
      const { storage, workspaceId } = await createAdapters(ws.workspaceId);

      try {
        await storage.initialize();
        const projectFilter = hasText(project) ? `AND project_key = $2` : '';
        const params: unknown[] = hasText(project) ? [project] : [];
        const result = await storage.queryForWorkspace(
          workspaceId,
          `SELECT issue_key, summary, description, issue_type, status FROM issues
           WHERE workspace_id = $1 ${projectFilter}
           ORDER BY issue_key LIMIT ${String(batchSize ?? 50)}`,
          params,
        );

        if (result.rows.length === 0) {
          return textResponse('No issues found. Run `argustack sync` first.');
        }
        const issueList = result.rows.map((r) => {
          const desc = (r['description'] as string | null) ?? '';
          const preview = desc.length > 200 ? `${desc.slice(0, 200)  }...` : desc;
          return `**${r['issue_key'] as string}** [${r['issue_type'] as string}] ${r['summary'] as string}\n${preview}`;
        }).join('\n\n');
        return textResponse([
          `# Business Graph Analysis — workspace ${workspaceId}`,
          `Analysed ${String(result.rows.length)} issues. Use add_relationship to save connections.`,
          '',
          '---', '',
          issueList,
        ].join('\n'));
      } catch (err) {
        return errorResponse(`Build business graph failed: ${getErrorMessage(err)}`);
      }
    },
  );

  server.registerTool(
    'add_relationship',
    {
      title: 'Add graph relationship',
      description: 'Add a relationship between two graph entities (marked source=claude).',
      inputSchema: {
        workspace_id: workspaceIdParam,
        source_name: z.string(),
        source_type: z.string(),
        target_name: z.string(),
        target_type: z.string(),
        relationship_type: z.string(),
        description: z.string().optional(),
      },
      annotations: ANNOTATIONS.LOCAL_WRITE,
    },
    async ({ workspace_id: workspaceIdInput, source_name: srcName, source_type: srcType, target_name: tgtName, target_type: tgtType, relationship_type: relType, description: desc }) => {
      const ws = await loadWorkspace(workspaceIdInput);
      if (!ws.ok) { return workspaceNotFoundResponse(ws.reason); }
      const { storage, workspaceId } = await createAdapters(ws.workspaceId);

      try {
        await storage.initialize();
        await storage.saveGraphEntities(workspaceId, [
          { name: srcName, type: srcType, properties: {} },
          { name: tgtName, type: tgtType, properties: {} },
        ]);

        const entityResult = await storage.queryForWorkspace(
          workspaceId,
          `SELECT id, name, type FROM graph_entities WHERE workspace_id = $1 AND ((name = $2 AND type = $3) OR (name = $4 AND type = $5))`,
          [srcName, srcType, tgtName, tgtType],
        );
        const srcEntity = entityResult.rows.find((r) => r['name'] === srcName && r['type'] === srcType);
        const tgtEntity = entityResult.rows.find((r) => r['name'] === tgtName && r['type'] === tgtType);
        if (srcEntity === undefined || tgtEntity === undefined) {
          return errorResponse('Failed to create entities');
        }
        await storage.saveGraphRelationships(workspaceId, [{
          sourceId: srcEntity['id'] as number,
          targetId: tgtEntity['id'] as number,
          type: relType,
          weight: 1,
          source: 'claude',
          properties: hasText(desc) ? { description: desc } : {},
        }]);
        return textResponse(`Added: ${srcName} —[${relType}]→ ${tgtName}${hasText(desc) ? ` (${desc})` : ''}`);
      } catch (err) {
        return errorResponse(`Add relationship failed: ${getErrorMessage(err)}`);
      }
    },
  );

  server.registerTool(
    'root_cause_analysis',
    {
      title: 'Root cause analysis',
      description: 'Trace root cause chain for a bug — confirmed, probable, claude-identified causes.',
      inputSchema: {
        workspace_id: workspaceIdParam,
        issue_key: z.string(),
      },
      annotations: ANNOTATIONS.READ_ONLY,
    },
    async ({ workspace_id: workspaceIdInput, issue_key: issueKey }) => {
      const ws = await loadWorkspace(workspaceIdInput);
      if (!ws.ok) { return workspaceNotFoundResponse(ws.reason); }
      const { storage, workspaceId } = await createAdapters(ws.workspaceId);

      try {
        await storage.initialize();
        const entityResult = await storage.queryForWorkspace(
          workspaceId,
          `SELECT id FROM graph_entities WHERE workspace_id = $1 AND name = $2 LIMIT 1`,
          [issueKey],
        );
        if (entityResult.rows.length === 0) {
          return textResponse(`No graph data for "${issueKey}".`);
        }
        const entityId = entityResult.rows[0]?.['id'] as number;
        const relsResult = await storage.queryForWorkspace(
          workspaceId,
          `SELECT r.type, r.source, r.properties, r.weight,
                  se.name AS source_name, se.type AS source_type, se.properties AS source_props
           FROM graph_relationships r
           JOIN graph_entities se ON se.workspace_id = r.workspace_id AND se.id = r.source_id
           WHERE r.workspace_id = $1
             AND r.target_id = $2
             AND r.type IN ('root_causes', 'probably_caused_by', 'blocked_by', 'caused_by')
           ORDER BY r.type, r.weight DESC`,
          [entityId],
        );
        interface CauseRow {
          type: string; source: string; properties: Record<string, unknown>; weight: number;
          source_name: string; source_type: string; source_props: Record<string, unknown>;
        }
        const rows = relsResult.rows as unknown as CauseRow[];
        if (rows.length === 0) {
          return textResponse(`No root cause data for "${issueKey}".`);
        }

        const confirmed = rows.filter((r) => r.source === 'auto' && (r.type === 'root_causes' || r.type === 'blocked_by'));
        const probable = rows.filter((r) => r.source === 'auto' && r.type === 'probably_caused_by');
        const claudeIdentified = rows.filter((r) => r.source === 'claude');

        const lines = [`# Root Cause Analysis: ${issueKey}`, ''];
        const formatRow = (r: CauseRow): string => {
          const props = r.properties;
          const evidence = typeof props['evidence'] === 'string' ? ` — ${props['evidence']}` : '';
          const confidence = typeof props['confidence'] === 'string' ? ` [${props['confidence']}]` : '';
          return `- **${r.source_name}** (${r.source_type}) —[${r.type}]→${confidence}${evidence}`;
        };
        if (confirmed.length > 0) {
          lines.push(`## Confirmed Causes (${String(confirmed.length)})`);
          lines.push('*From Jira issue links*');
          for (const r of confirmed) { lines.push(formatRow(r)); }
          lines.push('');
        }
        if (probable.length > 0) {
          lines.push(`## Probable Causes (${String(probable.length)})`);
          lines.push('*From git timeline*');
          for (const r of probable) { lines.push(formatRow(r)); }
          lines.push('');
        }
        if (claudeIdentified.length > 0) {
          lines.push(`## Claude-Identified Causes (${String(claudeIdentified.length)})`);
          lines.push('*Manually added via add_relationship*');
          for (const r of claudeIdentified) { lines.push(formatRow(r)); }
          lines.push('');
        }
        return textResponse(lines.join('\n'));
      } catch (err) {
        return errorResponse(`Root cause analysis failed: ${getErrorMessage(err)}`);
      }
    },
  );

  server.registerTool(
    'add_observation',
    {
      title: 'Add graph observation',
      description: 'Append a note to a graph entity.',
      inputSchema: {
        workspace_id: workspaceIdParam,
        entity_name: z.string(),
        content: z.string(),
      },
      annotations: ANNOTATIONS.LOCAL_WRITE,
    },
    async ({ workspace_id: workspaceIdInput, entity_name: entityName, content }) => {
      const ws = await loadWorkspace(workspaceIdInput);
      if (!ws.ok) { return workspaceNotFoundResponse(ws.reason); }
      const { storage, workspaceId } = await createAdapters(ws.workspaceId);

      try {
        await storage.initialize();
        const entityResult = await storage.queryForWorkspace(
          workspaceId,
          `SELECT id FROM graph_entities WHERE workspace_id = $1 AND name = $2 LIMIT 1`,
          [entityName],
        );
        if (entityResult.rows.length === 0) {
          return errorResponse(`Entity "${entityName}" not found in workspace ${workspaceId}.`);
        }
        const entityId = entityResult.rows[0]?.['id'] as number;
        await storage.saveGraphObservation(workspaceId, entityId, content, 'claude');
        const allObs = await storage.getObservations(workspaceId, entityId);
        return textResponse(`Added observation to "${entityName}". Total observations: ${String(allObs.length)}`);
      } catch (err) {
        return errorResponse(`Add observation failed: ${getErrorMessage(err)}`);
      }
    },
  );
}
