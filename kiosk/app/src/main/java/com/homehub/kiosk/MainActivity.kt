package com.homehub.kiosk

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.InputType
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.Toast
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min

/**
 * Full-screen Home Hub for a wall frame.
 *
 * - Shows the Home Hub web app in a WebView, edge to edge, screen always on.
 * - Exposes `window.HomeHubNative` so the page can set the real backlight
 *   (setBrightness 0–1) or hand it to the light sensor (setAutoBrightness).
 * - Starts on boot, and can be picked as the home screen so the frame never shows anything else.
 * - First run (or a two-finger hold for 2 seconds) opens a setup box for the Home Hub address,
 *   e.g. https://your-app.vercel.app/?key=YOUR_ACCESS_KEY
 * - Its user agent contains "HomeHubKiosk", which turns on the parent lock by default.
 *
 * Remote debugging is off unless launched with: adb shell am start -n com.homehub.kiosk/.MainActivity --ez debug true
 */
class MainActivity : Activity(), SensorEventListener {
    private lateinit var web: WebView
    private val handler = Handler(Looper.getMainLooper())
    private val prefs by lazy { getSharedPreferences("kiosk", Context.MODE_PRIVATE) }

    private var sensorManager: SensorManager? = null
    private var lightSensor: Sensor? = null
    private var autoBrightness = false
    private var smoothedLux = -1f

    // ------------------------------------------------------------------ lifecycle
    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or WindowManager.LayoutParams.FLAG_FULLSCREEN)

        sensorManager = getSystemService(Context.SENSOR_SERVICE) as SensorManager?
        lightSensor = sensorManager?.getDefaultSensor(Sensor.TYPE_LIGHT)

        if (intent?.getBooleanExtra("debug", false) == true) WebView.setWebContentsDebuggingEnabled(true)

        web = WebView(this)
        web.setBackgroundColor(Color.parseColor("#F4F1EA"))
        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            userAgentString = "$userAgentString HomeHubKiosk/1.0"
        }
        web.addJavascriptInterface(Bridge(), "HomeHubNative")
        web.webViewClient = object : WebViewClient() {
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                // Wi-Fi not up yet after boot, or a blip: try again shortly.
                if (request.isForMainFrame) retryLater()
            }

            @android.annotation.TargetApi(26)
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                // The page's renderer crashed (low memory on small frames): start over.
                recreate()
                return true
            }
        }
        setContentView(FrameLayout(this).apply { addView(web) })

        val fromIntent = intent?.dataString
        if (fromIntent != null) saveUrl(fromIntent)
        val url = prefs.getString("url", null)
        if (url == null) askForUrl(first = true) else web.loadUrl(url)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.dataString?.let { saveUrl(it); web.loadUrl(it) }
    }

    override fun onResume() {
        super.onResume()
        hideSystemBars()
        if (autoBrightness) startSensor()
    }

    override fun onPause() {
        super.onPause()
        sensorManager?.unregisterListener(this)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    // Home and Back stay inside the app; the two-finger hold is the way out.
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack()
    }

    @Suppress("DEPRECATION")
    private fun hideSystemBars() {
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            or View.SYSTEM_UI_FLAG_FULLSCREEN
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_LAYOUT_STABLE)
    }

    private fun retryLater() {
        handler.removeCallbacksAndMessages("retry")
        handler.postAtTime({ prefs.getString("url", null)?.let { web.loadUrl(it) } }, "retry", android.os.SystemClock.uptimeMillis() + 10_000)
    }

    // ------------------------------------------------------------------ setup: the Home Hub address
    private fun saveUrl(url: String) {
        prefs.edit().putString("url", url.trim()).apply()
    }

    private fun askForUrl(first: Boolean) {
        val input = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            hint = "https://your-app.vercel.app/?key=…"
            setText(prefs.getString("url", ""))
        }
        val dialog = AlertDialog.Builder(this)
            .setTitle(if (first) "Welcome to Home Hub" else "Home Hub settings")
            .setMessage("Home Hub address, including ?key= with your household key:")
            .setView(input)
            .setPositiveButton("Save") { _, _ ->
                val url = input.text.toString().trim()
                if (url.startsWith("http")) {
                    saveUrl(url)
                    web.loadUrl(url)
                } else {
                    Toast.makeText(this, "That needs to start with https://", Toast.LENGTH_LONG).show()
                    askForUrl(first)
                }
            }
            .setCancelable(!first)
        if (!first) {
            dialog.setNeutralButton("Exit to Android") { _, _ ->
                startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            dialog.setNegativeButton("Reload") { _, _ -> web.reload() }
        }
        dialog.show()
    }

    // Hold two fingers still for 2 seconds to open the setup box.
    private var holdArmed = false
    private val openSetup = Runnable { holdArmed = false; askForUrl(first = false) }

    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        when (ev.actionMasked) {
            MotionEvent.ACTION_POINTER_DOWN -> if (ev.pointerCount == 2) {
                holdArmed = true
                handler.postDelayed(openSetup, 2000)
            }
            MotionEvent.ACTION_POINTER_UP, MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> if (holdArmed) {
                holdArmed = false
                handler.removeCallbacks(openSetup)
            }
        }
        return super.dispatchTouchEvent(ev)
    }

    // ------------------------------------------------------------------ brightness
    private fun setWindowBrightness(level: Float) {
        val lp = window.attributes
        lp.screenBrightness = level
        window.attributes = lp
    }

    private fun startSensor() {
        val s = lightSensor ?: return
        sensorManager?.registerListener(this, s, SensorManager.SENSOR_DELAY_NORMAL)
    }

    override fun onSensorChanged(event: SensorEvent) {
        if (!autoBrightness) return
        val lux = event.values[0]
        smoothedLux = if (smoothedLux < 0) lux else smoothedLux * 0.8f + lux * 0.2f
        // Roughly: a dark room (~1 lux) -> 8%, an evening living room (~50 lux) -> ~45%, daylight (500+) -> 100%.
        val level = (0.08f + 0.15f * ln(1f + smoothedLux)).let { max(0.05f, min(1f, it)) }
        setWindowBrightness(level)
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    /** Called from the page as window.HomeHubNative.* (runs on a background thread). */
    inner class Bridge {
        @JavascriptInterface
        fun setBrightness(level: Float) = runOnUiThread {
            autoBrightness = false
            sensorManager?.unregisterListener(this@MainActivity)
            setWindowBrightness(max(0.02f, min(1f, level)))
        }

        @JavascriptInterface
        fun setAutoBrightness(on: Boolean) = runOnUiThread {
            autoBrightness = on && lightSensor != null
            if (autoBrightness) {
                startSensor()
            } else {
                sensorManager?.unregisterListener(this@MainActivity)
                // No sensor: let the system's own brightness setting decide.
                setWindowBrightness(WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE)
            }
        }

        @JavascriptInterface
        fun hasLightSensor(): Boolean = lightSensor != null

        @JavascriptInterface
        fun version(): String = "1.0 (Android ${Build.VERSION.RELEASE})"
    }
}
