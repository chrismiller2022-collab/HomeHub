plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.homehub.kiosk"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.homehub.kiosk"
        minSdk = 23 // Android 6, what most cheap photo frames run
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    // A fixed key checked into the repo so every CI build is signed the same way and a new APK
    // installs over the old one (adb install -r). It's only for sideloading onto your own frame.
    signingConfigs {
        getByName("debug") {
            storeFile = file("homehub-kiosk.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }
    buildTypes {
        getByName("debug") {
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}
