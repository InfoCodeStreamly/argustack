package com.argustack.ide.skills.model

public enum class SkillSource {
    PROJECT,
    PERSONAL,
}

public data class Skill(
    val name: String,
    val description: String,
    val source: SkillSource,
    val path: String,
)
