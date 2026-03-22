plugins {
    alias(libs.plugins.kotlin)
    alias(libs.plugins.kotlinSerialization)
    alias(libs.plugins.intellijPlatform)
    alias(libs.plugins.detekt)
    alias(libs.plugins.kover)
}

group = providers.gradleProperty("pluginGroup").get()
version = providers.gradleProperty("pluginVersion").get()

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        create(
            providers.gradleProperty("platformType").get(),
            providers.gradleProperty("platformVersion").get(),
        )
        testFramework(org.jetbrains.intellij.platform.gradle.TestFrameworkType.Platform)
        bundledPlugin("org.jetbrains.plugins.terminal")
    }

    implementation(libs.kotlinx.serialization.json)

    testImplementation(libs.junit.jupiter)
}

detekt {
    buildUponDefaultConfig = true
    allRules = true
    config.setFrom(file("detekt.yml"))
    parallel = true
    source.setFrom("src/main/kotlin")
}

intellijPlatform {
    pluginConfiguration {
        id = "com.argustack.ide"
        name = "Argustack"
        version = providers.gradleProperty("pluginVersion").get()
        description = """
            Kanban board where columns are executable AI skills.
            Drag a task card to a skill column — Claude Code executes the skill automatically.
            Visual pipeline for plan → implement → test → review → deploy.
        """.trimIndent()

        ideaVersion {
            sinceBuild = "233"
        }

        vendor {
            name = "CodeStreamly"
            email = "info@codestreamly.com"
            url = "https://github.com/InfoCodeStreamly/argustack"
        }
    }

    signing {
        certificateChainFile.set(
            file(System.getenv("PLUGIN_CERT_CHAIN") ?: "certificate/chain.crt")
        )
        privateKeyFile.set(
            file(System.getenv("PLUGIN_PRIVATE_KEY") ?: "certificate/private.pem")
        )
        password.set(System.getenv("PLUGIN_KEY_PASSWORD") ?: "")
    }

    publishing {
        token.set(System.getenv("MARKETPLACE_TOKEN") ?: "")
    }
}

tasks {
    withType<JavaCompile> {
        sourceCompatibility = providers.gradleProperty("javaVersion").get()
        targetCompatibility = providers.gradleProperty("javaVersion").get()
    }

    withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile> {
        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_21)
            allWarningsAsErrors.set(true)
            freeCompilerArgs.addAll(
                "-Xexplicit-api=strict",
            )
        }
    }

    register<Exec>("buildWebview") {
        workingDir = file("webview")
        commandLine("npm", "run", "build")
    }

    named("processResources") {
        dependsOn("buildWebview")
    }

    test {
        useJUnitPlatform()
    }
}
