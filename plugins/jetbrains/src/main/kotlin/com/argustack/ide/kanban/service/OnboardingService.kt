package com.argustack.ide.kanban.service

import com.argustack.ide.shared.config.ArgustackSettings
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.project.Project
import java.io.File

private val LOG = logger<OnboardingService>()

@Service(Service.Level.PROJECT)
public class OnboardingService(
    private val project: Project,
) {

    public fun generateReadmeIfMissing() {
        val basePath = project.basePath ?: return
        val settings = ArgustackSettings.getInstance(project)
        val tasksDir = File(basePath, settings.tasksDir)
        val readmeFile = File(tasksDir, README_FILENAME)

        if (readmeFile.isFile && hasCurrentVersion(readmeFile)) return

        if (!tasksDir.exists()) {
            tasksDir.mkdirs()
        }

        readmeFile.writeText(buildReadmeContent(settings.tasksDir))
        LOG.info("OnboardingService: README created/updated at ${readmeFile.absolutePath}")

        com.intellij.openapi.vfs.LocalFileSystem.getInstance()
            .refreshAndFindFileByIoFile(tasksDir)
    }

    private fun hasCurrentVersion(file: File): Boolean {
        val lastLine = file.readLines().lastOrNull()?.trim() ?: return false
        return lastLine == "<!-- $VERSION_PREFIX$PLUGIN_VERSION -->"
    }

    private fun buildReadmeContent(tasksDirPath: String): String = buildString {
        appendOverview()
        appendBoardAndSkills()
        appendFolderStructure(tasksDirPath)
        appendCardFormat()
        appendEpicsAndWorkflows()
        appendArgustackCli()
        appendFooter()
        appendLine("<!-- $VERSION_PREFIX$PLUGIN_VERSION -->")
    }

    public companion object {
        private const val README_FILENAME: String = "README.md"
        private const val PLUGIN_VERSION: String = "0.2.2"
        private const val VERSION_PREFIX: String = "argustack-plugin:"

        public fun getInstance(project: Project): OnboardingService =
            project.getService(OnboardingService::class.java)
    }
}

private fun StringBuilder.appendOverview() {
    appendLine("# Argustack Board — Task Management for AI-Driven Development")
    appendLine()
    appendLine("This directory is managed by the **Argustack IDE Plugin** — a kanban board")
    appendLine("inside JetBrains IDE where columns are executable Claude Code skills.")
    appendLine()
    appendLine("When a developer drags a task card to a skill column, the plugin runs")
    appendLine("`claude /skill-name` with the card's `.md` file as context. This creates")
    appendLine("a visual pipeline: plan → implement → test → review → deploy.")
    appendLine()
}

private fun StringBuilder.appendBoardAndSkills() {
    appendLine("## How the Board Works")
    appendLine()
    appendLine("- **Cards** = Markdown files in this directory (one file = one task)")
    appendLine("- **Columns** = Claude Code skills from `.claude/skills/` (auto-discovered)")
    appendLine("- **Drag** a card to a skill column → Claude Code executes that skill on the task")
    appendLine("- **Backlog** and **Done** are system columns (not skills)")
    appendLine("- **+** button in Backlog creates a new card (`.md` file) and opens it in editor")
    appendLine()
    appendLine("### Connection to Claude Code Skills")
    appendLine()
    appendLine("Each folder in `.claude/skills/` with a `SKILL.md` file becomes a board column.")
    appendLine("The column name = skill folder name. Skills are invoked via `claude /skill-name`.")
    appendLine("The card's `.md` file is passed as the task context to the skill prompt.")
    appendLine("Skills are discovered automatically from both project and personal directories.")
    appendLine()
}

private fun StringBuilder.appendFolderStructure(tasksDirPath: String) {
    appendLine("## Folder Structure")
    appendLine()
    appendLine("```")
    appendLine("$tasksDirPath/")
    appendLine("├── Backlog/{epic}/     — tasks not yet started")
    appendLine("├── InProgress/{epic}/  — tasks currently being worked on")
    appendLine("├── Done/{epic}/        — completed tasks")
    appendLine("└── README.md           — this file (auto-generated, safe to edit)")
    appendLine("```")
    appendLine()
    appendLine("Moving a card between Backlog → InProgress → Done on the board")
    appendLine("**physically moves** the `.md` file between these directories.")
    appendLine("The file system is the source of truth — the board reflects it.")
    appendLine()
}

