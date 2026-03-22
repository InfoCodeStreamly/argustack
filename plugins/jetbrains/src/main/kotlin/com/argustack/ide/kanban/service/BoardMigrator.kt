package com.argustack.ide.kanban.service

import com.argustack.ide.kanban.model.BoardState
import com.argustack.ide.kanban.model.Epic
import com.argustack.ide.terminal.model.ExecutionState
import java.io.File

/**
 * Performs one-time migrations and recovery on board state during load.
 * Handles ToDo-to-InProgress folder migration, default folder creation,
 * and interrupted card recovery.
 */
public class BoardMigrator {

    /**
     * @return Pair of migrated state and whether any interrupted cards were recovered
     */
    public fun migrate(state: BoardState, tasksDir: File): MigrationResult {
        val afterTodo = migrateTodoToInProgress(state, tasksDir)
        ensureDefaultFolders(tasksDir)
        val afterRecovery = recoverInterruptedCards(afterTodo)
        return afterRecovery
    }

    private fun migrateTodoToInProgress(state: BoardState, tasksDir: File): BoardState {
        migrateTodoDirectory(tasksDir)
        return migrateTodoCardPaths(state)
    }

    private fun migrateTodoDirectory(tasksDir: File) {
        val todoDir = File(tasksDir, "ToDo")
        val inProgressDir = File(tasksDir, "InProgress")

        if (todoDir.isDirectory && !inProgressDir.exists()) {
            todoDir.renameTo(inProgressDir)
        } else if (todoDir.isDirectory && inProgressDir.isDirectory) {
            todoDir.listFiles()?.forEach { child ->
                val target = File(inProgressDir, child.name)
                if (!target.exists()) child.renameTo(target)
            }
            todoDir.deleteRecursively()
        }
    }

    private fun migrateTodoCardPaths(state: BoardState): BoardState {
        val updated = state.cards.map { card ->
            if (card.mdPath.contains("/ToDo/")) {
                card.copy(mdPath = card.mdPath.replace("/ToDo/", "/InProgress/"))
            } else {
                card
            }
        }
        return state.copy(cards = updated)
    }

    private fun ensureDefaultFolders(tasksDir: File) {
        for (status in STATUS_DIR_NAMES) {
            val dir = File(tasksDir, "$status/${Epic.UNCATEGORIZED}")
            if (!dir.exists()) dir.mkdirs()
        }
    }

    private fun recoverInterruptedCards(state: BoardState): MigrationResult {
        val runningState = ExecutionState.RUNNING.name
        val hasRunning = state.cards.any { it.executionState == runningState }
        if (!hasRunning) return MigrationResult(state, needsSave = false)

        val interruptedState = ExecutionState.INTERRUPTED.name
        val updated = state.cards.map { card ->
            if (card.executionState == runningState) {
                card.copy(executionState = interruptedState)
            } else {
                card
            }
        }
        return MigrationResult(state.copy(cards = updated), needsSave = true)
    }

    private companion object {
        val STATUS_DIR_NAMES: List<String> = listOf("Backlog", "InProgress", "Done")
    }
}

public data class MigrationResult(
    val state: BoardState,
    val needsSave: Boolean,
)
