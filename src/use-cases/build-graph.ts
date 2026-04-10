import type { IStorage } from '../core/ports/storage.js';
import type { GraphEntity, GraphRelationship, GraphStats } from '../core/types/index.js';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

function noop(_message: string): void { /* intentional */ }

export interface BuildGraphOptions {
  since?: string;
  repoPaths?: string[];
  onProgress?: (message: string) => void;
}

export class BuildGraphUseCase {
  constructor(private readonly storage: IStorage) {}

  async execute(options: BuildGraphOptions = {}): Promise<GraphStats> {
    const log = options.onProgress ?? noop;

    await this.storage.initialize();

    if (!options.since) {
      log('Clearing structural graph...');
      await this.storage.clearGraph();
    }

    const entities: GraphEntity[] = [];
    const relationships: GraphRelationship[] = [];
    const entityMap = new Map<string, number>();

    let nextId = 1;
    const getOrCreateEntity = (name: string, type: string, properties: Record<string, unknown> = {}): number => {
      const key = `${type}::${name}`;
      const existing = entityMap.get(key);
      if (existing !== undefined) {
        return existing;
      }
      const id = nextId++;
      entityMap.set(key, id);
      entities.push({ id, name, type, properties });
      return id;
    };

    log('Extracting entities from issues...');
    const issueResult = await this.storage.query(
      `SELECT issue_key, summary, issue_type, status, assignee, reporter, labels, components, parent_key
       FROM issues ${options.since ? 'WHERE updated >= $1' : ''} ORDER BY issue_key`,
      options.since ? [options.since] : []
    );

    for (const row of issueResult.rows) {
      const issueKey = row['issue_key'] as string;
      const issueId = getOrCreateEntity(issueKey, 'issue', {
        summary: row['summary'],
        issueType: row['issue_type'],
        status: row['status'],
      });

      const assignee = row['assignee'] as string | null;
      if (assignee) {
        const devId = getOrCreateEntity(assignee, 'developer', {});
        relationships.push({ sourceId: issueId, targetId: devId, type: 'assigned_to', weight: 1, source: 'structural', properties: {} });
      }

      const reporter = row['reporter'] as string | null;
      if (reporter) {
        const devId = getOrCreateEntity(reporter, 'developer', {});
        relationships.push({ sourceId: issueId, targetId: devId, type: 'reported_by', weight: 1, source: 'structural', properties: {} });
      }

      const labels = row['labels'] as string[] | null;
      if (labels) {
        for (const label of labels) {
          const labelId = getOrCreateEntity(label, 'label', {});
          relationships.push({ sourceId: issueId, targetId: labelId, type: 'labeled', weight: 1, source: 'structural', properties: {} });
        }
      }

      const components = row['components'] as string[] | null;
      if (components) {
        for (const comp of components) {
          const compId = getOrCreateEntity(comp, 'component', {});
          relationships.push({ sourceId: issueId, targetId: compId, type: 'in_component', weight: 1, source: 'structural', properties: {} });
        }
      }

      const parentKey = row['parent_key'] as string | null;
      if (parentKey) {
        const parentId = getOrCreateEntity(parentKey, 'issue', {});
        relationships.push({ sourceId: parentId, targetId: issueId, type: 'parent_of', weight: 1, source: 'structural', properties: {} });
      }
    }
    log(`  ${String(issueResult.rows.length)} issues processed`);

    log('Extracting entities from commits...');
    const commitResult = await this.storage.query(
      `SELECT hash, author, message FROM commits ${options.since ? 'WHERE committed_at >= $1' : ''} ORDER BY committed_at`,
      options.since ? [options.since] : []
    );

    for (const row of commitResult.rows) {
      const author = row['author'] as string | null;
      if (author) {
        getOrCreateEntity(author, 'developer', {});
      }
    }
    log(`  ${String(commitResult.rows.length)} commits processed`);

    log('Extracting commit→issue references...');
    const refResult = await this.storage.query(
      `SELECT cr.commit_hash, cr.issue_key, c.author
       FROM commit_issue_refs cr JOIN commits c ON c.hash = cr.commit_hash`,
      []
    );

    for (const row of refResult.rows) {
      const issueKey = row['issue_key'] as string;
      const author = row['author'] as string | null;
      const issueId = getOrCreateEntity(issueKey, 'issue', {});
      if (author) {
        const devId = getOrCreateEntity(author, 'developer', {});
        relationships.push({ sourceId: devId, targetId: issueId, type: 'authored_commit_for', weight: 1, source: 'structural', properties: {} });
      }
    }
    log(`  ${String(refResult.rows.length)} commit→issue refs`);

    log('Extracting commit→file modules...');
    const fileResult = await this.storage.query(
      `SELECT cf.commit_hash, cf.file_path, c.author
       FROM commit_files cf JOIN commits c ON c.hash = cf.commit_hash`,
      []
    );

    for (const row of fileResult.rows) {
      const filePath = row['file_path'] as string;
      const author = row['author'] as string | null;
      const moduleName = extractModuleName(filePath);
      const moduleId = getOrCreateEntity(moduleName, 'module', {});

      if (author) {
        const devId = getOrCreateEntity(author, 'developer', {});
        const existing = relationships.find((r) => r.sourceId === devId && r.targetId === moduleId && r.type === 'changed');
        if (existing) {
          existing.weight++;
        } else {
          relationships.push({ sourceId: devId, targetId: moduleId, type: 'changed', weight: 1, source: 'structural', properties: {} });
        }
      }
    }
    log(`  ${String(fileResult.rows.length)} file changes processed`);

    log('Extracting PR→issue references...');
    const prRefResult = await this.storage.query(
      `SELECT pr.number, pr.author, pri.issue_key
       FROM pr_issue_refs pri JOIN pull_requests pr ON pr.number = pri.pr_number AND pr.repo_full_name = pri.repo_full_name`,
      []
    );

    for (const row of prRefResult.rows) {
      const prNumber = String(row['number']);
      const issueKey = row['issue_key'] as string;
      const author = row['author'] as string | null;

      const prId = getOrCreateEntity(`#${prNumber}`, 'pr', {});
      const issueId = getOrCreateEntity(issueKey, 'issue', {});
      relationships.push({ sourceId: prId, targetId: issueId, type: 'implements', weight: 1, source: 'structural', properties: {} });

      if (author) {
        const devId = getOrCreateEntity(author, 'developer', {});
        relationships.push({ sourceId: devId, targetId: prId, type: 'authored_pr', weight: 1, source: 'structural', properties: {} });
      }
    }
    log(`  ${String(prRefResult.rows.length)} PR→issue refs`);

    log('Co-change analysis...');
    const coChangeResult = await this.storage.query(
      `SELECT a.file_path as file_a, b.file_path as file_b, COUNT(*) as co_count
       FROM commit_files a
       JOIN commit_files b ON a.commit_hash = b.commit_hash AND a.file_path < b.file_path
       GROUP BY a.file_path, b.file_path
       HAVING COUNT(*) >= 3
       ORDER BY co_count DESC
       LIMIT 500`,
      []
    );

    for (const row of coChangeResult.rows) {
      const modA = extractModuleName(row['file_a'] as string);
      const modB = extractModuleName(row['file_b'] as string);
      if (modA !== modB) {
        const idA = getOrCreateEntity(modA, 'module', {});
        const idB = getOrCreateEntity(modB, 'module', {});
        const weight = Number(row['co_count']);
        relationships.push({ sourceId: idA, targetId: idB, type: 'co_changes', weight, source: 'structural', properties: {} });
      }
    }
    log(`  ${String(coChangeResult.rows.length)} co-change pairs`);

    log('Extracting causal relationships from issue links...');
    const causalLinkResult = await this.storage.query(
      `SELECT source_key, target_key, link_type FROM issue_links
       WHERE link_type IN ('Cause', 'Blocked', 'is caused by', 'is blocked by', 'Causes', 'Blocks')`,
      []
    );

    for (const row of causalLinkResult.rows) {
      const sourceKey = row['source_key'] as string;
      const targetKey = row['target_key'] as string;
      const linkType = row['link_type'] as string;
      const sourceId = getOrCreateEntity(sourceKey, 'issue', {});
      const targetId = getOrCreateEntity(targetKey, 'issue', {});
      const relType = linkType.toLowerCase().includes('block') ? 'blocked_by' : 'root_causes';
      relationships.push({ sourceId, targetId, type: relType, weight: 1, source: 'auto', properties: { jira_link_type: linkType } });
    }
    log(`  ${String(causalLinkResult.rows.length)} causal links from Jira`);

    log('Detecting regressions (Reopened after Done)...');
    const regressionResult = await this.storage.query(
      `SELECT DISTINCT ic.issue_key, ic.to_value as reopen_status,
              ic.created as reopen_date
       FROM issue_changelogs ic
       WHERE ic.field = 'status' AND ic.to_value = 'Reopened'
       ORDER BY ic.created DESC`,
      []
    );

    for (const row of regressionResult.rows) {
      const issueKey = row['issue_key'] as string;
      const reopenDate = row['reopen_date'] as string;
      const issueId = getOrCreateEntity(issueKey, 'issue', {});

      const suspectPrs = await this.storage.query(
        `SELECT pr.number FROM pull_requests pr
         WHERE pr.merged_at IS NOT NULL
           AND pr.merged_at < $1
           AND pr.merged_at > ($1::timestamp - interval '14 days')
         LIMIT 5`,
        [reopenDate]
      );

      for (const prRow of suspectPrs.rows) {
        const prNumber = String(prRow['number']);
        const prId = getOrCreateEntity(`#${prNumber}`, 'pr', {});
        relationships.push({ sourceId: prId, targetId: issueId, type: 'probably_caused_by', weight: 1, source: 'auto', properties: { evidence: 'regression', reopen_date: reopenDate } });
      }
    }
    log(`  ${String(regressionResult.rows.length)} regressions checked`);

    log('Detecting probable causes (bug after PR merge)...');
    const bugResult = await this.storage.query(
      `SELECT i.issue_key, i.created, i.components
       FROM issues i
       WHERE i.issue_type IN ('Bug', 'bug', 'Defect', 'defect')
         AND i.created > NOW() - interval '6 months'
       ORDER BY i.created DESC`,
      []
    );

    for (const bugRow of bugResult.rows) {
      const bugKey = bugRow['issue_key'] as string;
      const bugCreated = bugRow['created'] as string;
      const bugComponents = bugRow['components'] as string | null;
      const bugId = getOrCreateEntity(bugKey, 'issue', {});

      if (!bugComponents) { continue; }

      const suspectPrs = await this.storage.query(
        `SELECT DISTINCT pr.number FROM pull_requests pr
         JOIN pr_issue_refs pri ON pri.pr_number = pr.number AND pri.repo_full_name = pr.repo_full_name
         JOIN issues ref_issue ON ref_issue.issue_key = pri.issue_key
         WHERE pr.merged_at IS NOT NULL
           AND pr.merged_at < $1
           AND pr.merged_at > ($1::timestamp - interval '14 days')
           AND ref_issue.components IS NOT NULL
           AND ref_issue.components && $2::text[]
         LIMIT 5`,
        [bugCreated, bugComponents]
      );

      for (const prRow of suspectPrs.rows) {
        const prNumber = String(prRow['number']);
        const prId = getOrCreateEntity(`#${prNumber}`, 'pr', {});
        const existing = relationships.find((r) => r.sourceId === prId && r.targetId === bugId && r.type === 'probably_caused_by');
        if (!existing) {
          relationships.push({ sourceId: prId, targetId: bugId, type: 'probably_caused_by', weight: 1, source: 'auto', properties: { evidence: 'component_overlap', bug_created: bugCreated } });
        }
      }
    }
    log(`  ${String(bugResult.rows.length)} bugs checked for probable causes`);

    if (options.repoPaths) {
      for (const repoPath of options.repoPaths) {
        log(`Import analysis: ${repoPath}...`);
        const importRels = extractImports(repoPath, getOrCreateEntity);
        relationships.push(...importRels);
        log(`  ${String(importRels.length)} import relationships`);

        const pkgRels = extractPackageDeps(repoPath, getOrCreateEntity);
        relationships.push(...pkgRels);
        log(`  ${String(pkgRels.length)} package dependencies`);
      }
    }

    log(`Saving graph: ${String(entities.length)} entities, ${String(relationships.length)} relationships...`);
    await this.storage.saveGraphEntities(entities);

    const savedEntities = await this.storage.query(
      `SELECT id, name, type FROM graph_entities`, []
    );
    const dbEntityMap = new Map<string, number>();
    for (const row of savedEntities.rows) {
      dbEntityMap.set(`${row['type'] as string}::${row['name'] as string}`, row['id'] as number);
    }

    const mappedRels = relationships.map((r) => {
      const sourceEntity = entities.find((e) => e.id === r.sourceId);
      const targetEntity = entities.find((e) => e.id === r.targetId);
      if (!sourceEntity || !targetEntity) { return null; }

      const dbSourceId = dbEntityMap.get(`${sourceEntity.type}::${sourceEntity.name}`);
      const dbTargetId = dbEntityMap.get(`${targetEntity.type}::${targetEntity.name}`);
      if (!dbSourceId || !dbTargetId) { return null; }

      return { ...r, sourceId: dbSourceId, targetId: dbTargetId };
    }).filter((r): r is GraphRelationship => r !== null);

    await this.storage.saveGraphRelationships(mappedRels);

    const stats = await this.storage.getGraphStats();
    log(`Graph built: ${String(stats.entityCount)} entities, ${String(stats.relationshipCount)} relationships, ${String(stats.observationCount)} observations`);
    return stats;
  }
}