private fun StringBuilder.appendCardFormat() {
    appendLine("## Card Format")
    appendLine()
    appendLine("Each task is a Markdown file with optional YAML frontmatter:")
    appendLine()
    appendLine("```yaml")
    appendLine("---")
    appendLine("epic: Auth")
    appendLine("jiraKey: PAP-123")
    appendLine("createdAt: 2026-04-04T12:00:00Z")
    appendLine("---")
    appendLine("# Task Title")
    appendLine()
    appendLine("User story, acceptance criteria, technical plan — any markdown content.")
    appendLine("This is what Claude reads when a skill runs on this card.")
    appendLine("```")
    appendLine()
    appendCardCreation()
    appendCardAgentFormat()
}

private fun StringBuilder.appendCardCreation() {
    appendLine("### Creating Cards")
    appendLine()
    appendLine("Three ways to create a card:")
    appendLine("1. **Board UI** — click + in Backlog column, enter title")
    appendLine("2. **Claude / AI agent** — create a `.md` file in the correct folder (see below)")
    appendLine("3. **Manually** — create a `.md` file in any `{status}/{epic}/` folder")
    appendLine()
    appendLine("The board picks up any `.md` file in Backlog/, InProgress/, or Done/ subfolders.")
    appendLine("No fields are required. A file with just `# Title` and nothing else is valid.")
    appendLine()
}

private fun StringBuilder.appendCardAgentFormat() {
    appendLine("### Recommended format for AI agents")
    appendLine()
    appendLine("When creating a card programmatically, use this format:")
    appendLine()
    appendLine("```yaml")
    appendLine("---")
    appendLine("epic: {folder name where file is placed}")
    appendLine("jiraKey: {PAP-XXX if known, omit if not}")
    appendLine("createdAt: {ISO timestamp}")
    appendLine("---")
    appendLine("# {Task title — short, descriptive}")
    appendLine()
    appendLine("{Task description, acceptance criteria, or any context.}")
    appendLine("```")
    appendLine()
    appendLine("File name: `kebab-case-slug.md` (e.g., `fix-login-timeout.md`).")
    appendLine("Place in: `Backlog/{epic}/` for new tasks, `InProgress/{epic}/` for active work.")
    appendLine()
    appendLine("All frontmatter fields are optional:")
    appendLine("- `epic` — auto-detected from parent folder if omitted")
    appendLine("- `jiraKey` — linked Jira issue (e.g., PAP-123)")
    appendLine("- `createdAt` — ISO timestamp (auto-set by board UI)")
    appendLine()
}

private fun StringBuilder.appendEpicsAndWorkflows() {
    appendLine("## Epics")
    appendLine()
    appendLine("Epics are subfolders inside each status directory (Backlog/InProgress/Done).")
    appendLine("Same epic exists in all three. Create from the board's epic dropdown.")
    appendLine("Cards can be moved between epics via the card's context menu.")
    appendLine()
    appendLine("## Workflows")
    appendLine()
    appendLine("Workflows are named subsets of skills in a specific order.")
    appendLine("Example: \"Development\" = plan-requirements → plan-technical → implement → review.")
    appendLine("When active, only that workflow's skills appear as columns.")
    appendLine("Create and manage from the workflow dropdown in the board header.")
    appendLine()
}

private fun StringBuilder.appendArgustackCli() {
    appendLine("## Argustack CLI")
    appendLine()
    appendLine("Argustack is also a standalone CLI tool for project analysis.")
    appendLine("`argustack init` creates a workspace with PostgreSQL for cross-referencing:")
    appendLine("- **Jira** issues, changelogs, worklogs")
    appendLine("- **Git** commits, diffs, authors")
    appendLine("- **GitHub** PRs, reviews, releases")
    appendLine()
    appendLine("The CLI and IDE plugin are independent — the plugin works without the CLI.")
    appendLine("The CLI adds deep analytics (semantic search, cross-references) when configured.")
    appendLine()
}

private fun StringBuilder.appendFooter() {
    appendLine("## .kanban.json")
    appendLine()
    appendLine("Board state file at project root. Stores card positions, workflows, settings.")
    appendLine("Auto-managed by plugin. Safe to delete — regenerated from the file system on next load.")
}
