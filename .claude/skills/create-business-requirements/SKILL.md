---
name: create-business-requirements
description: "Creates business requirement documents (User Stories) for Argustack — open-source CLI tool for project analysis with Hexagonal Architecture (Ports & Adapters), MCP tools, and PostgreSQL storage. Determines the correct task category, asks clarifying questions about edge cases and scope, writes the requirement with acceptance criteria. Saves to Docs/Tasks/ToDo/, completed tasks move to Docs/Tasks/Done/. Use when the user wants to define a new feature, write acceptance criteria, create a user story, plan a feature, or says things like 'давай зробимо фічу', 'нова функціональність', 'бізнес вимоги', 'new feature', 'plan feature', 'user story'."
argument-hint: "[feature description]"
---

# Business Requirement Creator — Argustack

Create a business requirement in User Story format. Focus on **business value, user experience, edge cases**. Research comes AFTER the requirement is drafted — to validate feasibility, not to drive it.

## Workflow

### Step 1: Understand the Feature

If `$ARGUMENTS` provided — use as starting point. Otherwise ask:
- What problem does it solve for the user?
- Who is the target user (CLI user, MCP/Claude user, both)?
- What is the expected behavior?

### Step 2: Determine the Category

List existing task folders to understand context and avoid duplication:

```bash
ls Docs/Tasks/ToDo/
ls Docs/Tasks/Done/
ls Docs/Tasks/Backlog/
```

Determine which area the feature belongs to:
- **CLI** — new commands, improved UX, init/sync/status
- **MCP** — new tools, improved queries, Claude integration
- **Adapters** — new data sources (Jira, Git, GitHub, CSV, DB)
- **Core** — new types, ports, domain logic
- **Infrastructure** — database schema, embeddings, storage

### Step 3: Ask Clarifying Questions (Interactive)

**DO NOT just write the requirement.** First, collect decisions from the user using **AskUserQuestion tool**.

**FORMAT: Interactive decision cards, NOT text walls.**

For each decision area, use `AskUserQuestion` with:
- Clear question (ends with `?`)
- 2-4 concrete options with descriptions
- Mark recommended option with `(Recommended)` suffix in label
- Use `multiSelect: true` when choices are not mutually exclusive
- Batch up to 4 questions per AskUserQuestion call
- Multiple rounds if more than 4 decisions needed

**Decision categories to cover:**

**Functionality (always):**
- Scope boundaries — what's in vs out
- Business decisions — present as options, not open questions
- Integration with existing features/tools
- Edge cases — present your analysis, ask for confirmation

**Data & Storage (when relevant):**
- What new data needs to be stored?
- Schema changes needed?
- Backwards compatibility with existing workspaces

**User Experience (when feature has CLI/MCP interface):**
- CLI command structure
- MCP tool input/output format
- Error messages and edge case handling

**Success (always):**
- How do we know this feature works?

### Step 4: Write the Requirement

**File naming:** `{feature-slug}.md` — descriptive kebab-case name.

Save to:
```
Docs/Tasks/ToDo/{feature-slug}.md
```

Use the template below. **Adapt to the feature** — not every section is needed for every story.

### Step 5: Review with User

Present the written requirement for review. Expect iterations — the user may want to:
- Adjust acceptance criteria
- Add/remove edge cases
- Change scope boundaries
- Refine the approach

### Step 6: Organize & Clean Up

After the user approves:

**Remove duplicates:**
- Same criterion in both AC and Edge Cases — pick one place
- Overlapping items across sections — consolidate

**Logical structure:**
- AC ordered by priority (happy path first, then negative, then edge cases)
- Edge Cases ordered by likelihood

**Consistency:**
- Same terminology throughout
- AC format consistent ("User can..." not mixed with "System should...")

**Completeness check:**
- Every AC is testable
- Every Edge Case has a resolution
- Dependencies are actual blockers

Rewrite the file with the clean version.

### Step 7: Research (OPTIONAL — on user request)

**Only when the user asks** or when there are open questions about feasibility:

**Codebase research:**
```bash
tree src/ -L 2
```

**Context7 research** — for external libraries, APIs, or standards.

Add a **Research** section with findings.

## Template

```markdown
# {Story Title — business-oriented}

## User Story
**As a** {CLI user / Claude user / developer},
**I want to** {goal},
**so that** {benefit}.

## Business Goal
{1-3 sentences: what problem this solves, why it matters}

## User Flow

\`\`\`
{Step 1}
    |
    v
{Step 2}
    |
    v
{Step 3}
\`\`\`

## Acceptance Criteria
- [ ] {Observable behavior from user's perspective}
- [ ] {Negative criterion: "System does NOT allow..." / "User cannot..."}

## Key Decisions

| Question | Decision |
|----------|----------|
| {Decision point} | {Choice made and why} |

## Edge Cases
- {Edge case 1: what happens when...}
- {Edge case 2: what if user tries to...}

## Dependencies
- {Other features this depends on}

## Out of Scope
- {What is explicitly NOT included}

## Open Questions
- {Unresolved decisions}
```

## Content Guidelines

### ALWAYS INCLUDE:
- User Story (As a... I want... so that...)
- Business Goal
- Acceptance Criteria (observable, testable)

### INCLUDE WHEN RELEVANT:
- User Flows — for multi-step interactions
- Key Decisions — when business/technical choices were made
- Edge Cases — for non-obvious scenarios
- Dependencies — actual blockers
- Out of Scope — explicit boundaries

### ACCEPTANCE CRITERIA GUIDELINES:
- Each criterion independently testable
- Format: "User can..." / "System shows..." / "When X, then Y"
- Include negative criteria: "System does NOT allow..."
- Think about: validation, empty states, error messages
- Think about: what the user SEES, not how the system IMPLEMENTS it

### WRITING STYLE:
- Business-oriented titles (no technical jargon)
- Plain language throughout
- Tables for structured decisions

### AVOID:
- File paths, code references, imports
- Architecture layers (Domain, Application, Infrastructure)
- Database schema, migrations
- Type definitions, interfaces, code snippets

Technical Plan will be created SEPARATELY.

## Task Lifecycle

```
Docs/Tasks/Backlog/    ← ideas, not yet planned
Docs/Tasks/ToDo/       ← planned, ready for implementation
Docs/Tasks/Done/       ← completed (move here when done)
```

## Output

After creating the file, summarize:
- **Category:** CLI / MCP / Adapters / Core / Infrastructure
- **File:** path
- **Acceptance Criteria:** N items
- **Open Questions:** N items (if any)
- **Next steps:** implement, research feasibility, or refine further
