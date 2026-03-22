---
name: update-docs
description: "Verify and regenerate Argustack PDF documentation in Docs/PaperLink/. Diffs recent git changes against the five doc files, checks source code for discrepancies, fixes markdown, bumps versions, and regenerates PDFs via md-to-pdf. Use after any feature implementation, code update, or version bump — especially when files in src/mcp/tools/, src/cli/, src/core/, src/adapters/postgres/schema.ts, or package.json have changed. Also trigger when the user says 'update docs', 'regenerate PDFs', 'verify documentation', 'docs out of date', or '/update-docs'."
---

# Update Argustack Documentation

After a feature lands or code changes ship, verify the docs still match reality, fix anything that drifted, and regenerate the PDFs.

## What Changed?

Start by figuring out what actually changed. Run a diff against the last known-good state:

```bash
git diff HEAD~5 --name-only          # recent file changes
git log --oneline -10                 # recent commit messages
```

Focus on changes in these areas — they're the ones that affect documentation:

| Changed files | Docs to check |
|--------------|---------------|
| `src/cli/index.ts`, `src/cli/sync.ts` | Quick Start Guide |
| `src/mcp/tools/*.ts` | MCP Tools Reference, Use Cases |
| `src/adapters/postgres/schema.ts` | MCP Tools Reference, Architecture Guide |
| `src/core/ports/*.ts`, `src/core/types/*.ts` | Architecture Guide |
| `src/mcp/tools/estimate.ts` | Estimate Deep Dive |
| `package.json` (version, engines) | All docs (version line + prerequisites) |
| `src/` structure (new/renamed files) | Architecture Guide |

If nothing documentation-relevant changed, say so and stop.

## Documents

All live in `Docs/PaperLink/`:

| Document | Verified against |
|----------|-----------------|
| `Argustack Quick Start Guide.md` | `src/cli/index.ts` (flags), `package.json` (Node version), `src/cli/sync.ts` (sync commands) |
| `Argustack Use Cases.md` | MCP tool names from `src/mcp/tools/*.ts`, general accuracy |
| `Argustack MCP Tools Reference.md` | `src/mcp/tools/*.ts` (params, descriptions), `src/adapters/postgres/schema.ts` (column names) |
| `Argustack Architecture Guide.md` | `src/` directory tree, `src/core/ports/*.ts`, `src/adapters/postgres/schema.ts` |
| `Argustack Estimate Deep Dive.md` | `src/mcp/tools/estimate.ts` (algorithm, SQL, formulas, constants) |

## Step 1 — Verify

Only check the docs affected by the recent changes. For each one, read the source code and compare it against what the doc claims.

**Quick Start Guide**
- Node.js version matches `package.json` engines field
- CLI flags match `src/cli/index.ts` options exactly (e.g. `--git-repo`, not `--git-repo-paths`)
- All commands listed actually exist (`argustack sync`, `argustack embed`, etc.)
- MCP install instructions reflect current behavior

**MCP Tools Reference**
- Every tool name matches `server.registerTool()` calls in `src/mcp/tools/*.ts`
- Parameter names and types match each tool's `inputSchema`
- Required vs. optional aligns with the zod schema
- Database column names match `src/adapters/postgres/schema.ts` — watch for `issue_key` vs `key`

**Architecture Guide**
- Directory tree matches the actual `src/` layout
- Port interface names match `src/core/ports/*.ts`
- Adapter directories match `src/adapters/*/`
- Database column names match schema.ts

**Estimate Deep Dive**
- Scoring weights (0.3, 0.25, 0.35, 0.1) match the SQL in estimate.ts
- Familiarity factor formula matches `calculateFamiliarityFactor`
- Trim percentage in `calculateBaseHours` is accurate
- Outlier threshold (5.0) matches the coefficient SQL
- Minimum task count (3) matches the HAVING clause
- Data source priority chain matches the nullish coalescing chain

**Use Cases**
- Tool names mentioned are real tools that exist
- No references to features that don't exist yet

## Step 2 — Fix

For every discrepancy:
1. State what the doc says vs. what the code says
2. Update the markdown

Bump the `Version X.X.X` line on each cover page to match `package.json` version.

## Step 3 — Regenerate PDFs

Run for each updated document:

```bash
cd /Users/eugench/Projects/CodeStreamly/Argustack/Docs/PaperLink && \
npx md-to-pdf "FILENAME.md" \
  --stylesheet pdf-style.css \
  --pdf-options '{"format":"A4","margin":{"top":"18mm","bottom":"22mm","left":"18mm","right":"18mm"},"printBackground":true,"outline":true,"tagged":true,"displayHeaderFooter":true,"headerTemplate":"<span></span>","footerTemplate":"<div style=\"font-size:9px;color:#94a3b8;width:100%;padding:0 20mm;display:flex;justify-content:space-between\"><span>Argustack</span><span><span class=\"pageNumber\"></span>/<span class=\"totalPages\"></span></span></div>"}'
```

Generate PDFs one at a time — Puppeteer doesn't handle parallel runs well.

## Step 4 — Report

Wrap up with a summary table:

```
| Document | Discrepancies | Fixed | Pages |
|----------|--------------|-------|-------|
| Quick Start Guide | 0 | 0 | 11 |
| ...
```

## Writing Style

- Write like a senior tech writer: clear, direct, no fluff
- No emojis unless the doc already has them
- Code identifiers stay as-is; prose is in English
- Prefer tables over paragraphs
- Preserve existing document structure — don't rearrange sections
- Only touch content that's actually wrong; don't rewrite things that are fine
