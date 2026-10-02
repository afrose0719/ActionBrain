plugins {
    id("com.android.application")
}

android {
    namespace = "app.actionbrain.android"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.actionbrain.android"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"

        // The one website this app is allowed to open (and the only one allowed to talk to the app's bridge).
        val appUrl = providers.gradleProperty("actionbrainUrl").getOrElse("https://action-brain-sigma.vercel.app").trimEnd('/')
        require(appUrl.startsWith("https://")) { "actionbrainUrl must start with https://" }
        buildConfigField("String", "APP_URL", "\"$appUrl\"")
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    // No libraries on purpose: fewer downloads, nothing to keep updated. Only the tests need one.
    testImplementation("junit:junit:4.13.2")
}
