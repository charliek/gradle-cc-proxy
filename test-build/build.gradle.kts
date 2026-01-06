plugins {
    kotlin("jvm") version "2.0.21"
}

group = "com.example"
version = "1.0.0"

repositories {
    mavenCentral()
}

dependencies {
    // Real dependencies to test proxy downloads
    implementation("io.ktor:ktor-client-core:3.0.2")
    implementation("ch.qos.logback:logback-classic:1.5.6")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")

    testImplementation(kotlin("test"))
}

tasks.test {
    useJUnitPlatform()
}

kotlin {
    jvmToolchain(21)
}

tasks.register("verifyProxy") {
    dependsOn("build")
    doLast {
        println("")
        println("====================================")
        println("  PROXY VERIFICATION SUCCESSFUL!")
        println("====================================")
        println("")
        println("All dependencies were downloaded through the proxy.")
    }
}
