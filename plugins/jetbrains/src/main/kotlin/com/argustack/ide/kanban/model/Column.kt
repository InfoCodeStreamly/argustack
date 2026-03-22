package com.argustack.ide.kanban.model

import kotlinx.serialization.Serializable

@Serializable
public enum class ColumnType {
    SYSTEM,
    SKILL,
    FREE,
}

@Serializable
public data class Column(
    val name: String,
    val type: ColumnType,
    val displayName: String,
) {
    public companion object {
        public fun fromSkillName(skillName: String): Column = Column(
            name = skillName,
            type = ColumnType.SKILL,
            displayName = toDisplayName(skillName),
        )

        public fun system(name: String): Column = Column(
            name = name,
            type = ColumnType.SYSTEM,
            displayName = toDisplayName(name),
        )

        public fun free(name: String): Column = Column(
            name = name,
            type = ColumnType.FREE,
            displayName = toDisplayName(name),
        )

        private fun toDisplayName(kebab: String): String =
            kebab.split("-").joinToString(" ") { word ->
                word.replaceFirstChar { it.uppercase() }
            }
    }
}
