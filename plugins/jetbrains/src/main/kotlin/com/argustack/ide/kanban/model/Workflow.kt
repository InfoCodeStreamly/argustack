package com.argustack.ide.kanban.model

import kotlinx.serialization.Serializable

@Serializable
public data class Workflow(
    val name: String,
    val skills: List<String>,
)
