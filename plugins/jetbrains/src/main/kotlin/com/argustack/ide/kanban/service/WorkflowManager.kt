package com.argustack.ide.kanban.service

import com.argustack.ide.kanban.model.BoardState
import com.argustack.ide.kanban.model.Column
import com.argustack.ide.kanban.model.Workflow

/**
 * Manages workflow CRUD, column ordering, and column rebuilding within board state.
 */
public class WorkflowManager {

    public fun create(state: BoardState, name: String, skills: List<String>): BoardState {
        if (state.workflows.any { it.name == name }) return state
        val workflow = Workflow(name = name, skills = skills)
        return state.copy(
            workflows = state.workflows + workflow,
            activeWorkflow = name,
        )
    }

    public fun update(state: BoardState, name: String, newName: String, skills: List<String>): BoardState {
        val updated = state.workflows.map { wf ->
            if (wf.name == name) Workflow(newName, skills) else wf
        }
        val activeWf = if (state.activeWorkflow == name) newName else state.activeWorkflow
        return state.copy(workflows = updated, activeWorkflow = activeWf)
    }

    public fun delete(state: BoardState, name: String): BoardState {
        val filtered = state.workflows.filter { it.name != name }
        val activeWf = if (state.activeWorkflow == name) null else state.activeWorkflow
        return state.copy(workflows = filtered, activeWorkflow = activeWf)
    }

    public fun reorder(state: BoardState, names: List<String>): BoardState {
        val activeWf = state.activeWorkflow
        if (activeWf != null) {
            val updated = state.workflows.map { wf ->
                if (wf.name == activeWf) wf.copy(skills = names) else wf
            }
            return state.copy(workflows = updated)
        }
        return state.copy(columnOrder = names)
    }

    public fun buildColumns(state: BoardState, skillColumns: List<Column>): List<Column> {
        val order = resolveColumnOrder(state)
        val ordered = applyOrder(skillColumns, order)
        return listOf(Column.system(KanbanStateService.BACKLOG_COLUMN)) +
            ordered +
            listOf(Column.system(KanbanStateService.DONE_COLUMN))
    }

    private fun resolveColumnOrder(state: BoardState): List<String> {
        val activeWf = state.activeWorkflow
        if (activeWf != null) {
            val wfSkills = state.workflows.find { it.name == activeWf }?.skills
            if (!wfSkills.isNullOrEmpty()) return wfSkills
        }
        return state.columnOrder
    }

    private fun applyOrder(skillColumns: List<Column>, order: List<String>): List<Column> {
        if (order.isEmpty()) return skillColumns
        val byName = skillColumns.associateBy { it.name }
        val sorted = order.mapNotNull { byName[it] }
        return sorted + skillColumns.filter { it.name !in order }
    }
}
