# Development Policies - Critical Rules

## Critical Development Policies

### NEVER DO WITHOUT PERMISSION:

- **NO `git add`, `git commit`, `git push`, `git merge`** without explicit user permission
- **NO `git commit --no-verify`** — ALWAYS run pre-commit hooks
- **NO `npm run`, `npm install`, `npm update`** without explicit user permission
- **NO adding code/interfaces/types** from yourself without user request
- **NO proactive changes** to existing code structure

### WHAT YOU CAN DO:

- **CAN** view git status, diff, log for analysis
- **CAN** read files to understand structure
- **MUST** ask user before any modifications

---

## Commit Message Rules

- **NO AI SIGNATURES:** No `Generated with Claude Code` or `Co-Authored-By: Claude`
- **FORMAT:** `type: description` — e.g., `feat: add MCP server tools`
- **Types:** `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`
- **No character limits** — write as much as needed to describe the changes

---

## Git Push Workflow

### Three Flows

| User says | What it means | Flow |
|-----------|--------------|------|
| "push", "commit", "upload to git" | Push current branch | **Push Flow** |
| "deploy", "to production", "to main" | Deploy to production via PR | **Production Flow** |

### Push Flow (commit + push)

**Detect current branch first.** Push behavior depends on where you are:

| Current branch | Action |
|---------------|--------|
| `staging` | Commit + push to `staging` |
| `feature/*` or worktree | Commit + push to current branch, then merge into `staging` and push `staging` |
| `main` | **NEVER commit directly to main.** Switch to staging first |

```bash
# On staging:
git add . && git commit -m "type: descriptive message" && git push origin staging

# On feature branch / worktree:
git add . && git commit -m "type: descriptive message" && git push origin HEAD && git checkout staging && git merge BRANCH_NAME && git push origin staging && git checkout BRANCH_NAME
```

**Requirements:**
1. **Single command** — commit + push in one chain
2. **Real commit message** — descriptive, explains what was actually done
3. **Code ends up on `staging`** — NEVER push directly to `main`

### Production Flow (PR-based deploy)

**NEVER merge directly into `main`.** Always via Pull Request.

**Step 1:** Ensure all changes are on `staging`
**Step 2:** Create PR `staging` → `main`:
```bash
gh pr create --base main --head staging --title "type: description" --body "$(cat <<'EOF'
## Summary
- Change 1
- Change 2

## Checks
- [ ] All tests passing
- [ ] TypeScript clean
EOF
)"
```

**Step 3:** Show PR URL to user — **wait for confirmation**.

**Step 4:** Only after user confirms:
```bash
gh pr merge --squash --delete-branch=false
```

**Step 5:** Sync staging with main after squash merge:
```bash
git checkout staging && git pull origin main --rebase && git push origin staging --force-with-lease
```

**PR Rules:**
- **`--delete-branch=false`** — NEVER delete `staging` branch after merge
- If open PR already exists, reuse it

---

## Code Comments Rules

**ONLY TSDoc. No inline comments. Types > Comments.**

| Forbidden | Allowed |
|-----------|---------|
| `// TODO: fix later` | TSDoc `/** ... */` |
| `// This replaces old method` | Nothing else |

**Core principle:** If TypeScript types + good naming explain the code — no TSDoc needed. TSDoc is for **business rules that types cannot express**.

---

## TSDoc Per Clean Architecture Layer

| Layer | TSDoc? | What to document |
|-------|--------|------------------|
| **Core types** (`core/types/`) | Interfaces self-document | Only non-obvious constraints |
| **Core ports** (`core/ports/`) | Contract + `@throws` | Method purpose, error conditions |
| **Use Cases** | `@param` + `@returns` + `@throws` | Business operation purpose |
| **Adapters** (`adapters/`) | No | Implements port contract |
| **CLI** | No | User-facing, self-explanatory |
| **MCP server** | Tool descriptions only | Via McpServer tool registration |
