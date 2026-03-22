package com.argustack.ide.shared.config

import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.openapi.project.Project

@Service(Service.Level.PROJECT)
@State(
    name = "ArgustackSettings",
    storages = [Storage("argustack.xml")],
)
public class ArgustackSettings :
    PersistentStateComponent<ArgustackSettings.SettingsState> {

    private var settingsState: SettingsState = SettingsState()

    public val tasksDir: String get() = settingsState.tasksDir
    public val defaultEpic: String get() = settingsState.defaultEpic
    public val sidecarPort: Int get() = settingsState.sidecarPort

    override fun getState(): SettingsState = settingsState

    override fun loadState(loaded: SettingsState) {
        settingsState = loaded
    }

    @Suppress("DataClassShouldBeImmutable")
    public data class SettingsState(
        var tasksDir: String = DEFAULT_TASKS_DIR,
        var defaultEpic: String = DEFAULT_EPIC,
        var sidecarPort: Int = DEFAULT_SIDECAR_PORT,
    )

    public companion object {
        public const val DEFAULT_TASKS_DIR: String = "Docs/Tasks"
        public const val DEFAULT_EPIC: String = "Uncategorized"
        public const val DEFAULT_SIDECAR_PORT: Int = 3100

        public fun getInstance(project: Project): ArgustackSettings =
            project.getService(ArgustackSettings::class.java)
    }
}
