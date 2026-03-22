package com.argustack.ide.kanban.bridge

import com.argustack.ide.terminal.model.ExecutionState
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
public sealed class BridgeMessage {

    @Serializable
    @SerialName("moveCard")
    public data class MoveCard(
        val cardId: String,
        val targetColumn: String,
    ) : BridgeMessage()

    @Serializable
    @SerialName("createCard")
    public data class CreateCard(
        val title: String,
        val epic: String,
    ) : BridgeMessage()

    @Serializable
    @SerialName("deleteCard")
    public data class DeleteCard(
        val cardId: String,
    ) : BridgeMessage()

    @Serializable
    @SerialName("runSkill")
    public data class RunSkill(
        val cardId: String,
        val skillName: String,
    ) : BridgeMessage()

    @Serializable
    @SerialName("setWorkflow")
    public data class SetWorkflow(
        val workflowName: String?,
    ) : BridgeMessage()

    @Serializable
    @SerialName("createEpic")
    public data class CreateEpic(
        val name: String,
    ) : BridgeMessage()

    @Serializable
    @SerialName("filterEpic")
    public data class FilterEpic(
        val epicName: String?,
    ) : BridgeMessage()

    @Serializable
    @SerialName("openFile")
    public data class OpenFile(
        val cardId: String,
    ) : BridgeMessage()

    @Serializable
    @SerialName("resumeSession")
    public data class ResumeSession(
        val cardId: String,
    ) : BridgeMessage()

    @Serializable
    @SerialName("changeEpic")
    public data class ChangeEpic(
        val cardId: String,
        val targetEpic: String,
    ) : BridgeMessage()

    @Serializable
    @SerialName("updateSettings")
    public data class UpdateSettings(
        val jiraProjectKey: String? = null,
        val doneFilterValue: Int? = null,
        val doneFilterUnit: String? = null,
    ) : BridgeMessage()

    @Serializable
    @SerialName("createWorkflow")
    public data class CreateWorkflow(
        val name: String,
        val skills: List<String>,
    ) : BridgeMessage()

    @Serializable
    @SerialName("updateWorkflow")
    public data class UpdateWorkflow(
        val name: String,
        val newName: String,
        val skills: List<String>,
    ) : BridgeMessage()

    @Serializable
    @SerialName("deleteWorkflow")
    public data class DeleteWorkflow(
        val name: String,
    ) : BridgeMessage()

    @Serializable
    @SerialName("createJiraIssue")
    public data class CreateJiraIssue(
        val cardId: String,
    ) : BridgeMessage()

    @Serializable
    @SerialName("reorderColumns")
    public data class ReorderColumns(
        val columnNames: List<String>,
    ) : BridgeMessage()

    @Serializable
    @SerialName("requestBoardState")
    public data object RequestBoardState : BridgeMessage()
}

@Serializable
public sealed class BridgeResponse {

    @Serializable
    @SerialName("boardStateUpdate")
    public data class BoardStateUpdate(
        val cards: List<CardDto>,
        val columns: List<ColumnDto>,
        val epics: List<EpicDto>,
        val workflows: List<WorkflowDto> = emptyList(),
        val settings: BoardSettingsDto = BoardSettingsDto(),
        val activeEpicFilter: String? = null,
        val activeWorkflow: String? = null,
        val allSkills: List<String> = emptyList(),
        val claudeAvailable: Boolean,
        val jiraConfigured: Boolean = false,
    ) : BridgeResponse()

    @Serializable
    @SerialName("executionStateChanged")
    public data class ExecutionStateChanged(
        val cardId: String,
        val state: ExecutionState,
    ) : BridgeResponse()

    @Serializable
    @SerialName("error")
    public data class Error(
        val message: String,
    ) : BridgeResponse()
}

@Serializable
public data class CardDto(
    val id: String,
    val title: String,
    val mdPath: String,
    val column: String,
    val epic: String,
    val jiraKey: String? = null,
    val assignee: String? = null,
    val executionState: String? = null,
    val sessionName: String? = null,
    val updatedAt: String? = null,
)

@Serializable
public data class ColumnDto(
    val name: String,
    val type: String,
    val displayName: String,
)

@Serializable
public data class EpicDto(
    val name: String,
)

@Serializable
public data class WorkflowDto(
    val name: String,
    val skills: List<String>,
)

@Serializable
public data class BoardSettingsDto(
    val jiraProjectKey: String? = null,
    val doneFilterValue: Int = 1,
    val doneFilterUnit: String = "days",
)
