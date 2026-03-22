package com.argustack.ide.skills.service

import com.argustack.ide.shared.util.FrontmatterParser
import com.argustack.ide.skills.model.Skill
import com.argustack.ide.skills.model.SkillSource
import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project
import java.io.File

@Service(Service.Level.PROJECT)
public class SkillDiscoveryService(
    private val project: Project,
) {

    public fun discoverSkills(): List<Skill> {
        val skills = mutableMapOf<String, Skill>()

        val personalDir = File(System.getProperty("user.home"), ".claude/skills")
        scanSkillsDir(personalDir, SkillSource.PERSONAL).forEach { skill ->
            skills[skill.name] = skill
        }

        val projectBase = project.basePath ?: return skills.values.toList()
        val projectDir = File(projectBase, ".claude/skills")
        scanSkillsDir(projectDir, SkillSource.PROJECT).forEach { skill ->
            skills[skill.name] = skill
        }

        return skills.values.toList()
    }

    private fun scanSkillsDir(dir: File, source: SkillSource): List<Skill> {
        if (!dir.isDirectory) return emptyList()

        val entries = dir.listFiles() ?: return emptyList()
        return entries
            .filter { it.isDirectory }
            .mapNotNull { skillDir -> buildSkill(skillDir, source) }
    }

    private fun buildSkill(skillDir: File, source: SkillSource): Skill? {
        val skillMd = File(skillDir, "SKILL.md")
        if (!skillMd.isFile) return null

        val description = extractDescription(skillMd)
        return Skill(
            name = skillDir.name,
            description = description,
            source = source,
            path = skillDir.absolutePath,
        )
    }

    private fun extractDescription(skillMd: File): String {
        val content = skillMd.readText()
        val parsed = FrontmatterParser.parse(content)
        return parsed.frontmatter["description"]?.trim('"') ?: ""
    }

    public companion object {
        public fun getInstance(project: Project): SkillDiscoveryService =
            project.getService(SkillDiscoveryService::class.java)
    }
}