function extractModuleName(filePath: string): string {
  const parts = filePath.split('/').filter(Boolean);
  if (parts.length <= 2) { return filePath; }
  return parts.slice(0, 2).join('/');
}

function extractImports(repoPath: string, getOrCreate: (name: string, type: string, props?: Record<string, unknown>) => number): GraphRelationship[] {
  const rels: GraphRelationship[] = [];
  const importRegex = /(?:import\s+.*\s+from\s+['"](.+?)['"]|require\(['"](.+?)['"]\))/g;

  try {
    const files = collectSourceFiles(repoPath);
    for (const file of files.slice(0, 500)) {
      const content = readFileSync(file, 'utf-8');
      const fileModule = extractModuleName(file.replace(repoPath, '').replace(/^\//, ''));
      let match: RegExpExecArray | null = importRegex.exec(content);
      while (match !== null) {
        const imported = match[1] ?? match[2] ?? '';
        if (imported.startsWith('.')) {
          const resolvedDir = dirname(file);
          const resolvedPath = join(resolvedDir, imported).replace(repoPath, '').replace(/^\//, '');
          const importedModule = extractModuleName(resolvedPath);
          if (importedModule !== fileModule) {
            const fromId = getOrCreate(fileModule, 'module', {});
            const toId = getOrCreate(importedModule, 'module', {});
            rels.push({ sourceId: fromId, targetId: toId, type: 'imports', weight: 1, source: 'structural', properties: {} });
          }
        }
        match = importRegex.exec(content);
      }
    }
  } catch {
    /* repo may not be accessible */
  }
  return rels;
}

function extractPackageDeps(repoPath: string, getOrCreate: (name: string, type: string, props?: Record<string, unknown>) => number): GraphRelationship[] {
  const rels: GraphRelationship[] = [];
  const pkgPath = join(repoPath, 'package.json');

  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
      const projectName = typeof pkg['name'] === 'string' ? pkg['name'] : 'project';
      const projectId = getOrCreate(projectName, 'package', {});

      const rawDeps = (pkg['dependencies'] as Record<string, string> | undefined) ?? {};
      const rawDevDeps = (pkg['devDependencies'] as Record<string, string> | undefined) ?? {};
      const deps = { ...rawDeps, ...rawDevDeps };
      for (const depName of Object.keys(deps)) {
        const depId = getOrCreate(depName, 'package', {});
        rels.push({ sourceId: projectId, targetId: depId, type: 'depends_on_pkg', weight: 1, source: 'structural', properties: {} });
      }
    } catch {
      /* invalid package.json */
    }
  }

  return rels;
}

function collectSourceFiles(dir: string, depth = 0): string[] {
  if (depth > 5) { return []; }
  const files: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') {
        continue;
      }
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...collectSourceFiles(fullPath, depth + 1));
      } else if (/\.(ts|js|tsx|jsx|py|java|kt|rs)$/.test(entry.name)) {
        files.push(fullPath);
      }
    }
  } catch {
    /* permission denied etc */
  }
  return files;
}
