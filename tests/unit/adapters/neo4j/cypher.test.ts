import { describe, it, expect } from 'vitest';
import {
  CONSTRAINTS,
  MERGE_PROJECT,
  MERGE_FILES,
  MERGE_SYMBOLS,
  MERGE_IMPORTS,
  MERGE_CALLS,
  MERGE_IMPLEMENTS,
  MERGE_EXTENDS,
  MERGE_INJECTS,
  FIND_SYMBOL,
  GET_DEPENDENCIES,
  GET_DEPENDENTS,
  GET_CALLERS,
  GET_CALLEES,
  CALL_PATH,
  ARCH_VIOLATIONS,
  UNUSED_EXPORTS,
  IMPLEMENTERS,
  LAYER_SYMBOLS,
  DELETE_PROJECT,
  DELETE_FILE,
  REPLACE_FILE_SYMBOLS_DELETE,
} from '../../../../src/adapters/neo4j/cypher.js';

describe('Neo4j Cypher SSOT', () => {
  it('declares 6 constraints/indexes (project, file, symbol uniqueness + 3 lookup indexes)', () => {
    expect(CONSTRAINTS).toHaveLength(6);
    expect(CONSTRAINTS[0]).toContain('CREATE CONSTRAINT code_project_id');
    expect(CONSTRAINTS[1]).toContain('code_file_unique');
    expect(CONSTRAINTS[2]).toContain('code_symbol_unique');
  });

  it('MERGE_PROJECT upserts by id', () => {
    expect(MERGE_PROJECT).toContain('MERGE (p:Project {id: $id})');
    expect(MERGE_PROJECT).toContain('p.name = $name');
  });

  it('MERGE_FILES uses UNWIND for batch', () => {
    expect(MERGE_FILES).toContain('UNWIND $rows AS r');
    expect(MERGE_FILES).toContain('MERGE (f:File {projectId: r.projectId, path: r.path})');
    expect(MERGE_FILES).toContain('MERGE (f)-[:IN_PROJECT]->(p)');
  });

  it('MERGE_SYMBOLS upserts symbols and links to file', () => {
    expect(MERGE_SYMBOLS).toContain('MERGE (s:Symbol {projectId: r.projectId, qualifiedName: r.qualifiedName})');
    expect(MERGE_SYMBOLS).toContain('MERGE (s)-[:DEFINED_IN]->(f)');
  });

  it('MERGE_IMPORTS / MERGE_CALLS / MERGE_IMPLEMENTS / MERGE_EXTENDS / MERGE_INJECTS use UNWIND', () => {
    for (const cy of [MERGE_IMPORTS, MERGE_CALLS, MERGE_IMPLEMENTS, MERGE_EXTENDS, MERGE_INJECTS]) {
      expect(cy).toContain('UNWIND $rows AS r');
    }
  });

  it('FIND_SYMBOL filters by projectId + name + optional kind/layer', () => {
    expect(FIND_SYMBOL).toContain('MATCH (s:Symbol {projectId: $projectId})');
    expect(FIND_SYMBOL).toContain('CONTAINS toLower($query)');
    expect(FIND_SYMBOL).toContain('$kind IS NULL OR s.kind = $kind');
    expect(FIND_SYMBOL).toContain('$layer IS NULL OR s.layer = $layer');
    expect(FIND_SYMBOL).toContain('LIMIT $limit');
  });

  it('GET_DEPENDENCIES traverses IMPORTS forward', () => {
    expect(GET_DEPENDENCIES).toContain('-[:IMPORTS*1..]->');
  });

  it('GET_DEPENDENTS traverses IMPORTS backward', () => {
    expect(GET_DEPENDENTS).toContain('-[:IMPORTS*1..]->(f:File {projectId: $projectId, path: $file})');
  });

  it('GET_CALLERS traverses CALLS up', () => {
    expect(GET_CALLERS).toContain('-[:CALLS*1..]->(target:Symbol {projectId: $projectId, qualifiedName: $qn})');
  });

  it('GET_CALLEES traverses CALLS down', () => {
    expect(GET_CALLEES).toContain('(source:Symbol {projectId: $projectId, qualifiedName: $qn})-[:CALLS*1..]->');
  });

  it('CALL_PATH uses shortestPath', () => {
    expect(CALL_PATH).toContain('shortestPath');
    expect(CALL_PATH).toContain('-[:CALLS*..15]->');
  });

  it('ARCH_VIOLATIONS detects domain → infra/presentation and application → presentation', () => {
    expect(ARCH_VIOLATIONS).toContain("a.layer = 'domain'");
    expect(ARCH_VIOLATIONS).toContain("'infrastructure', 'presentation'");
    expect(ARCH_VIOLATIONS).toContain("a.layer = 'application'");
  });

  it('UNUSED_EXPORTS finds symbols with no inbound CALLS / IMPLEMENTS / EXTENDS', () => {
    expect(UNUSED_EXPORTS).toContain('NOT (s)<-[:CALLS]-()');
    expect(UNUSED_EXPORTS).toContain('NOT (s)<-[:IMPLEMENTS]-()');
    expect(UNUSED_EXPORTS).toContain('NOT (s)<-[:EXTENDS]-()');
  });

  it('IMPLEMENTERS finds classes that implement an interface', () => {
    expect(IMPLEMENTERS).toContain('(impl:Symbol)-[:IMPLEMENTS]->(iface:Symbol');
  });

  it('LAYER_SYMBOLS filters by exact layer', () => {
    expect(LAYER_SYMBOLS).toContain('(s:Symbol {projectId: $projectId, layer: $layer})');
  });

  it('DELETE_PROJECT removes Project + cascades to files + symbols', () => {
    expect(DELETE_PROJECT).toContain('MATCH (p:Project {id: $projectId})');
    expect(DELETE_PROJECT).toContain('DETACH DELETE s, f, p');
  });

  it('DELETE_FILE removes file + its symbols', () => {
    expect(DELETE_FILE).toContain('MATCH (f:File {projectId: $projectId, path: $path})');
    expect(DELETE_FILE).toContain('DETACH DELETE s, f');
  });

  it('REPLACE_FILE_SYMBOLS_DELETE wipes symbols defined in a file', () => {
    expect(REPLACE_FILE_SYMBOLS_DELETE).toContain('MATCH (s:Symbol {projectId: $projectId, filePath: $filePath})');
    expect(REPLACE_FILE_SYMBOLS_DELETE).toContain('DETACH DELETE s');
  });

  describe('snapshots (lock against accidental changes)', () => {
    it('MERGE_SYMBOLS shape', () => {
      expect(MERGE_SYMBOLS).toMatchSnapshot();
    });

    it('CALL_PATH shape', () => {
      expect(CALL_PATH).toMatchSnapshot();
    });

    it('ARCH_VIOLATIONS shape', () => {
      expect(ARCH_VIOLATIONS).toMatchSnapshot();
    });
  });
});
