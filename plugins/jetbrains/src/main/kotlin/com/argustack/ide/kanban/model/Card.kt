package com.argustack.ide.kanban.model

import kotlinx.serialization.Serializable

@Serializable
public data class Card(
    val id: String,
    val title: String,
    val mdPath: String,
    val column: String,
    val epic: String,
    val jiraKey: String? = null,
    val assignee: String? = null,
    val sessionName: String? = null,
    val executionState: String? = null,
    val createdAt: String,
    val updatedAt: String,
)
