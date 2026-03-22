package com.argustack.ide.kanban.model

import kotlinx.serialization.Serializable

@Serializable
public data class BoardState(
    val cards: List<Card>,
    val columns: List<Column>,
    val epics: List<Epic>,
    val workflows: List<Workflow> = emptyList(),
    val columnOrder: List<String> = emptyList(),
    val settings: BoardSettings = BoardSettings(),
    val activeEpicFilter: String? = null,
    val activeWorkflow: String? = null,
)
