package com.argustack.ide.kanban.ui

import com.argustack.ide.kanban.bridge.KanbanBridge
import com.intellij.openapi.project.Project
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefBrowserBase
import com.intellij.ui.jcef.JBCefJSQuery
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefLoadHandlerAdapter
import org.cef.handler.CefRequestHandlerAdapter
import org.cef.handler.CefResourceRequestHandler
import org.cef.handler.CefResourceRequestHandlerAdapter
import org.cef.handler.CefResourceHandler
import org.cef.misc.IntRef
import org.cef.misc.StringRef
import org.cef.network.CefRequest
import org.cef.network.CefResponse
import org.cef.callback.CefCallback
import java.awt.BorderLayout
import java.io.ByteArrayOutputStream
import javax.swing.JComponent
import javax.swing.JPanel

public class KanbanToolWindow(
    private val project: Project,
) {

    private val panel: JPanel = JPanel(BorderLayout())
    private val browser: JBCefBrowser = JBCefBrowser()
    private var bridge: KanbanBridge? = null

    init {
        panel.add(browser.component, BorderLayout.CENTER)
        setupResourceHandler()
        setupBridge()
        setupFileWatcher()
        setupExecutionStateListener()
        loadWebview()
    }

    public fun getComponent(): JComponent = panel

    private fun setupResourceHandler() {
        browser.jbCefClient.addRequestHandler(object : CefRequestHandlerAdapter() {
            override fun getResourceRequestHandler(
                cefBrowser: CefBrowser?,
                frame: CefFrame?,
                request: CefRequest?,
                isNavigation: Boolean,
                isDownload: Boolean,
                requestInitiator: String?,
                disableDefaultHandling: org.cef.misc.BoolRef?,
            ): CefResourceRequestHandler? {
                val url = request?.url ?: return null
                if (url.startsWith("https://argustack-plugin/")) {
                    return object : CefResourceRequestHandlerAdapter() {
                        override fun getResourceHandler(
                            browser: CefBrowser?,
                            frame: CefFrame?,
                            request: CefRequest?,
                        ): CefResourceHandler =
                            ClasspathResourceHandler(url)
                    }
                }
                return null
            }
        }, browser.cefBrowser)
    }

    private fun setupBridge() {
        val jsQuery = JBCefJSQuery.create(browser as JBCefBrowserBase)
        val kanbanBridge = KanbanBridge(project, browser, jsQuery)
        bridge = kanbanBridge

        jsQuery.addHandler { message: String ->
            kanbanBridge.handleMessage(message)
            JBCefJSQuery.Response("ok")
        }

        browser.jbCefClient.addLoadHandler(object : CefLoadHandlerAdapter() {
            override fun onLoadEnd(
                cefBrowser: CefBrowser?,
                frame: CefFrame?,
                httpStatusCode: Int,
            ) {
                injectBridge(jsQuery)
                injectThemeVariables()
                kanbanBridge.sendInitialState()
            }
        }, browser.cefBrowser)
    }

    private fun injectBridge(jsQuery: JBCefJSQuery) {
        val injection = """
            window.sendToPlugin = function(message) {
                ${jsQuery.inject("message")}
            };
        """.trimIndent()
        browser.cefBrowser.executeJavaScript(injection, browser.cefBrowser.url, 0)
    }

    private fun injectThemeVariables() {
        val bg = colorToHex(javax.swing.UIManager.getColor("Panel.background"))
        val fg = colorToHex(javax.swing.UIManager.getColor("Panel.foreground"))
        val border = colorToHex(javax.swing.UIManager.getColor("Borders.color"))

        val css = """
            document.documentElement.style.setProperty('--ide-bg', '$bg');
            document.documentElement.style.setProperty('--ide-fg', '$fg');
            document.documentElement.style.setProperty('--ide-border', '$border');
        """.trimIndent()
        browser.cefBrowser.executeJavaScript(css, browser.cefBrowser.url, 0)
    }

    private fun setupExecutionStateListener() {
        val terminalService = com.argustack.ide.terminal.service.TerminalService.getInstance(project)
        terminalService.addStateListener { cardId, state ->
            bridge?.sendExecutionStateToWebview(cardId, state)
            val svc = com.argustack.ide.kanban.service.KanbanStateService.getInstance(project)
            svc.updateCardExecutionState(cardId, state)
        }
    }

    private fun setupFileWatcher() {
        val fileWatcher = com.argustack.ide.filewatcher.service.TaskFileWatcher.getInstance(project)
        fileWatcher.addListener { _ ->
            com.argustack.ide.kanban.service.KanbanStateService.getInstance(project).loadState()
            bridge?.sendInitialState()
        }
    }

    private fun loadWebview() {
        browser.loadURL("https://argustack-plugin/index.html")
    }

    private fun colorToHex(color: java.awt.Color?): String {
        if (color == null) return "#000000"
        return "#%02x%02x%02x".format(color.red, color.green, color.blue)
    }
}

private class ClasspathResourceHandler(
    private val url: String,
) : CefResourceHandler {

    private var data: ByteArray? = null
    private var offset: Int = 0
    private var mimeType: String = "text/html"

    override fun processRequest(request: CefRequest?, callback: CefCallback?): Boolean {
        val path = url.removePrefix("https://argustack-plugin/")
        val resourcePath = "/webview/$path"

        val stream = javaClass.getResourceAsStream(resourcePath)
        if (stream != null) {
            val baos = ByteArrayOutputStream()
            stream.use { it.copyTo(baos) }
            data = baos.toByteArray()
            mimeType = guessMimeType(path)
            offset = 0
            callback?.Continue()
            return true
        }

        callback?.cancel()
        return false
    }

    override fun getResponseHeaders(response: CefResponse?, responseLength: IntRef?, redirectUrl: StringRef?) {
        response?.mimeType = mimeType
        response?.status = if (data != null) HTTP_OK else HTTP_NOT_FOUND
        responseLength?.set(data?.size ?: 0)
    }

    override fun readResponse(
        dataOut: ByteArray?,
        bytesToRead: Int,
        bytesRead: IntRef?,
        callback: CefCallback?,
    ): Boolean {
        val bytes = data ?: return false
        if (offset >= bytes.size) return false

        val available = bytes.size - offset
        val toRead = minOf(bytesToRead, available)
        System.arraycopy(bytes, offset, dataOut, 0, toRead)
        offset += toRead
        bytesRead?.set(toRead)
        return true
    }

    override fun cancel() {
        data = null
    }

    private fun guessMimeType(path: String): String = when {
        path.endsWith(".html") -> "text/html"
        path.endsWith(".css") -> "text/css"
        path.endsWith(".js") -> "application/javascript"
        path.endsWith(".json") -> "application/json"
        path.endsWith(".svg") -> "image/svg+xml"
        path.endsWith(".png") -> "image/png"
        else -> "application/octet-stream"
    }

    private companion object {
        private const val HTTP_OK: Int = 200
        private const val HTTP_NOT_FOUND: Int = 404
    }
}
