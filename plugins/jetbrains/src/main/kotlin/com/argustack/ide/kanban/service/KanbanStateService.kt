package com.argustack.ide.kanban.service

import com.argustack.ide.kanban.model.BoardSettings
import com.argustack.ide.kanban.model.BoardState
import com.argustack.ide.kanban.model.Card
import com.argustack.ide.kanban.model.Column
import com.argustack.ide.kanban.model.Epic
import com.argustack.ide.shared.config.ArgustackSettings
import com.argustack.ide.skills.service.SkillDiscoveryService
import com.argustack.ide.terminal.model.ExecutionState
import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File
import javax.swing.Timer

@Suppress("TooManyFunctions")
@Service(Service.Level.PROJECT)
public class KanbanStateService(
    private val project: Project,
) {

    private val json: Json = Json { prettyPrint = true; ignoreUnknownKeys = true }
    private val debounceTimer: Timer = Timer(DEBOUNCE_MS) { saveToDisk() }
    private val cardUpdater: CardStateUpdater = CardStateUpdater()
    private val fsSynchronizer: FileSystemSynchronizer = FileSystemSynchronizer()
    private val workflowManager: WorkflowManager = WorkflowManager()
    private val migrator: BoardMigrator = BoardMigrator()
    private var currentState: BoardState = BoardState(
        cards = emptyList(),
        columns = emptyList(),
        epics = emptyList(),
    )

    init {
        debounceTimer.isRepeats = false
    }

    public fun loadState(): BoardState {
        val basePath = project.basePath ?: return currentState
        val kanbanFile = File(basePath, KANBAN_FILE)
        if (kanbanFile.isFile) {
            currentState = json.decodeFromString<BoardState>(kanbanFile.readText())
        }
        OnboardingService.getInstance(project).generateReadmeIfMissing()

        val tasksDir = File(basePath, ArgustackSettings.getInstance(project).tasksDir)
        val result = migrator.migrate(currentState, tasksDir)
        currentState = result.state
        if (result.needsSave) debounceTimer.restart()

        currentState = fsSynchronizer.synchronize(currentState, basePath, tasksDir)
        applyColumnRebuild()
        return currentState
    }

    public fun getState(): BoardState = currentState

    public fun moveCard(cardId: String, targetColumn: String) {
        applyCards(cardUpdater.withColumn(currentState.cards, cardId, targetColumn))
    }

    public fun addCard(card: Card) {
        applyCards(currentState.cards + card)
    }

    public fun removeCard(cardId: String) {
        applyCards(currentState.cards.filter { it.id != cardId })
    }

    public fun updateCardSession(cardId: String, sessionName: String) {
        applyCards(cardUpdater.withSession(currentState.cards, cardId, sessionName))
    }

    public fun updateCardJiraKey(cardId: String, jiraKey: String) {
        applyCards(cardUpdater.withJiraKey(currentState.cards, cardId, jiraKey))
    }

    public fun updateCardEpic(cardId: String, epic: String, newMdPath: String) {
        applyCards(cardUpdater.withEpic(currentState.cards, cardId, epic, newMdPath))
    }

    public fun updateCardExecutionState(cardId: String, state: ExecutionState) {
        applyCards(cardUpdater.withExecutionState(currentState.cards, cardId, state))
    }

    public fun updateCardMdPath(cardId: String, newPath: String) {
        applyCards(cardUpdater.withMdPath(currentState.cards, cardId, newPath))
    }

    public fun createEpic(name: String) {
        val basePath = project.basePath ?: return
        val tasksDir = File(basePath, ArgustackSettings.getInstance(project).tasksDir)

        for (status in STATUS_DIR_NAMES) {
            val epicDir = File(tasksDir, "$status/$name")
            if (!epicDir.exists()) epicDir.mkdirs()
        }

        if (currentState.epics.none { it.name == name }) {
            val epic = Epic(name, File(tasksDir, "Backlog/$name").absolutePath)
            currentState = currentState.copy(epics = currentState.epics + epic, activeEpicFilter = name)
            debounceTimer.restart()
        }

        com.intellij.openapi.vfs.LocalFileSystem.getInstance().refreshAndFindFileByIoFile(tasksDir)
    }

    public fun setEpicFilter(epicName: String?) {
        currentState = currentState.copy(activeEpicFilter = epicName)
        debounceTimer.restart()
    }

    public fun updateSettings(settings: BoardSettings) {
        currentState = currentState.copy(settings = settings)
        debounceTimer.restart()
    }

    public fun setActiveWorkflow(name: String?) {
        currentState = currentState.copy(activeWorkflow = name)
        debounceTimer.restart()
    }

    public fun createWorkflow(name: String, skills: List<String>) {
        currentState = workflowManager.create(currentState, name, skills)
        debounceTimer.restart()
    }

    public fun updateWorkflow(name: String, newName: String, skills: List<String>) {
        currentState = workflowManager.update(currentState, name, newName, skills)
        debounceTimer.restart()
    }

    public fun deleteWorkflow(name: String) {
        currentState = workflowManager.delete(currentState, name)
        debounceTimer.restart()
    }

    public fun reorderColumns(names: List<String>) {
        currentState = workflowManager.reorder(currentState, names)
        applyColumnRebuild()
        debounceTimer.restart()
    }

    private fun applyCards(cards: List<Card>) {
        currentState = currentState.copy(cards = cards)
        debounceTimer.restart()
    }

    private fun applyColumnRebuild() {
        val skills = SkillDiscoveryService.getInstance(project).discoverSkills()
        val skillColumns = skills.map { Column.fromSkillName(it.name) }
        currentState = currentState.copy(columns = workflowManager.buildColumns(currentState, skillColumns))
    }

    private fun saveToDisk() {
        val basePath = project.basePath ?: return
        val kanbanFile = File(basePath, KANBAN_FILE)
        kanbanFile.parentFile.mkdirs()
        kanbanFile.writeText(json.encodeToString(currentState))
    }

    public companion object {
        public const val BACKLOG_COLUMN: String = "backlog"
        public const val DONE_COLUMN: String = "done"
        private const val KANBAN_FILE: String = ".kanban.json"
        private const val DEBOUNCE_MS: Int = 500
        internal val STATUS_DIR_NAMES: List<String> = listOf("Backlog", "InProgress", "Done")

        public fun getInstance(project: Project): KanbanStateService =
            project.getService(KanbanStateService::class.java)
    }
}
