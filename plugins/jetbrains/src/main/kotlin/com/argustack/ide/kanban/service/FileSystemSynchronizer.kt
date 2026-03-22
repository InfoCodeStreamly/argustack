package com.argustack.ide.kanban.service

import com.argustack.ide.kanban.model.BoardState
import com.argustack.ide.kanban.model.Card
import com.argustack.ide.kanban.model.Epic
import com.argustack.ide.shared.util.FrontmatterParser
import java.io.File
import java.time.Instant
import java.util.UUID

/**
 * Synchronizes board state with the file-system task directories.
 * Discovers new cards from .md files, prunes cards whose files were deleted,
 * and rebuilds the epic list from folder structure.
 */
public class FileSystemSynchronizer {

    public fun synchronize(state: BoardState, basePath: String, tasksDir: File): BoardState {
        if (!tasksDir.isDirectory) return state

        val existingPaths = state.cards.map { it.mdPath }.toSet()
        val discovered = discoverCardsFromDisk(tasksDir, basePath, existingPaths)
        val aliveCards = filterAliveCards(state.cards, discovered.paths)
        val epics = discoverEpicsFromDisk(tasksDir, discovered.epicNames)

        return state.copy(
            cards = aliveCards + discovered.newCards,
            epics = epics,
        )
    }

    private fun discoverCardsFromDisk(
        tasksDir: File,
        basePath: String,
        existingPaths: Set<String>,
    ): DiscoveryResult {
        val discoveredPaths = mutableSetOf<String>()
        val newCards = mutableListOf<Card>()
        val epicNames = mutableSetOf<String>()

        for (status in STATUS_DIR_NAMES) {
            val statusDir = File(tasksDir, status)
            if (!statusDir.isDirectory) continue
            scanStatusDirectory(statusDir, basePath, status, existingPaths, discoveredPaths, newCards, epicNames)
        }

        return DiscoveryResult(discoveredPaths, newCards, epicNames)
    }

    private fun scanStatusDirectory(
        statusDir: File,
        basePath: String,
        status: String,
        existingPaths: Set<String>,
        discoveredPaths: MutableSet<String>,
        newCards: MutableList<Card>,
        epicNames: MutableSet<String>,
    ) {
        val epicFolders = statusDir.listFiles()?.filter { it.isDirectory } ?: return
        for (epicFolder in epicFolders) {
            epicNames.add(epicFolder.name)
            scanEpicFolder(epicFolder, basePath, status, existingPaths, discoveredPaths, newCards)
        }
    }

    private fun scanEpicFolder(
        epicFolder: File,
        basePath: String,
        status: String,
        existingPaths: Set<String>,
        discoveredPaths: MutableSet<String>,
        newCards: MutableList<Card>,
    ) {
        val mdFiles = epicFolder.listFiles()?.filter { it.extension == "md" } ?: return
        for (mdFile in mdFiles) {
            val relPath = mdFile.relativeTo(File(basePath)).path
            discoveredPaths.add(relPath)
            if (relPath !in existingPaths) {
                newCards.add(buildCardFromFile(mdFile, relPath, status, epicFolder.name))
            }
        }
    }

    private fun buildCardFromFile(mdFile: File, relPath: String, status: String, epicName: String): Card {
        val parsed = FrontmatterParser.parse(mdFile.readText())
        val now = Instant.now().toString()
        val column = statusToColumn(status)
        return Card(
            id = UUID.randomUUID().toString(),
            title = parsed.title,
            mdPath = relPath,
            column = column,
            epic = epicName,
            jiraKey = parsed.frontmatter["jiraKey"],
            assignee = parsed.frontmatter["assignee"],
            createdAt = now,
            updatedAt = now,
        )
    }

    private fun filterAliveCards(cards: List<Card>, discoveredPaths: Set<String>): List<Card> =
        cards.filter { it.mdPath in discoveredPaths }

    private fun discoverEpicsFromDisk(tasksDir: File, epicNames: Set<String>): List<Epic> {
        val names = epicNames.ifEmpty { setOf(Epic.UNCATEGORIZED) }
        return names.map { name -> Epic(name, File(tasksDir, "Backlog/$name").absolutePath) }
    }

    private fun statusToColumn(status: String): String =
        if (status == "Done") KanbanStateService.DONE_COLUMN else KanbanStateService.BACKLOG_COLUMN

    private companion object {
        val STATUS_DIR_NAMES: List<String> = listOf("Backlog", "InProgress", "Done")
    }
}

private data class DiscoveryResult(
    val paths: Set<String>,
    val newCards: List<Card>,
    val epicNames: Set<String>,
)
