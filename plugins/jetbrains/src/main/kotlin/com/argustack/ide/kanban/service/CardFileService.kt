package com.argustack.ide.kanban.service

import com.argustack.ide.shared.config.ArgustackSettings
import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project
import java.io.File
import java.time.Instant
import java.util.UUID

@Service(Service.Level.PROJECT)
public class CardFileService(
    private val project: Project,
) {

    public fun createCard(title: String, epic: String, jiraKey: String? = null): File {
        val epicDir = resolveTasksPath("Backlog/$epic")

        if (!epicDir.exists()) {
            epicDir.mkdirs()
        }

        val slug = title.lowercase()
            .replace(Regex("[^a-z0-9]+"), "-")
            .trim('-')
        val fileName = "$slug.md"
        val file = File(epicDir, fileName)

        val content = buildString {
            appendLine("---")
            appendLine("epic: $epic")
            if (jiraKey != null) {
                appendLine("jiraKey: $jiraKey")
            }
            appendLine("createdAt: ${Instant.now()}")
            appendLine("---")
            appendLine()
            appendLine("# $title")
            appendLine()
        }

        file.writeText(content)
        return file
    }

    public fun moveToEpic(mdFile: File, targetEpic: String): File {
        val statusFolder = mdFile.parentFile.parentFile.name
        val targetDir = resolveTasksPath("$statusFolder/$targetEpic")

        if (!targetDir.exists()) {
            targetDir.mkdirs()
        }

        val targetFile = File(targetDir, mdFile.name)
        mdFile.renameTo(targetFile)
        return targetFile
    }

    public fun moveToStatus(mdFile: File, targetStatus: String, epic: String): File {
        val targetDir = resolveTasksPath("$targetStatus/$epic")

        if (!targetDir.exists()) {
            targetDir.mkdirs()
        }

        val targetFile = File(targetDir, mdFile.name)
        mdFile.renameTo(targetFile)
        return targetFile
    }

    public fun deleteCard(mdFile: File) {
        if (mdFile.exists()) {
            mdFile.delete()
        }
    }

    private fun resolveTasksPath(subPath: String): File {
        val basePath = project.basePath
            ?: throw IllegalStateException("No project base path")
        val settings = ArgustackSettings.getInstance(project)
        return File(basePath, "${settings.tasksDir}/$subPath")
    }

    public companion object {
        public fun getInstance(project: Project): CardFileService =
            project.getService(CardFileService::class.java)
    }
}
