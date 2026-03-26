/**
 * Dependency Cruiser Configuration — Argustack
 *
 * Hexagonal Architecture (Ports & Adapters):
 *   core/          ← ZERO external dependencies (types + ports)
 *   adapters/      ← implements core/ports, depends only on core/
 *   use-cases/     ← depends only on core/ports, NOT on adapters
 *   cli/ + mcp/    ← driving adapters, depends on everything (composition root)
 *   board/         ← React SPA, does NOT import from src/ (own types only)
 *
 * Run:
 *   npx depcruise src -T err
 *   npx depcruise src/core -T err
 */

/* eslint-disable no-undef */
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'core-no-adapters',
      severity: 'error',
      comment: 'Core layer must not depend on adapters — Dependency Rule',
      from: { path: '^src/core/' },
      to: { path: '^src/adapters/' },
    },
    {
      name: 'core-no-use-cases',
      severity: 'error',
      comment: 'Core layer must not depend on use cases',
      from: { path: '^src/core/' },
      to: { path: '^src/use-cases/' },
    },
    {
      name: 'core-no-cli',
      severity: 'error',
      comment: 'Core layer must not depend on CLI (driving adapter)',
      from: { path: '^src/core/' },
      to: { path: '^src/cli/' },
    },
    {
      name: 'core-no-mcp',
      severity: 'error',
      comment: 'Core layer must not depend on MCP (driving adapter)',
      from: { path: '^src/core/' },
      to: { path: '^src/mcp/' },
    },
    {
      name: 'core-no-board',
      severity: 'error',
      comment: 'Core layer must not depend on board SPA',
      from: { path: '^src/core/' },
      to: { path: '^src/board/' },
    },
    {
      name: 'core-no-workspace',
      severity: 'error',
      comment: 'Core layer must not depend on workspace infra',
      from: { path: '^src/core/' },
      to: { path: '^src/workspace/' },
    },

    {
      name: 'use-cases-no-adapters',
      severity: 'error',
      comment: 'Use cases must depend on core/ports, NOT on adapter implementations',
      from: { path: '^src/use-cases/' },
      to: { path: '^src/adapters/' },
    },
    {
      name: 'use-cases-no-cli',
      severity: 'error',
      comment: 'Use cases must not depend on CLI',
      from: { path: '^src/use-cases/' },
      to: { path: '^src/cli/' },
    },
    {
      name: 'use-cases-no-mcp',
      severity: 'error',
      comment: 'Use cases must not depend on MCP',
      from: { path: '^src/use-cases/' },
      to: { path: '^src/mcp/' },
    },
    {
      name: 'use-cases-no-board',
      severity: 'error',
      comment: 'Use cases must not depend on board SPA',
      from: { path: '^src/use-cases/' },
      to: { path: '^src/board/' },
    },

    {
      name: 'adapters-no-cli',
      severity: 'error',
      comment: 'Adapters must not depend on CLI (driving adapter)',
      from: { path: '^src/adapters/' },
      to: { path: '^src/cli/' },
    },
    {
      name: 'adapters-no-mcp',
      severity: 'error',
      comment: 'Adapters must not depend on MCP (driving adapter)',
      from: { path: '^src/adapters/' },
      to: { path: '^src/mcp/' },
    },
    {
      name: 'adapters-no-board',
      severity: 'error',
      comment: 'Adapters must not depend on board SPA',
      from: { path: '^src/adapters/' },
      to: { path: '^src/board/' },
    },
    {
      name: 'adapters-no-use-cases',
      severity: 'error',
      comment: 'Adapters must not depend on use cases',
      from: { path: '^src/adapters/' },
      to: { path: '^src/use-cases/' },
    },

    {
      name: 'core-no-pg',
      severity: 'error',
      comment: 'Core must not import pg (database-specific)',
      from: { path: '^src/core/' },
      to: { path: '^pg$' },
    },
    {
      name: 'core-no-jira',
      severity: 'error',
      comment: 'Core must not import jira.js (adapter-specific)',
      from: { path: '^src/core/' },
      to: { path: '^jira\\.js' },
    },
    {
      name: 'core-no-octokit',
      severity: 'error',
      comment: 'Core must not import octokit (adapter-specific)',
      from: { path: '^src/core/' },
      to: { path: '^@octokit' },
    },
    {
      name: 'core-no-openai',
      severity: 'error',
      comment: 'Core must not import openai (adapter-specific)',
      from: { path: '^src/core/' },
      to: { path: '^openai' },
    },
    {
      name: 'core-no-express',
      severity: 'error',
      comment: 'Core must not import express (framework-specific)',
      from: { path: '^src/core/' },
      to: { path: '^express' },
    },

    {
      name: 'use-cases-no-pg',
      severity: 'error',
      comment: 'Use cases must not import pg directly',
      from: { path: '^src/use-cases/' },
      to: { path: '^pg$' },
    },
    {
      name: 'use-cases-no-jira',
      severity: 'error',
      comment: 'Use cases must not import jira.js directly',
      from: { path: '^src/use-cases/' },
      to: { path: '^jira\\.js' },
    },

    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies are forbidden',
      from: {},
      to: { circular: true },
    },

    {
      name: 'not-to-test',
      severity: 'error',
      comment: 'Production code must not import test files',
      from: { pathNot: '^(tests)' },
      to: { path: '^(tests)' },
    },
    {
      name: 'not-to-spec',
      severity: 'error',
      from: {},
      to: { path: '[.](?:spec|test)[.](?:js|mjs|cjs|ts|mts|cts|tsx)$' },
    },
  ],
  options: {
    doNotFollow: {
      path: ['node_modules'],
      dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-bundled', 'npm-no-pkg'],
    },
    exclude: {
      path: ['dist/', '\\.d\\.ts$', 'src/board/'],
    },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['main', 'types', 'typings'],
    },
    cache: {
      folder: 'node_modules/.cache/dependency-cruiser',
      strategy: 'metadata',
    },
    reporterOptions: {
      dot: {
        collapsePattern: 'node_modules/(?:@[^/]+/[^/]+|[^/]+)',
      },
    },
  },
};
