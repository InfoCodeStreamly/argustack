package com.argustack.ide.filewatcher.service

import com.argustack.ide.filewatcher.model.TaskFileEvent
import com.argustack.ide.filewatcher.model.TaskFileEventType
import com.argustack.ide.shared.config.ArgustackSettings
import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFileManager
import com.intellij.openapi.vfs.newvfs.BulkFileListener
import com.intellij.openapi.vfs.newvfs.events.VFileCreateEvent
import com.intellij.openapi.vfs.newvfs.events.VFileDeleteEvent
import com.intellij.openapi.vfs.newvfs.events.VFileContentChangeEvent
import com.intellij.openapi.vfs.newvfs.events.VFileMoveEvent
import com.intellij.openapi.vfs.newvfs.events.VFileEvent
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicReference
import javax.swing.Timer

@Service(Service.Level.PROJECT)
public class TaskFileWatcher(
    private val project: Project,
) {

    private val listeners: CopyOnWriteArrayList<(TaskFileEvent) -> Unit> = CopyOnWriteArrayList()
    private val pendingEvents: AtomicReference<MutableList<TaskFileEvent>> =
        AtomicReference(mutableListOf())
    private val debounceTimer: Timer = Timer(DEBOUNCE_MS) { flushEvents() }

    init {
        debounceTimer.isRepeats = false

        project.messageBus.connect().subscribe(
            VirtualFileManager.VFS_CHANGES,
            object : BulkFileListener {
                override fun after(events: MutableList<out VFileEvent>) {
                    for (event in events) {
                        handleVfsEvent(event)
                    }
                }
            },
        )
    }

    public fun addListener(listener: (TaskFileEvent) -> Unit) {
        listeners.add(listener)
    }

    public fun removeListener(listener: (TaskFileEvent) -> Unit) {
        listeners.remove(listener)
    }

    private fun handleVfsEvent(event: VFileEvent) {
        val path = event.path
        if (!isTaskFile(path)) return

        val taskEvent = when (event) {
            is VFileCreateEvent -> TaskFileEvent(TaskFileEventType.CREATED, path)
            is VFileDeleteEvent -> TaskFileEvent(TaskFileEventType.DELETED, path)
            is VFileContentChangeEvent -> TaskFileEvent(TaskFileEventType.MODIFIED, path)
            is VFileMoveEvent -> TaskFileEvent(
                TaskFileEventType.MOVED,
                event.file.path,
                "${event.oldParent.path}/${event.file.name}",
            )
            else -> null
        }

        if (taskEvent != null) {
            enqueue(taskEvent)
        }
    }

    private fun isTaskFile(path: String): Boolean {
        val basePath = project.basePath ?: return false
        val tasksDir = ArgustackSettings.getInstance(project).tasksDir
        val tasksPath = "$basePath/$tasksDir"
        return path.startsWith(tasksPath) && path.endsWith(".md")
    }

    private fun enqueue(event: TaskFileEvent) {
        pendingEvents.get().add(event)
        debounceTimer.restart()
    }

    private fun flushEvents() {
        val events = pendingEvents.getAndSet(mutableListOf())
        for (event in events) {
            for (listener in listeners) {
                listener(event)
            }
        }
    }

    public companion object {
        private const val DEBOUNCE_MS: Int = 300

        public fun getInstance(project: Project): TaskFileWatcher =
            project.getService(TaskFileWatcher::class.java)
    }
}
