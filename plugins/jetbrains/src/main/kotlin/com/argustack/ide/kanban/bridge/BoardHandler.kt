package com.argustack.ide.kanban.bridge

import com.argustack.ide.kanban.model.BoardSettings
import com.argustack.ide.kanban.service.KanbanStateService
import com.intellij.openapi.project.Project

public class BoardHandler(
    private val project: Project,
    private val onBoardStateChanged: () -> Unit,
) {

    public fun handleCreateWorkflow(message: BridgeMessage.CreateWorkflow) {
        KanbanStateService.getInstance(project).createWorkflow(message.name, message.skills)
        onBoardStateChanged()
    }

    public fun handleUpdateWorkflow(message: BridgeMessage.UpdateWorkflow) {
        KanbanStateService.getInstance(project).updateWorkflow(message.name, message.newName, message.skills)
        onBoardStateChanged()
    }

    public fun handleDeleteWorkflow(message: BridgeMessage.DeleteWorkflow) {
        KanbanStateService.getInstance(project).deleteWorkflow(message.name)
        onBoardStateChanged()
    }

    public fun handleUpdateSettings(message: BridgeMessage.UpdateSettings) {
        val current = KanbanStateService.getInstance(project).getState().settings
        val settings = BoardSettings(
            jiraProjectKey = message.jiraProjectKey?.trim()?.uppercase()?.ifEmpty { null } ?: current.jiraProjectKey,
            doneFilterValue = message.doneFilterValue ?: current.doneFilterValue,
            doneFilterUnit = message.doneFilterUnit ?: current.doneFilterUnit,
        )
        KanbanStateService.getInstance(project).updateSettings(settings)
        onBoardStateChanged()
    }

    public fun handleSetWorkflow(message: BridgeMessage.SetWorkflow) {
        KanbanStateService.getInstance(project).setActiveWorkflow(message.workflowName)
        onBoardStateChanged()
    }

    public fun handleCreateEpic(message: BridgeMessage.CreateEpic) {
        KanbanStateService.getInstance(project).createEpic(message.name.trim())
        onBoardStateChanged()
    }

    public fun handleFilterEpic(message: BridgeMessage.FilterEpic) {
        KanbanStateService.getInstance(project).setEpicFilter(message.epicName)
        onBoardStateChanged()
    }

    public fun handleReorderColumns(message: BridgeMessage.ReorderColumns) {
        KanbanStateService.getInstance(project).reorderColumns(message.columnNames)
        onBoardStateChanged()
    }
}
