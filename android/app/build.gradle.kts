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
        versionCode = 7
        versionName = "0.5.2"

        // The one website this app is allowed to open (and the only one allowed to talk to the app's bridge).
        val appUrl = providers.gradleProperty("actionbrainUrl").getOrElse("https://action-brain-sigma.vercel.app").trimEnd('/')
        require(appUrl.startsWith("https://")) { "actionbrainUrl must start with https://" }
        buildConfigField("String", "APP_URL", "\"$appUrl\"")
    }

    buildFeatures {
        buildConfig = true
    }

    // Two builds of the same app:
    //  full: also contains the optional "live chat reading" (an Accessibility service). For your own phone.
    //  play: without it, for the Play Store, until Google approves the Accessibility declaration.
    flavorDimensions += "dist"
    productFlavors {
        create("full") {
            dimension = "dist"
            buildConfigField("boolean", "SCREEN_READING", "true")
        }
        create("play") {
            dimension = "dist"
            buildConfigField("boolean", "SCREEN_READING", "false")
        }
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
