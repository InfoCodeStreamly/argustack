package com.argustack.ide.terminal.service

import com.argustack.ide.terminal.model.ExecutionState
import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project
import java.util.concurrent.ConcurrentHashMap

@Service(Service.Level.PROJECT)
public class ExecutionTracker(
    @Suppress("UnusedPrivateProperty")
    private val project: Project,
) {

    private val runningProcesses: ConcurrentHashMap<String, Process> = ConcurrentHashMap()

    public fun trackExecution(
        command: String,
        workingDir: String,
        onStateChange: (ExecutionState) -> Unit,
    ) {
        val processBuilder = ProcessBuilder("sh", "-c", command)
            .directory(java.io.File(workingDir))
            .redirectErrorStream(true)

        val process = processBuilder.start()
        val processId = "${System.currentTimeMillis()}-${command.hashCode()}"
        runningProcesses[processId] = process

        Thread {
            try {
                val exitCode = process.waitFor()
                runningProcesses.remove(processId)

                if (exitCode == 0) {
                    onStateChange(ExecutionState.DONE)
                } else {
                    onStateChange(ExecutionState.ERROR)
                }
            } catch (_: InterruptedException) {
                runningProcesses.remove(processId)
                onStateChange(ExecutionState.INTERRUPTED)
            }
        }.start()
    }

    public fun cancelAll() {
        runningProcesses.values.forEach { it.destroyForcibly() }
        runningProcesses.clear()
    }

    public companion object {
        public fun getInstance(project: Project): ExecutionTracker =
            project.getService(ExecutionTracker::class.java)
    }
}
