package com.argustack.ide.kanban.bridge

import com.argustack.ide.kanban.model.Card
import com.argustack.ide.kanban.model.ColumnType
import com.argustack.ide.kanban.service.CardFileService
import com.argustack.ide.kanban.service.JiraService
import com.argustack.ide.kanban.service.KanbanStateService
import com.argustack.ide.terminal.model.ExecutionState
import com.argustack.ide.terminal.model.SkillCommand
import com.argustack.ide.terminal.service.TerminalService
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import java.io.File
import java.time.Instant
import java.util.UUID

private val LOG = logger<CardHandler>()

public class CardHandler(
    private val project: Project,
    private val onBoardStateChanged: () -> Unit,
) {

    public fun handleMove(message: BridgeMessage.MoveCard) {
        val stateService = KanbanStateService.getInstance(project)
        val targetCol = stateService.getState().columns.find { it.name == message.targetColumn }
        val isSystemTarget = targetCol?.type != ColumnType.SKILL

        if (!isSystemTarget && isCardRunning(message.cardId, message.targetColumn)) {
            onBoardStateChanged()
            return
        }

        val cardBefore = stateService.getState().cards.find { it.id == message.cardId }
        val oldColumn = cardBefore?.column
        stateService.moveCard(message.cardId, message.targetColumn)

        if (isSystemTarget) {
            resetExecutionState(message.cardId)
        }

        if (cardBefore != null && oldColumn != null) {
            moveFileIfZoneChanged(cardBefore, oldColumn, message.targetColumn)
            if (!isSystemTarget) {
                val card = stateService.getState().cards.find { it.id == message.cardId }
                if (card != null) {
                    injectContext(card, oldColumn, message.targetColumn)
                    executeSkillForCard(card.id, message.targetColumn, card.mdPath)
                }
            }
        }
        onBoardStateChanged()
    }

    public fun handleCreate(message: BridgeMessage.CreateCard) {
        val stateService = KanbanStateService.getInstance(project)
        val jiraKey = stateService.getState().settings.jiraProjectKey
        val basePath = project.basePath ?: return
        val file = CardFileService.getInstance(project).createCard(message.title, message.epic, jiraKey)
        val now = Instant.now().toString()
        KanbanStateService.getInstance(project).addCard(
            Card(
                id = UUID.randomUUID().toString(),
                title = message.title,
                mdPath = file.relativeTo(File(basePath)).path,
                column = KanbanStateService.BACKLOG_COLUMN,
                epic = message.epic,
                jiraKey = jiraKey,
                createdAt = now,
                updatedAt = now,
            ),
        )
        onBoardStateChanged()
        openFileInEditor(file)
    }

    public fun handleDelete(message: BridgeMessage.DeleteCard) {
        val stateService = KanbanStateService.getInstance(project)
        val card = stateService.getState().cards.find { it.id == message.cardId }
        val basePath = project.basePath
        if (card != null && basePath != null) {
            CardFileService.getInstance(project).deleteCard(File(basePath, card.mdPath))
        }
        KanbanStateService.getInstance(project).removeCard(message.cardId)
        onBoardStateChanged()
    }

    public fun handleRunSkill(message: BridgeMessage.RunSkill) {
        val card = KanbanStateService.getInstance(project).getState().cards
            .find { it.id == message.cardId } ?: return
        executeSkillForCard(card.id, message.skillName, card.mdPath)
    }

    public fun handleCreateJiraIssue(message: BridgeMessage.CreateJiraIssue) {
        val stateService = KanbanStateService.getInstance(project)
        val state = stateService.getState()
        val card = state.cards.find { it.id == message.cardId } ?: return
        val projectKey = state.settings.jiraProjectKey ?: return
        val issueKey = JiraService.getInstance(project).createIssue(projectKey, card.title) ?: return
        KanbanStateService.getInstance(project).updateCardJiraKey(message.cardId, issueKey)
        updateJiraKeyInFile(card.mdPath, issueKey)
        onBoardStateChanged()
    }

    public fun handleOpenFile(message: BridgeMessage.OpenFile) {
        val card = KanbanStateService.getInstance(project).getState().cards
            .find { it.id == message.cardId } ?: return
        val basePath = project.basePath ?: return
        openFileInEditor(File(basePath, card.mdPath))
    }

    public fun handleResumeSession(message: BridgeMessage.ResumeSession) {
        val card = KanbanStateService.getInstance(project).getState().cards
            .find { it.id == message.cardId } ?: return
        val sessionName = card.sessionName ?: return
        val basePath = project.basePath ?: return
        val command = SkillCommand(
            skillName = "",
            mdFilePath = File(basePath, card.mdPath).path,
            workingDir = basePath,
            sessionName = sessionName,
        )
        TerminalService.getInstance(project).resumeSession(command, card.title, card.id)
    }

    public fun handleChangeEpic(message: BridgeMessage.ChangeEpic) {
        val basePath = project.basePath ?: return
        val stateService = KanbanStateService.getInstance(project)
        val card = stateService.getState().cards.find { it.id == message.cardId } ?: return
        val mdFile = File(basePath, card.mdPath)
        if (!mdFile.exists()) return
        val newFile = CardFileService.getInstance(project).moveToEpic(mdFile, message.targetEpic)
        val newPath = newFile.relativeTo(File(basePath)).path
        KanbanStateService.getInstance(project).updateCardEpic(message.cardId, message.targetEpic, newPath)
        LocalFileSystem.getInstance().refreshAndFindFileByIoFile(newFile.parentFile)
        onBoardStateChanged()
    }

    private fun isCardRunning(cardId: String, targetColumn: String): Boolean {
        val stateService = KanbanStateService.getInstance(project)
        val column = stateService.getState().columns.find { it.name == targetColumn }
        val isExecutable = column?.type == ColumnType.SKILL
        val isRunning = TerminalService.getInstance(project).getCardState(cardId) == ExecutionState.RUNNING
        if (isExecutable && isRunning) {
            LOG.info("Card $cardId is running, blocking move to $targetColumn")
            return true
        }
        return false
    }

    private fun resetExecutionState(cardId: String) {
        val stateService = KanbanStateService.getInstance(project)
        stateService.updateCardExecutionState(cardId, ExecutionState.IDLE)
    }

    private fun injectContext(card: Card, oldColumn: String, targetSkill: String) {
        val basePath = project.basePath ?: return
        val mdFile = File(basePath, card.mdPath)
        if (!mdFile.exists()) return
        val content = mdFile.readText()
        val hasContent = content.replace(Regex("---[\\s\\S]*?---"), "").trim().length > MIN_CONTENT_LENGTH
        val hint = if (hasContent) "Append your output to this file." else "Write your output to this file."
        val comment = "<!-- argustack: from '$oldColumn' to '$targetSkill'. $hint -->"
        val cleaned = content.replace(Regex("<!-- argustack:.*?-->\n?"), "")
        mdFile.writeText("$comment\n$cleaned")
    }

    private fun moveFileIfZoneChanged(card: Card, oldColumn: String, newColumn: String) {
        val oldZone = columnToZone(oldColumn)
        val newZone = columnToZone(newColumn)
        if (oldZone == newZone || oldZone == IN_PROGRESS_ZONE && newZone == IN_PROGRESS_ZONE) return
        val basePath = project.basePath ?: return
        val mdFile = File(basePath, card.mdPath)
        if (!mdFile.exists()) return
        val newFile = CardFileService.getInstance(project).moveToStatus(mdFile, newZone, card.epic)
        val newPath = newFile.relativeTo(File(basePath)).path
        KanbanStateService.getInstance(project).updateCardMdPath(card.id, newPath)
        LocalFileSystem.getInstance().refreshAndFindFileByIoFile(newFile.parentFile)
    }

    private fun executeSkillForCard(cardId: String, skillName: String, mdPath: String) {
        val basePath = project.basePath ?: return
        val stateService = KanbanStateService.getInstance(project)
        val card = stateService.getState().cards.find { it.id == cardId } ?: return
        val sessionName = card.sessionName ?: buildSessionName(cardId)
        val isResume = card.sessionName != null
        if (!isResume) {
            KanbanStateService.getInstance(project).updateCardSession(cardId, sessionName)
        }
        val command = SkillCommand(
            skillName = skillName,
            mdFilePath = File(basePath, mdPath).path,
            workingDir = basePath,
            sessionName = sessionName,
        )
        TerminalService.getInstance(project).executeSkill(command, card.title, cardId, resume = isResume)
    }

    private fun updateJiraKeyInFile(mdPath: String, issueKey: String) {
        val basePath = project.basePath ?: return
        val mdFile = File(basePath, mdPath)
        if (!mdFile.exists()) return
        val content = mdFile.readText()
        val updated = if (content.contains(JIRA_KEY_FIELD)) {
            content.replace(Regex("$JIRA_KEY_FIELD.*"), "$JIRA_KEY_FIELD $issueKey")
        } else {
            content.replaceFirst("---\n", "---\n$JIRA_KEY_FIELD $issueKey\n")
        }
        mdFile.writeText(updated)
    }

    private fun openFileInEditor(file: File) {
        ApplicationManager.getApplication().invokeLater {
            val virtualFile = LocalFileSystem.getInstance().refreshAndFindFileByIoFile(file)
            if (virtualFile != null) {
                FileEditorManager.getInstance(project).openFile(virtualFile, true)
            }
        }
    }

    private companion object {
        private const val SESSION_NAME_LENGTH: Int = 6
        private const val JIRA_KEY_FIELD: String = "jiraKey:"
        private const val MIN_CONTENT_LENGTH: Int = 10
        private const val IN_PROGRESS_ZONE: String = "InProgress"

        private fun columnToZone(columnName: String): String = when (columnName) {
            KanbanStateService.BACKLOG_COLUMN -> "Backlog"
            KanbanStateService.DONE_COLUMN -> "Done"
            else -> "InProgress"
        }

        private fun buildSessionName(cardId: String): String =
            "argustack-${cardId.take(SESSION_NAME_LENGTH)}"
    }
}
