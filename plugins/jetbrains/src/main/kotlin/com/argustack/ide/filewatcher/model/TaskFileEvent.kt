package com.argustack.ide.filewatcher.model

public enum class TaskFileEventType {
    CREATED,
    MODIFIED,
    DELETED,
    MOVED,
}

public data class TaskFileEvent(
    val type: TaskFileEventType,
    val filePath: String,
    val oldPath: String? = null,
)
