export type CodeLayer =
  | 'domain'
  | 'application'
  | 'infrastructure'
  | 'presentation';

export type CodeSymbolKind =
  | 'function'
  | 'class'
  | 'method'
  | 'interface'
  | 'type'
  | 'enum'
  | 'const'
  | 'component';

export type CodeLanguage = 'typescript' | 'tsx' | 'javascript' | 'jsx';

export interface CodeProject {
  id: string;
  name: string;
  root: string;
  language: CodeLanguage;
  layerConfig?: Record<string, CodeLayer>;
  excludes?: string[];
  createdAt?: string;
  lastIndexedAt?: string;
}

export interface CodeFile {
  projectId: string;
  path: string;
  language: CodeLanguage;
  layer: CodeLayer | null;
  hash: string;
  gitSha?: string;
  indexedAt?: string;
}

export interface CodeSymbol {
  projectId: string;
  qualifiedName: string;
  name: string;
  kind: CodeSymbolKind;
  filePath: string;
  startLine: number;
  endLine: number;
  signature?: string;
  visibility?: 'public' | 'private' | 'protected';
  layer?: CodeLayer | null;
}

export interface CodeImport {
  projectId: string;
  fromFile: string;
  toFile: string;
  names: string[];
}

export interface CodeCallEdge {
  projectId: string;
  fromQn: string;
  toQn: string;
  count: number;
}

export interface CodeImplementsEdge {
  projectId: string;
  classQn: string;
  interfaceQn: string;
}

export interface CodeExtendsEdge {
  projectId: string;
  childQn: string;
  parentQn: string;
}

export interface CodeInjectsEdge {
  projectId: string;
  consumerQn: string;
  providerQn: string;
}

export interface CodeChunk {
  symbolId: string;
  projectId: string;
  filePath: string;
  name: string;
  kind: CodeSymbolKind;
  layer: CodeLayer | null;
  startLine: number;
  endLine: number;
  content: string;
}

export type IndexJobType = 'full' | 'incremental' | 'file';
export type IndexJobStatus = 'running' | 'completed' | 'failed';

export interface IndexJob {
  id: number;
  projectId: string;
  type: IndexJobType;
  status: IndexJobStatus;
  startedAt: string;
  completedAt?: string;
  stats?: IndexStats;
  error?: string;
}

export interface IndexStats {
  filesIndexed: number;
  symbolsCreated: number;
  edgesCreated: number;
  chunksCreated: number;
  embeddingTokens: number;
  durationMs: number;
}

export interface CodeFileHash {
  path: string;
  hash: string;
  gitSha?: string;
}

export interface LspSymbol {
  name: string;
  kind: number;
  filePath: string;
  startLine: number;
  endLine: number;
  containerName?: string;
}

export interface LspLocation {
  uri: string;
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
}

export interface ParsedFile {
  filePath: string;
  language: CodeLanguage;
  symbols: CodeSymbol[];
  imports: CodeImport[];
  rawCalls: RawCallSite[];
}

export interface RawCallSite {
  fromQn: string;
  calleeText: string;
  line: number;
  column: number;
}

export interface SemanticHit {
  symbolId: string;
  score: number;
  payload: SemanticHitPayload;
}

export interface SemanticHitPayload {
  projectId: string;
  filePath: string;
  layer: CodeLayer | null;
  kind: CodeSymbolKind;
  name: string;
  startLine: number;
  endLine: number;
  content?: string;
}

export interface PlanFeatureFilesResult {
  domain: PlannedFile[];
  application: PlannedFile[];
  infrastructure: PlannedFile[];
  presentation: PlannedFile[];
}

export interface PlannedFile {
  filePath: string;
  reason: string;
  similarTo?: string;
  score: number;
}
