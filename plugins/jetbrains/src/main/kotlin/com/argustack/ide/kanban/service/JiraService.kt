package com.argustack.ide.kanban.service

import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.project.Project
import java.io.File
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.Base64

private val LOG = logger<JiraService>()

@Service(Service.Level.PROJECT)
public class JiraService(
    private val project: Project,
) {

    public fun isConfigured(): Boolean {
        val env = loadEnv()
        return env[ENV_JIRA_URL] != null &&
            env[ENV_JIRA_TOKEN] != null &&
            env[ENV_JIRA_EMAIL] != null
    }

    public fun createIssue(projectKey: String, summary: String): String? =
        try {
            val env = loadEnv()
            val request = buildCreateRequest(env, projectKey, summary)
            if (request == null) return null
            parseIssueKey(HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString()))
        } catch (@Suppress("TooGenericExceptionCaught") e: Exception) {
            LOG.error("Jira create error: ${e.message}", e)
            null
        }

    private fun buildCreateRequest(
        env: Map<String, String>,
        projectKey: String,
        summary: String,
    ): HttpRequest? {
        val jiraUrl = env[ENV_JIRA_URL]
        val email = env[ENV_JIRA_EMAIL]
        val token = env[ENV_JIRA_TOKEN]
        if (jiraUrl == null || email == null || token == null) return null

        val body = buildString {
            append("""{"fields":{"project":{"key":"$projectKey"},""")
            append(""""summary":"$summary",""")
            append(""""issuetype":{"name":"Task"}}}""")
        }
        val auth = Base64.getEncoder().encodeToString("$email:$token".toByteArray())

        return HttpRequest.newBuilder()
            .uri(URI.create("${jiraUrl.trimEnd('/')}/rest/api/3/issue"))
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .header("Authorization", "Basic $auth")
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build()
    }

    private fun parseIssueKey(response: HttpResponse<String>): String? {
        if (response.statusCode() != CREATED_STATUS) {
            LOG.warn("Jira create failed: ${response.statusCode()} ${response.body()}")
            return null
        }
        val keyMatch = Regex(""""key"\s*:\s*"([^"]+)"""").find(response.body())
        val issueKey = keyMatch?.groupValues?.get(1)
        LOG.info("Jira issue created: $issueKey")
        return issueKey
    }

    private fun loadEnv(): Map<String, String> {
        val basePath = project.basePath ?: return emptyMap()
        val envFile = File(basePath, ".env")
        if (!envFile.isFile) return emptyMap()

        return envFile.readLines()
            .filter { it.contains('=') && !it.trimStart().startsWith('#') }
            .associate { line ->
                val idx = line.indexOf('=')
                line.substring(0, idx).trim() to line.substring(idx + 1).trim()
            }
    }

    public companion object {
        private const val CREATED_STATUS: Int = 201
        private const val ENV_JIRA_URL: String = "JIRA_URL"
        private const val ENV_JIRA_EMAIL: String = "JIRA_EMAIL"
        private const val ENV_JIRA_TOKEN: String = "JIRA_API_TOKEN"

        public fun getInstance(project: Project): JiraService =
            project.getService(JiraService::class.java)
    }
}
