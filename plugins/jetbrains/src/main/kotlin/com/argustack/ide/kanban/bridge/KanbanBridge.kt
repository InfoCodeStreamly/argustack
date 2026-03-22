package com.argustack.ide.kanban.bridge

import com.argustack.ide.kanban.model.ColumnType
import com.argustack.ide.kanban.service.JiraService
import com.argustack.ide.kanban.service.KanbanStateService
import com.argustack.ide.terminal.model.ExecutionState
import com.argustack.ide.terminal.service.TerminalService
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.project.Project
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefJSQuery
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlin.reflect.KClass

private val LOG = logger<KanbanBridge>()

public class KanbanBridge(
    private val project: Project,
    private val browser: JBCefBrowser,
    @Suppress("UnusedPrivateProperty")
    private val jsQuery: JBCefJSQuery,
) {

    private val json: Json = Json { ignoreUnknownKeys = true }
    private val cardHandler: CardHandler = CardHandler(project, ::sendBoardState)
    private val boardHandler: BoardHandler = BoardHandler(project, ::sendBoardState)

    private val handlers: Map<KClass<out BridgeMessage>, (BridgeMessage) -> Unit> =
        cardHandlers() + boardHandlers()

    public fun handleMessage(rawMessage: String) {
        LOG.info("Bridge received: $rawMessage")
        val message = json.decodeFromString<BridgeMessage>(rawMessage)
        val handler = handlers[message::class]
        if (handler != null) {
            handler(message)
        } else {
            LOG.warn("No handler for message type: ${message::class.simpleName}")
        }
    }

    public fun sendInitialState() {
        KanbanStateService.getInstance(project).loadState()
        sendBoardState()
    }

    public fun sendExecutionStateToWebview(cardId: String, state: ExecutionState) {
        sendToWebview(BridgeResponse.ExecutionStateChanged(cardId, state))
    }

    private fun sendBoardState() {
        val state = KanbanStateService.getInstance(project).getState()
        val terminalService = TerminalService.getInstance(project)

        val response = BridgeResponse.BoardStateUpdate(
            cards = state.cards.map { card ->
                CardDto(
                    card.id, card.title, card.mdPath, card.column, card.epic,
                    card.jiraKey, card.assignee, card.executionState, card.sessionName,
                    card.updatedAt,
                )
            },
            columns = state.columns.map { col ->
                ColumnDto(col.name, col.type.name.lowercase(), col.displayName)
            },
            epics = state.epics.map { epic -> EpicDto(epic.name) },
            workflows = state.workflows.map { wf -> WorkflowDto(wf.name, wf.skills) },
            settings = BoardSettingsDto(
                jiraProjectKey = state.settings.jiraProjectKey,
                doneFilterValue = state.settings.doneFilterValue,
                doneFilterUnit = state.settings.doneFilterUnit,
            ),
            allSkills = state.columns.filter { it.type == ColumnType.SKILL }.map { it.name },
            activeEpicFilter = state.activeEpicFilter,
            activeWorkflow = state.activeWorkflow,
            claudeAvailable = terminalService.isClaudeAvailable(),
            jiraConfigured = JiraService.getInstance(project).isConfigured(),
        )

        sendToWebview(response)
    }

    private fun sendToWebview(response: BridgeResponse) {
        val payload = json.encodeToString(response)
        val escaped = payload.replace("\\", "\\\\").replace("'", "\\'")
        browser.cefBrowser.executeJavaScript(
            "window.receiveFromPlugin && window.receiveFromPlugin('$escaped');",
            browser.cefBrowser.url,
            0,
        )
    }

    private fun cardHandlers(): Map<KClass<out BridgeMessage>, (BridgeMessage) -> Unit> = mapOf(
        BridgeMessage.MoveCard::class to { cardHandler.handleMove(it as BridgeMessage.MoveCard) },
        BridgeMessage.CreateCard::class to { cardHandler.handleCreate(it as BridgeMessage.CreateCard) },
        BridgeMessage.DeleteCard::class to { cardHandler.handleDelete(it as BridgeMessage.DeleteCard) },
        BridgeMessage.RunSkill::class to { cardHandler.handleRunSkill(it as BridgeMessage.RunSkill) },
        BridgeMessage.CreateJiraIssue::class to {
            cardHandler.handleCreateJiraIssue(it as BridgeMessage.CreateJiraIssue)
        },
        BridgeMessage.OpenFile::class to { cardHandler.handleOpenFile(it as BridgeMessage.OpenFile) },
        BridgeMessage.ResumeSession::class to {
            cardHandler.handleResumeSession(it as BridgeMessage.ResumeSession)
        },
        BridgeMessage.ChangeEpic::class to { cardHandler.handleChangeEpic(it as BridgeMessage.ChangeEpic) },
    )

    private fun boardHandlers(): Map<KClass<out BridgeMessage>, (BridgeMessage) -> Unit> = mapOf(
        BridgeMessage.CreateWorkflow::class to {
            boardHandler.handleCreateWorkflow(it as BridgeMessage.CreateWorkflow)
        },
        BridgeMessage.UpdateWorkflow::class to {
            boardHandler.handleUpdateWorkflow(it as BridgeMessage.UpdateWorkflow)
        },
        BridgeMessage.DeleteWorkflow::class to {
            boardHandler.handleDeleteWorkflow(it as BridgeMessage.DeleteWorkflow)
        },
        BridgeMessage.UpdateSettings::class to {
            boardHandler.handleUpdateSettings(it as BridgeMessage.UpdateSettings)
        },
        BridgeMessage.SetWorkflow::class to { boardHandler.handleSetWorkflow(it as BridgeMessage.SetWorkflow) },
        BridgeMessage.CreateEpic::class to { boardHandler.handleCreateEpic(it as BridgeMessage.CreateEpic) },
        BridgeMessage.FilterEpic::class to { boardHandler.handleFilterEpic(it as BridgeMessage.FilterEpic) },
        BridgeMessage.ReorderColumns::class to {
            boardHandler.handleReorderColumns(it as BridgeMessage.ReorderColumns)
        },
        BridgeMessage.RequestBoardState::class to { sendBoardState() },
    )
}
