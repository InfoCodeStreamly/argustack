---
name: verify-technical-plan
description: "Verifies an existing Technical Plan against Argustack's real codebase. Goes layer-by-layer checking file paths, method names, field names, and Hexagonal Architecture compliance. Finds MISSED files, methods, and dependencies. Corrects the plan directly. Designed for 1-3 passes until the plan is complete. Use after /create-technical-plan — or when the user says 'verify plan', 'check the plan', 'перевір план', 'верифікація', 'is the plan correct'."
argument-hint: "[path to .md file with Technical Plan]"
---

# Technical Plan Verifier — Argustack

Re-reads the real codebase layer-by-layer and checks the Technical Plan against it. Finds what was MISSED — files, methods, fields, dependencies. Corrects the plan directly.

**Designed for multiple passes.** Run 1-3 times until nothing is missed. Each pass catches things previous passes overlooked.

**Ground rules:**
- **Read real code** — `tree` to see structure, `Read` to see content. Every correction based on what actually exists
- **Hexagonal Architecture** — all 5 phases for every feature. Challenge any "NO CHANGES" that seems wrong
- **Dependency Rule** — `cli/,mcp/ → use-cases/ → core/ports` ← `adapters/`. Flag any import direction violations
- **Paths from `src/`** — all file paths relative to project root

## Workflow

### Step 1: Load the Plan

If `$ARGUMENTS` is a file path — read it directly.

Otherwise:
```bash
ls Docs/Tasks/ToDo/
```

Ask the user which plan to verify. Read the full file — both business requirement and Technical Plan sections.

### Step 2: Layer-by-Layer Verification

For EACH phase in the Technical Plan:

```
1. TREE   → tree the actual layer directory
2. READ   → Read every file mentioned in this phase's table
3. CHECK  → Compare plan vs reality (see Checks below)
4. FIX    → Correct discrepancies directly in the plan
5. NEXT   → Move to next phase only after current is checked
```

#### Phase 1: Verify Core Layer
```bash
tree src/core/ -L 3
```
- Read each file listed in Phase 1 table
- Verify: type names exist, interface methods match, field types accurate
- **MISSED?** Types that should exist but aren't planned, ports that need updating, re-exports

#### Phase 2: Verify Adapters Layer
```bash
tree src/adapters/ -L 3
```
- Read each file listed in Phase 2 table
- Verify: provider class names, mapper functions, storage methods, schema columns
- **MISSED?** Schema changes in `postgres/schema.ts`, index files, client setup

Also check:
```bash
cat src/adapters/postgres/schema.ts  # if new tables mentioned
```

#### Phase 3: Verify Use Cases
```bash
tree src/use-cases/ -L 2
```
- Read each file listed in Phase 3 table
- Verify: use case class names, constructor signatures, execute method return types
- **MISSED?** Related use cases that need updating, new use cases implied by AC

#### Phase 4: Verify CLI + MCP
```bash
tree src/cli/ -L 3
tree src/mcp/ -L 3
```
- Read each file listed in Phase 4 table
- Verify: command names, tool registrations, init flow steps, wiring logic
- **MISSED?** MCP tool registrations in server.ts, init prompts, config parsing in workspace/

Also check:
```bash
cat src/workspace/config.ts        # new env var parsing?
cat src/core/types/config.ts       # new config types?
```

#### Phase 5: Verify Tests
```bash
tree tests/ -L 3 -d
```
- Read existing fixtures/fakes mentioned in the plan
- **MISSED?** Fixture factory functions in `test-constants.ts`, fake implementations for new ports, MCP tool tests, architecture test updates

### Step 3: What to Check

For EACH file row in the plan:

**Path check:**
- MODIFY/DELETE — file must exist. Read it to confirm method/field names are real
- CREATE — file must NOT exist. Parent directory must exist (or plan should note mkdir)

**What column check:**
- Method names actually exist in the file? (for MODIFY)
- Field types match what's in the code?
- Format follows plan rules? (e.g., `add methodName()`, not "update the provider")

**Hexagonal Architecture completeness:**
- New type in `core/types/` → port interface in `core/ports/`?
- New port → adapter implementation in `adapters/`?
- New adapter → use case that consumes it in `use-cases/`?
- New use case → CLI command or MCP tool in `cli/` or `mcp/`?
- New anything → test coverage in `tests/`?
- New provider → fake in `tests/fixtures/fakes/`?
- New types → factory function in `tests/fixtures/shared/test-constants.ts`?

**Dependency Rule violations:**
- Does any adapter import from `cli/` or `mcp/`? (WRONG)
- Does any use case import from `adapters/`? (WRONG — should use core/ports)
- Does `core/` import from anything outside `core/`? (WRONG)

**Missing items:**
- Files that SHOULD be in the plan but aren't
- Methods/fields the plan missed
- Side effects not accounted for (e.g., changing a type affects all its consumers)

### Step 4: Correct the Plan

For each issue found — fix it directly in the plan file:
- Wrong file path → correct path from `tree` output
- Wrong method name → correct name from file content
- Missing file → add row to the phase table
- Unnecessary file → remove row
- Wrong action (MODIFY but file doesn't exist → CREATE)
- What column too vague → add specific method/field names

Do NOT add verification markers (no "verified", no checkmarks, no timestamps). Just correct the content.

### Step 5: Format Check

After all layers, verify plan format:
- All 5 phases present (even if NO CHANGES)
- Actions are only CREATE, MODIFY, DELETE
- What column follows format rules
- No code snippets or implementation details
- Contracts present for CREATE files with business logic
- Database Schema section present
- Environment Variables section present
- Dependencies (npm) section present
- Performance Considerations section present

### Step 6: Cross-Check Against Acceptance Criteria

Re-read the Acceptance Criteria from the business requirement section. For each AC:
- Is there a corresponding file/method in the Technical Plan that implements it?
- If an AC has no coverage in the plan — flag it

This catches the "planned everything but forgot the actual feature" scenario.

## Output

After verification, summarize:
- **File:** path to plan
- **Pass:** Nth verification pass
- **Corrections:** N (briefly list each)
- **Missing items added:** N new rows
- **Removed items:** N rows removed
- **Format fixes:** N
- **AC coverage:** X/Y acceptance criteria have corresponding plan entries
- **Confidence:** High (plan looks complete) / Medium (another pass recommended) / Low (significant gaps found)
- **Next:** "Plan is solid — implement it" / "Run `/verify-technical-plan` again — [specific areas to re-check]"
