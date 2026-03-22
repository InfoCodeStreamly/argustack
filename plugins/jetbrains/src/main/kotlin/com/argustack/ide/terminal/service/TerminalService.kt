package com.argustack.ide.terminal.service

import com.argustack.ide.terminal.model.ExecutionState
import com.argustack.ide.terminal.model.SkillCommand
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.project.Project
import org.jetbrains.plugins.terminal.ShellTerminalWidget
import org.jetbrains.plugins.terminal.TerminalToolWindowManager
import java.io.File

private val LOG = logger<TerminalService>()
private const val TAB_PREFIX = "Argustack: "

@Service(Service.Level.PROJECT)
public class TerminalService(
    private val project: Project,
) {

    private val cardStates: MutableMap<String, ExecutionState> = mutableMapOf()
    private val stateListeners: MutableList<(String, ExecutionState) -> Unit> = mutableListOf()
    private val terminalWidgets: MutableMap<String, ShellTerminalWidget> = mutableMapOf()

    public fun isClaudeAvailable(): Boolean {
        val pathDirs = System.getenv("PATH")?.split(File.pathSeparator) ?: emptyList()
        val homeDirs = listOf(
            "${System.getProperty("user.home")}/.local/bin",
            "${System.getProperty("user.home")}/.npm-global/bin",
            "/usr/local/bin",
            "/opt/homebrew/bin",
        )
        return (pathDirs + homeDirs).any { dir ->
            File(dir, "claude").exists() || File(dir, "claude.exe").exists()
        }
    }

    public fun addStateListener(listener: (String, ExecutionState) -> Unit) {
        stateListeners.add(listener)
    }

    public fun getCardState(cardId: String): ExecutionState =
        cardStates[cardId] ?: ExecutionState.IDLE

    public fun executeSkill(
        command: SkillCommand,
        cardTitle: String,
        cardId: String,
        resume: Boolean = false,
    ) {
        if (isAlreadyRunning(cardId)) return
        updateCardState(cardId, ExecutionState.RUNNING)
        val cmd = if (resume) command.toResumeCommand() else command.toClaudeCommand()
        executeInTab(buildTabName(cardTitle, cardId), cmd, cardId)
    }

    public fun resumeSession(command: SkillCommand, cardTitle: String, cardId: String) {
        if (isAlreadyRunning(cardId)) return
        updateCardState(cardId, ExecutionState.RUNNING)
        executeInTab(buildTabName(cardTitle, cardId), command.toResumeOnlyCommand(), cardId)
    }

    public fun executeFreeChat(command: SkillCommand, cardTitle: String, cardId: String) {
        if (isAlreadyRunning(cardId)) return
        updateCardState(cardId, ExecutionState.RUNNING)
        executeInTab(buildTabName(cardTitle, cardId), command.toFreeCommand(), cardId)
    }

    private fun isAlreadyRunning(cardId: String): Boolean {
        if (cardStates[cardId] == ExecutionState.RUNNING) {
            LOG.info("Card $cardId is already running, skipping")
            return true
        }
        return false
    }

    private fun updateCardState(cardId: String, state: ExecutionState) {
        cardStates[cardId] = state
        for (listener in stateListeners) {
            listener(cardId, state)
        }
    }

    private fun executeInTab(tabName: String, command: String, cardId: String) {
        LOG.info("Executing in tab '$tabName': $command")
        val wrappedCmd = "$command; echo $EXIT_MARKER\$?"

        ApplicationManager.getApplication().invokeLater {
            openOrCreateTerminal(tabName, wrappedCmd, cardId)
        }
    }

    private fun openOrCreateTerminal(tabName: String, command: String, cardId: String) {
        try {
            val cached = terminalWidgets[tabName]
            if (cached != null && tryReuseWidget(cached, tabName, command, cardId)) return
            createTerminalTab(tabName, command, cardId)
        } catch (@Suppress("TooGenericExceptionCaught") e: Exception) {
            LOG.error("Failed to execute in terminal: ${e.message}", e)
            updateCardState(cardId, ExecutionState.ERROR)
        }
    }

    private fun createTerminalTab(tabName: String, command: String, cardId: String) {
        LOG.info("Creating new terminal tab: $tabName")
        val terminalManager = TerminalToolWindowManager.getInstance(project)
        @Suppress("DEPRECATION")
        val widget = terminalManager.createLocalShellWidget(project.basePath ?: ".", tabName)
        terminalWidgets[tabName] = widget
        widget.executeCommand(command)
        monitorProcess(widget, cardId)
    }

    private fun tryReuseWidget(
        widget: ShellTerminalWidget,
        tabName: String,
        command: String,
        cardId: String,
    ): Boolean = try {
        widget.executeCommand(command)
        activateTab(tabName)
        monitorProcess(widget, cardId)
        LOG.info("Reusing existing terminal tab: $tabName")
        true
    } catch (@Suppress("TooGenericExceptionCaught") e: Exception) {
        LOG.info("Widget for '$tabName' is stale: ${e.message}")
        terminalWidgets.remove(tabName)
        false
    }

    private fun monitorProcess(widget: ShellTerminalWidget, cardId: String) {
        try {
            val startTime = System.currentTimeMillis()
            widget.terminalTextBuffer.addModelListener(
                TerminalOutputListener(cardId, startTime, widget, ::updateCardState, cardStates),
            )
        } catch (@Suppress("TooGenericExceptionCaught") e: Exception) {
            LOG.warn("Cannot monitor terminal for card $cardId: ${e.message}")
        }
    }

    private fun activateTab(tabName: String) {
        try {
            val toolWindowManager = com.intellij.openapi.wm.ToolWindowManager.getInstance(project)
            val terminalWindow = toolWindowManager.getToolWindow("Terminal") ?: return
            terminalWindow.show()
            val contentManager = terminalWindow.contentManager
            for (content in contentManager.contents) {
                if (content.displayName == tabName) {
                    contentManager.setSelectedContent(content)
                    break
                }
            }
        } catch (@Suppress("TooGenericExceptionCaught") e: Exception) {
            LOG.warn("Cannot activate tab '$tabName': ${e.message}")
        }
    }

    public companion object {
        private const val SHORT_ID_LENGTH: Int = 6
        internal const val IGNORE_PROMPT_MS: Long = 5000
        internal const val EXIT_MARKER: String = "ARGUSTACK_EXIT:"

        public fun getInstance(project: Project): TerminalService =
            project.getService(TerminalService::class.java)

        private fun buildTabName(cardTitle: String, cardId: String): String =
            "$TAB_PREFIX$cardTitle (${cardId.take(SHORT_ID_LENGTH)})"
    }
}

