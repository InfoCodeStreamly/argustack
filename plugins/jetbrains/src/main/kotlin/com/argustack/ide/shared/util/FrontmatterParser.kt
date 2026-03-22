package com.argustack.ide.shared.util

public data class ParsedMd(
    val title: String,
    val frontmatter: Map<String, String>,
)

public object FrontmatterParser {

    private val FRONTMATTER_REGEX: Regex = Regex(
        """^---\s*\n([\s\S]*?)\n---""",
    )

    private val HEADING_REGEX: Regex = Regex(
        """^#\s+(.+)""",
        RegexOption.MULTILINE,
    )

    public fun parse(content: String): ParsedMd {
        val frontmatter = extractFrontmatter(content)
        val title = extractTitle(content) ?: "Untitled"
        return ParsedMd(title = title, frontmatter = frontmatter)
    }

    private fun extractFrontmatter(content: String): Map<String, String> {
        val match = FRONTMATTER_REGEX.find(content) ?: return emptyMap()
        val block = match.groupValues[1]
        return block.lines()
            .filter { it.contains(':') }
            .associate { line ->
                val key = line.substringBefore(':').trim()
                val value = line.substringAfter(':').trim()
                key to value
            }
    }

    private fun extractTitle(content: String): String? {
        val withoutFrontmatter = FRONTMATTER_REGEX.replace(content, "").trim()
        return HEADING_REGEX.find(withoutFrontmatter)?.groupValues?.get(1)?.trim()
    }
}
