export const CONSTRAINTS: readonly string[] = [
  `CREATE CONSTRAINT code_project_id IF NOT EXISTS FOR (p:Project) REQUIRE p.id IS UNIQUE`,
  `CREATE CONSTRAINT code_file_unique IF NOT EXISTS FOR (f:File) REQUIRE (f.projectId, f.path) IS UNIQUE`,
  `CREATE CONSTRAINT code_symbol_unique IF NOT EXISTS FOR (s:Symbol) REQUIRE (s.projectId, s.qualifiedName) IS UNIQUE`,
  `CREATE INDEX code_symbol_name IF NOT EXISTS FOR (s:Symbol) ON (s.projectId, s.name)`,
  `CREATE INDEX code_symbol_kind IF NOT EXISTS FOR (s:Symbol) ON (s.projectId, s.kind)`,
  `CREATE INDEX code_symbol_layer IF NOT EXISTS FOR (s:Symbol) ON (s.projectId, s.layer)`,
];

export const MERGE_PROJECT = `
  MERGE (p:Project {id: $id})
  SET p.name = $name, p.root = $root, p.language = $language
`;

export const MERGE_FILES = `
  UNWIND $rows AS r
  MATCH (p:Project {id: r.projectId})
  MERGE (f:File {projectId: r.projectId, path: r.path})
  SET f.language = r.language, f.layer = r.layer, f.hash = r.hash, f.gitSha = r.gitSha
  MERGE (f)-[:IN_PROJECT]->(p)
`;

export const DELETE_FILE = `
  MATCH (f:File {projectId: $projectId, path: $path})
  OPTIONAL MATCH (s:Symbol {projectId: $projectId, filePath: $path})
  DETACH DELETE s, f
`;

export const REPLACE_FILE_SYMBOLS_DELETE = `
  MATCH (s:Symbol {projectId: $projectId, filePath: $filePath})
  DETACH DELETE s
`;

export const MERGE_SYMBOLS = `
  UNWIND $rows AS r
  MATCH (f:File {projectId: r.projectId, path: r.filePath})
  MERGE (s:Symbol {projectId: r.projectId, qualifiedName: r.qualifiedName})
  SET s.name = r.name, s.kind = r.kind, s.filePath = r.filePath,
      s.startLine = r.startLine, s.endLine = r.endLine,
      s.signature = r.signature, s.visibility = r.visibility, s.layer = r.layer
  MERGE (s)-[:DEFINED_IN]->(f)
`;

export const MERGE_IMPORTS = `
  UNWIND $rows AS r
  MATCH (a:File {projectId: r.projectId, path: r.fromFile})
  MATCH (b:File {projectId: r.projectId, path: r.toFile})
  MERGE (a)-[rel:IMPORTS]->(b)
  SET rel.names = r.names
`;

export const MERGE_CALLS = `
  UNWIND $rows AS r
  MATCH (a:Symbol {projectId: r.projectId, qualifiedName: r.fromQn})
  MATCH (b:Symbol {projectId: r.projectId, qualifiedName: r.toQn})
  MERGE (a)-[rel:CALLS]->(b)
  SET rel.count = r.count
`;

export const MERGE_IMPLEMENTS = `
  UNWIND $rows AS r
  MATCH (a:Symbol {projectId: r.projectId, qualifiedName: r.classQn})
  MATCH (b:Symbol {projectId: r.projectId, qualifiedName: r.interfaceQn})
  MERGE (a)-[:IMPLEMENTS]->(b)
`;

export const MERGE_EXTENDS = `
  UNWIND $rows AS r
  MATCH (a:Symbol {projectId: r.projectId, qualifiedName: r.childQn})
  MATCH (b:Symbol {projectId: r.projectId, qualifiedName: r.parentQn})
  MERGE (a)-[:EXTENDS]->(b)
`;

export const MERGE_INJECTS = `
  UNWIND $rows AS r
  MATCH (a:Symbol {projectId: r.projectId, qualifiedName: r.consumerQn})
  MATCH (b:Symbol {projectId: r.projectId, qualifiedName: r.providerQn})
  MERGE (a)-[:INJECTS]->(b)
`;

export const FIND_SYMBOL = `
  MATCH (s:Symbol {projectId: $projectId})
  WHERE toLower(s.name) CONTAINS toLower($query)
    AND ($kind IS NULL OR s.kind = $kind)
    AND ($layer IS NULL OR s.layer = $layer)
  RETURN s
  ORDER BY size(s.name) ASC, s.name
  LIMIT $limit
`;

export const GET_DEPENDENCIES = `
  MATCH (f:File {projectId: $projectId, path: $file})-[:IMPORTS*1..]->(t:File)
  RETURN DISTINCT t
  LIMIT $maxRows
`;

export const GET_DEPENDENTS = `
  MATCH (t:File)-[:IMPORTS*1..]->(f:File {projectId: $projectId, path: $file})
  RETURN DISTINCT t
  LIMIT $maxRows
`;

export const GET_CALLERS = `
  MATCH (caller:Symbol)-[:CALLS*1..]->(target:Symbol {projectId: $projectId, qualifiedName: $qn})
  RETURN DISTINCT caller
  LIMIT $maxRows
`;

export const GET_CALLEES = `
  MATCH (source:Symbol {projectId: $projectId, qualifiedName: $qn})-[:CALLS*1..]->(callee:Symbol)
  RETURN DISTINCT callee
  LIMIT $maxRows
`;

export const CALL_PATH = `
  MATCH p = shortestPath(
    (a:Symbol {projectId: $projectId, qualifiedName: $from})
    -[:CALLS*..15]->
    (b:Symbol {projectId: $projectId, qualifiedName: $to})
  )
  RETURN nodes(p) AS path
`;

export const ARCH_VIOLATIONS = `
  MATCH (a:Symbol {projectId: $projectId})-[:CALLS]->(b:Symbol {projectId: $projectId})
  WHERE a.layer IS NOT NULL AND b.layer IS NOT NULL
    AND (
      (a.layer = 'domain' AND b.layer IN ['infrastructure', 'presentation'])
      OR (a.layer = 'application' AND b.layer = 'presentation')
    )
  RETURN a, b
  LIMIT 500
`;

export const UNUSED_EXPORTS = `
  MATCH (s:Symbol {projectId: $projectId})
  WHERE NOT (s)<-[:CALLS]-() AND NOT (s)<-[:IMPLEMENTS]-() AND NOT (s)<-[:EXTENDS]-()
  RETURN s
  LIMIT 500
`;

export const IMPLEMENTERS = `
  MATCH (impl:Symbol)-[:IMPLEMENTS]->(iface:Symbol {projectId: $projectId, qualifiedName: $interfaceQn})
  RETURN impl
`;

export const LAYER_SYMBOLS = `
  MATCH (s:Symbol {projectId: $projectId, layer: $layer})
  RETURN s
  LIMIT 1000
`;

export const DELETE_PROJECT = `
  MATCH (p:Project {id: $projectId})
  OPTIONAL MATCH (f:File {projectId: $projectId})
  OPTIONAL MATCH (s:Symbol {projectId: $projectId})
  DETACH DELETE s, f, p
`;
