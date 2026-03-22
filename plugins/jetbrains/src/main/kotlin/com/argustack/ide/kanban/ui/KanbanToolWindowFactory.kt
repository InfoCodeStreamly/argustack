package com.argustack.ide.kanban.ui

import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory
import com.intellij.ui.jcef.JBCefApp

public class KanbanToolWindowFactory : ToolWindowFactory, DumbAware {

    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        if (!JBCefApp.isSupported()) {
            val fallback = javax.swing.JLabel("JCEF is not supported. Argustack Board requires a Chromium-based IDE.")
            val content = ContentFactory.getInstance().createContent(fallback, null, false)
            toolWindow.contentManager.addContent(content)
            return
        }

        val kanbanWindow = KanbanToolWindow(project)
        val content = ContentFactory.getInstance().createContent(
            kanbanWindow.getComponent(),
            null,
            false,
        )
        toolWindow.contentManager.addContent(content)
    }

    override fun shouldBeAvailable(project: Project): Boolean = true
}
