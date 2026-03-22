package com.argustack.ide.kanban.model

import kotlinx.serialization.Serializable

@Serializable
public data class BoardSettings(
    val jiraProjectKey: String? = null,
    val doneFilterValue: Int = DEFAULT_DONE_FILTER_VALUE,
    val doneFilterUnit: String = DEFAULT_DONE_FILTER_UNIT,
) {
    public companion object {
        public const val DEFAULT_DONE_FILTER_VALUE: Int = 1
        public const val DEFAULT_DONE_FILTER_UNIT: String = "days"
    }
}