private class TerminalOutputListener(
    private val cardId: String,
    private val startTime: Long,
    private val widget: ShellTerminalWidget,
    private val onStateChange: (String, ExecutionState) -> Unit,
    private val cardStates: Map<String, ExecutionState>,
) : com.jediterm.terminal.model.TerminalModelListener {

    private var lastLine: String = ""

    override fun modelChanged() {
        if (cardStates[cardId] != ExecutionState.RUNNING) return
        val elapsed = System.currentTimeMillis() - startTime
        if (elapsed < TerminalService.IGNORE_PROMPT_MS) return

        val currentLine = try {
            widget.terminalTextBuffer.getLine(
                widget.terminalTextBuffer.screenLinesCount - 1,
            ).text.trim()
        } catch (@Suppress("TooGenericExceptionCaught") _: Exception) { "" }

        if (currentLine != lastLine) {
            lastLine = currentLine
            val exitState = parseExitMarker(currentLine)
            if (exitState != null) {
                LOG.info("Exit marker for card $cardId: $currentLine (${elapsed}ms)")
                onStateChange(cardId, exitState)
            } else if (currentLine.endsWith("$") || currentLine.endsWith("%") || currentLine.endsWith("❯")) {
                LOG.info("Prompt fallback for card $cardId (${elapsed}ms)")
                onStateChange(cardId, ExecutionState.DONE)
            }
        }
    }

    private fun parseExitMarker(line: String): ExecutionState? {
        if (!line.contains(TerminalService.EXIT_MARKER)) return null
        val code = line.substringAfter(TerminalService.EXIT_MARKER).trim().toIntOrNull() ?: return null
        return if (code == 0) ExecutionState.DONE else ExecutionState.ERROR
    }
}
