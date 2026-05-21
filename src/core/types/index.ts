export type {
  Issue,
  IssueComment,
  IssueChangelog,
  IssueWorklog,
  IssueLink,
  IssueBatch,
  HybridSearchResult,
} from './issue.js';

export type { Project } from './project.js';

export type {
  Commit,
  CommitFile,
  CommitIssueRef,
  CommitBatch,
  GitRef,
} from './git.js';

export type {
  PullRequest,
  PullRequestReview,
  PullRequestComment,
  PullRequestFile,
  PullRequestIssueRef,
  Release,
  GitHubBatch,
} from './github.js';

export type {
  SourceType,
  SourceConfig,
  WorkspaceConfig,
} from './config.js';

export { SOURCE_META, ALL_SOURCES } from './config.js';

export type {
  Workspace,
  WorkspaceSettings,
  DbSourceConfig,
  GitHubRepoConfig,
  CsvFileConfig,
} from './workspace.js';

export type {
  PreflightResult,
  LlmProvider,
  LlmSetupPlan,
} from './init.js';

export type {
  DbEngine,
  DbTable,
  DbColumn,
  DbForeignKey,
  DbIndex,
  DbSchemaBatch,
} from './database.js';

export type {
  ProxyConfig,
  ProxyAuth,
  ProxyEndpoint,
  ProxyEndpoints,
  ProxyFieldMapping,
} from './proxy-config.js';

export type {
  GraphEntity,
  GraphRelationship,
  GraphObservation,
  GraphQueryResult,
  GraphStats,
} from './graph.js';

export type {
  CodeLayer,
  CodeSymbolKind,
  CodeLanguage,
  CodeProject,
  CodeFile,
  CodeSymbol,
  CodeImport,
  CodeCallEdge,
  CodeImplementsEdge,
  CodeExtendsEdge,
  CodeInjectsEdge,
  CodeChunk,
  IndexJob,
  IndexJobType,
  IndexJobStatus,
  IndexStats,
  CodeFileHash,
  LspSymbol,
  LspLocation,
  ParsedFile,
  RawCallSite,
  SemanticHit,
  SemanticHitPayload,
  PlanFeatureFilesResult,
  PlannedFile,
} from './code.js';
