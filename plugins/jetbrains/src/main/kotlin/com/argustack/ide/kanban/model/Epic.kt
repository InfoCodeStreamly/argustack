package com.argustack.ide.kanban.model

import kotlinx.serialization.Serializable

@Serializable
public data class Epic(
    val name: String,
    val folderPath: String,
) {
    public companion object {
        public const val UNCATEGORIZED: String = "Uncategorized"

        public fun default(tasksDir: String): Epic = Epic(
            name = UNCATEGORIZED,
            folderPath = "$tasksDir/$UNCATEGORIZED",
        )
    }
}
