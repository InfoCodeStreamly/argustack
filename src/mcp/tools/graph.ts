import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import {
  loadWorkspace,
  createAdapters,
  textResponse,
  errorResponse,
  getErrorMessage,
} from '../helpers.js';

export function registerGraphTools(server: McpServer): void {
  server.registerTool(
    'impact_analysis',
    {
      description: 'Analyze impact of changing a file or module. Returns connected issues, developers, PRs via knowledge graph traversal. Run `argustack graph build` first. Use to assess risk before making changes.',
      inputSchema: {
        file_or_module: z.string().describe('File path or module name (e.g. "src/adapters/payment", "payment")'),
        depth: z.number().optional().describe('Graph traversal depth (default: 2)'),
      },
    },
    async ({ file_or_module: target, depth }) => {
      const ws = loadWorkspace();
      if (!ws.ok) { return errorResponse(`Workspace not found: ${ws.reason}`); }

      const { storage } = await createAdapters(ws.root);
      try {
        await storage.initialize();
        const result = await storage.queryGraph(target, depth ?? 2);

        if (result.entities.length === 0) {
          return textResponse(`No graph data for "${target}". Run "argustack graph build" first.`);
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

        await storage.close();
        return textResponse(lines.join('\n'));
      } catch (err: unknown) {
        await storage.close();
        return errorResponse(`Impact analysis failed: ${getErrorMessage(err)}`);
      }
    },
  );

  server.registerTool(
    'developer_expertise',
    {
      description: 'Find developers who know a specific area. Ranks by commits, reviews, issue assignments via knowledge graph. Run `argustack graph build` first.',
      inputSchema: {
        area: z.string().describe('Topic, module, or component name (e.g. "payment", "authentication")'),
        limit: z.number().optional().describe('Max developers to return (default: 10)'),
      },
    },
    async ({ area, limit }) => {
      const ws = loadWorkspace();
      if (!ws.ok) { return errorResponse(`Workspace not found: ${ws.reason}`); }

      const { storage } = await createAdapters(ws.root);
      try {
        await storage.initialize();
        const result = await storage.queryGraph(area, 2);

        if (result.entities.length === 0) {
          return textResponse(`No graph data for "${area}". Run "argustack graph build" first.`);
        }

        const developers = result.entities.filter((e) => e.type === 'developer');
        const ranked = developers.map((dev) => {
          const rels = result.relationships.filter((r) => r.sourceId === dev.id || r.targetId === dev.id);
          const commits = rels.filter((r) => r.type === 'authored_commit_for' || r.type === 'changed').length;
          const reviews = rels.filter((r) => r.type === 'reviewed').length;
          const assigned = rels.filter((r) => r.type === 'assigned_to').length;
          return { name: dev.name, total: rels.length, commits, reviews, assigned };
        }).sort((a, b) => b.total - a.total).slice(0, limit ?? 10);

        const lines = [
          `# Developer Expertise: ${area}`,
          '',
        ];

        for (let i = 0; i < ranked.length; i++) {
          const dev = ranked[i];
          if (!dev) { continue; }
          lines.push(`${String(i + 1)}. **${dev.name}** — ${String(dev.commits)} commits, ${String(dev.reviews)} reviews, ${String(dev.assigned)} assignments`);
        }

        await storage.close();
        return textResponse(lines.join('\n'));
      } catch (err: unknown) {
        await storage.close();
        return errorResponse(`Developer expertise failed: ${getErrorMessage(err)}`);
      }
    },
  );

  server.registerTool(
    'related_issues',
    {
      description: 'Find issues related to a given issue via knowledge graph traversal — through commits, files, PRs, developers. Discovers connections beyond explicit Jira links.',
      inputSchema: {
        issue_key: z.string().describe('Issue key (e.g. "ORG-16999")'),
        depth: z.number().optional().describe('Traversal depth (default: 3)'),
      },
    },
    async ({ issue_key: issueKey, depth }) => {
      const ws = loadWorkspace();
      if (!ws.ok) { return errorResponse(`Workspace not found: ${ws.reason}`); }

      const { storage } = await createAdapters(ws.root);
      try {
        await storage.initialize();
        const result = await storage.queryGraph(issueKey, depth ?? 3);

        const related = result.entities.filter((e) => e.type === 'issue' && e.name !== issueKey);

        if (related.length === 0) {
          return textResponse(`No related issues found for ${issueKey}. Run "argustack graph build" first.`);
        }

        const lines = [
          `# Related Issues: ${issueKey}`,
          `Found ${String(related.length)} related issue(s)`,
          '',
        ];

        for (const issue of related.slice(0, 30)) {
          const props = issue.properties;
          const source = result.relationships.some((r) =>
            (r.sourceId === issue.id || r.targetId === issue.id) && r.source === 'claude'
          ) ? ' (semantic)' : '';
          lines.push(`- **${issue.name}**${source} — ${typeof props['status'] === 'string' ? props['status'] : '?'} | ${typeof props['summary'] === 'string' ? props['summary'] : ''}`);
        }

        await storage.close();
        return textResponse(lines.join('\n'));
      } catch (err: unknown) {
        await storage.close();
        return errorResponse(`Related issues failed: ${getErrorMessage(err)}`);
      }
    },
  );

  server.registerTool(
    'code_dependencies',
    {
      description: 'Show code dependencies for a file or module — co-changed files (coupling), imports, package dependencies. Based on knowledge graph data.',
      inputSchema: {
        file_or_module: z.string().describe('File path or module name'),
        depth: z.number().optional().describe('Traversal depth (default: 2)'),
      },
    },
    async ({ file_or_module: target, depth }) => {
      const ws = loadWorkspace();
      if (!ws.ok) { return errorResponse(`Workspace not found: ${ws.reason}`); }

      const { storage } = await createAdapters(ws.root);
      try {
        await storage.initialize();
        const result = await storage.queryGraph(target, depth ?? 2);

        const coChanges = result.relationships
          .filter((r) => r.type === 'co_changes')
          .sort((a, b) => b.weight - a.weight);

        const imports = result.relationships.filter((r) => r.type === 'imports');
        const pkgDeps = result.relationships.filter((r) => r.type === 'depends_on_pkg');

        const lines = [`# Code Dependencies: ${target}`, ''];

        if (coChanges.length > 0) {
          lines.push('## Co-changed Modules (coupling)');
          for (const rel of coChanges.slice(0, 15)) {
            const other = result.entities.find((e) => e.id === rel.sourceId || e.id === rel.targetId);
            if (other) {
              lines.push(`- ${other.name} (${String(rel.weight)}x together)`);
            }
          }
          lines.push('');
        }

        if (imports.length > 0) {
          lines.push('## Imports');
          for (const rel of imports.slice(0, 20)) {
            const importedModule = result.entities.find((e) => e.id === rel.targetId);
            if (importedModule) { lines.push(`- ${importedModule.name}`); }
          }
          lines.push('');
        }

        if (pkgDeps.length > 0) {
          lines.push('## Package Dependencies');
          for (const rel of pkgDeps.slice(0, 20)) {
            const pkg = result.entities.find((e) => e.id === rel.targetId);
            if (pkg) { lines.push(`- ${pkg.name}`); }
          }
          lines.push('');
        }

        if (coChanges.length === 0 && imports.length === 0 && pkgDeps.length === 0) {
          await storage.close();
          return textResponse(`No code dependency data for "${target}". Run "argustack graph build" first.`);
        }

        await storage.close();
        return textResponse(lines.join('\n'));
      } catch (err: unknown) {
        await storage.close();
        return errorResponse(`Code dependencies failed: ${getErrorMessage(err)}`);
      }
    },
  );

  server.registerTool(
    'business_context',
    {
      description: 'Show business context for a topic — business processes, features, related issues. Based on semantic graph built by Claude. Run `build_business_graph` first for best results.',
      inputSchema: {
        topic: z.string().describe('Business topic (e.g. "refund", "payment", "onboarding")'),
        depth: z.number().optional().describe('Traversal depth (default: 2)'),
      },
    },
    async ({ topic, depth }) => {
      const ws = loadWorkspace();
      if (!ws.ok) { return errorResponse(`Workspace not found: ${ws.reason}`); }

      const { storage } = await createAdapters(ws.root);
      try {
        await storage.initialize();
        const result = await storage.queryGraph(topic, depth ?? 2);

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
          for (const obs of result.observations) {
            lines.push(`- ${obs.content}`);
          }
          lines.push('');
        }

        if (processes.length === 0 && features.length === 0 && issues.length === 0) {
          await storage.close();
          return textResponse('No business context for "' + topic + '". Run `build_business_graph` to have Claude analyze issue descriptions.');
        }

        await storage.close();
        return textResponse(lines.join('\n'));
      } catch (err: unknown) {
        await storage.close();
        return errorResponse(`Business context failed: ${getErrorMessage(err)}`);
      }
    },
  );

  server.registerTool(
    'build_business_graph',
    {
      description: 'Claude analyzes issue descriptions to discover business processes and features, then saves them to the knowledge graph. Returns entities found for Claude to confirm and save. No external API cost — uses Claude Max subscription.',
      inputSchema: {
        project: z.string().optional().describe('Project key to analyze (default: all)'),
        batch_size: z.number().optional().describe('Issues per batch (default: 50)'),
      },
    },
    async ({ project, batch_size: batchSize }) => {
      const ws = loadWorkspace();
      if (!ws.ok) { return errorResponse(`Workspace not found: ${ws.reason}`); }

      const { storage } = await createAdapters(ws.root);
      try {
        await storage.initialize();

        const projectFilter = project ? `WHERE project_key = $1` : '';
        const params = project ? [project] : [];
        const result = await storage.query(
          `SELECT issue_key, summary, description, issue_type, status FROM issues ${projectFilter} ORDER BY issue_key LIMIT ${String(batchSize ?? 50)}`,
          params
        );

        if (result.rows.length === 0) {
          await storage.close();
          return textResponse('No issues found. Run `argustack sync jira` first.');
        }

        const issueList = result.rows.map((r) => {
          const desc = (r['description'] as string | null) ?? '';
          const preview = desc.length > 200 ? desc.slice(0, 200) + '...' : desc;
          return `**${r['issue_key'] as string}** [${r['issue_type'] as string}] ${r['summary'] as string}\n${preview}`;
        }).join('\n\n');

        await storage.close();

        return textResponse([
          `# Business Graph Analysis`,
          `Analyzed ${String(result.rows.length)} issues. Review and use add_relationship to save connections.`,
          '',
          '## Instructions',
          'Read the issues below. Identify:',
          '1. **Business Processes** (e.g. "Refund Flow", "ACH Processing", "User Onboarding")',
          '2. **Features** (e.g. "Payment Redistribution", "LOC Account Management")',
          '3. Which issues belong to which process/feature',
          '4. Which processes affect each other',
          '',
          'Then call `add_relationship` for each connection found.',
          'Call `add_observation` to record important business knowledge.',
          '',
          '---',
          '',
          issueList,
        ].join('\n'));
      } catch (err: unknown) {
        await storage.close();
        return errorResponse(`Build business graph failed: ${getErrorMessage(err)}`);
      }
    },
  );

  server.registerTool(
    'add_relationship',
    {
      description: 'Add a relationship between two entities in the knowledge graph. Claude discovers connections and records them. Marked as source=claude — survives graph rebuild.',
      inputSchema: {
        source_name: z.string().describe('Source entity name (e.g. "Refund Flow")'),
        source_type: z.string().describe('Source entity type (e.g. "business_process", "feature", "issue", "developer", "module")'),
        target_name: z.string().describe('Target entity name'),
        target_type: z.string().describe('Target entity type'),
        relationship_type: z.string().describe('Relationship type (e.g. "affects", "part_of_process", "implements_feature", "depends_on", "related_to")'),
        description: z.string().optional().describe('Description of the relationship'),
      },
    },
    async ({ source_name: srcName, source_type: srcType, target_name: tgtName, target_type: tgtType, relationship_type: relType, description: desc }) => {
      const ws = loadWorkspace();
      if (!ws.ok) { return errorResponse(`Workspace not found: ${ws.reason}`); }

      const { storage } = await createAdapters(ws.root);
      try {
        await storage.initialize();

        await storage.saveGraphEntities([
          { name: srcName, type: srcType, properties: {} },
          { name: tgtName, type: tgtType, properties: {} },
        ]);

        const entityResult = await storage.query(
          'SELECT id, name, type FROM graph_entities WHERE (name = $1 AND type = $2) OR (name = $3 AND type = $4)',
          [srcName, srcType, tgtName, tgtType]
        );

        const srcEntity = entityResult.rows.find((r) => r['name'] === srcName && r['type'] === srcType);
        const tgtEntity = entityResult.rows.find((r) => r['name'] === tgtName && r['type'] === tgtType);

        if (!srcEntity || !tgtEntity) {
          await storage.close();
          return errorResponse('Failed to create entities');
        }

        await storage.saveGraphRelationships([{
          sourceId: srcEntity['id'] as number,
          targetId: tgtEntity['id'] as number,
          type: relType,
          weight: 1,
          source: 'claude',
          properties: desc ? { description: desc } : {},
        }]);

        await storage.close();
        return textResponse(`Added: ${srcName} —[${relType}]→ ${tgtName}${desc ? ` (${desc})` : ''}`);
      } catch (err: unknown) {
        await storage.close();
        return errorResponse(`Add relationship failed: ${getErrorMessage(err)}`);
      }
    },
  );

  server.registerTool(
    'add_observation',
    {
      description: 'Add a text note/observation to any entity in the knowledge graph. Multiple observations per entity — append only, never overwrites. Use to record business knowledge, warnings, tips.',
      inputSchema: {
        entity_name: z.string().describe('Entity name (e.g. "ORG-16999", "Refund Flow", "Dmitry Kislitsyn")'),
        content: z.string().describe('Observation text (e.g. "After refund, must sync to OrgMeter within same business day")'),
      },
    },
    async ({ entity_name: entityName, content }) => {
      const ws = loadWorkspace();
      if (!ws.ok) { return errorResponse('Workspace not found: ' + ws.reason); }

      const { storage } = await createAdapters(ws.root);
      try {
        await storage.initialize();

        const entityResult = await storage.query(
          'SELECT id FROM graph_entities WHERE name = $1 LIMIT 1',
          [entityName]
        );

        if (entityResult.rows.length === 0) {
          await storage.close();
          return errorResponse('Entity "' + entityName + '" not found. Run "argustack graph build" first, or create it via add_relationship.');
        }

        const entityId = entityResult.rows[0]?.['id'] as number;
        await storage.saveGraphObservation(entityId, content, 'claude');

        const allObs = await storage.getObservations(entityId);
        await storage.close();
        return textResponse(`Added observation to "${entityName}". Total observations: ${String(allObs.length)}`);
      } catch (err: unknown) {
        await storage.close();
        return errorResponse(`Add observation failed: ${getErrorMessage(err)}`);
      }
    },
  );
}
