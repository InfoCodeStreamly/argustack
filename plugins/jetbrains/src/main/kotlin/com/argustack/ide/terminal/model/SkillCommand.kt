package com.argustack.ide.terminal.model

public data class SkillCommand(
    val skillName: String,
    val mdFilePath: String,
    val workingDir: String,
    val sessionName: String? = null,
) {
    public fun toClaudeCommand(): String {
        val nameFlag = sessionName?.let { " --name \"$it\"" } ?: ""
        return "claude$nameFlag /$skillName $mdFilePath"
    }

    public fun toResumeCommand(): String {
        val session = sessionName ?: return toClaudeCommand()
        return "claude --resume \"$session\" /$skillName $mdFilePath"
    }

    public fun toResumeOnlyCommand(): String {
        val session = sessionName ?: return toClaudeCommand()
        return "claude --resume \"$session\""
    }

    public fun toFreeCommand(): String {
        val nameFlag = sessionName?.let { " --name \"$it\"" } ?: ""
        return "claude$nameFlag $mdFilePath"
    }
}
