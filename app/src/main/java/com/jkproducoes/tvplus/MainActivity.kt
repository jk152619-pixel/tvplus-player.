package com.jkproducoes.tvplus

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : Activity() {

    private lateinit var web: WebView

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        web.setBackgroundColor(Color.BLACK)
        val s = web.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.allowFileAccess = true
        s.mediaPlaybackRequiresUserGesture = false
        s.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        s.loadWithOverviewMode = true
        s.useWideViewPort = true
        s.textZoom = 100
        web.isFocusable = true
        web.isFocusableInTouchMode = true
        web.addJavascriptInterface(Bridge(), "Native")
        web.webViewClient = WebViewClient()
        setContentView(web)
        web.loadUrl("file:///android_asset/www/index.html")
        web.requestFocus()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        web.evaluateJavascript("(window.appBack ? appBack() : false)") { r ->
            if (r != "true") finish()
        }
    }

    private fun deliver(id: String, ok: Boolean, text: String) {
        val b64 = Base64.encodeToString(text.toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
        runOnUiThread {
            web.evaluateJavascript("window.__nativeCb('$id',$ok,'$b64')", null)
        }
    }

    inner class Bridge {
        @JavascriptInterface
        fun get(id: String, url: String) {
            Thread {
                try {
                    var target = url
                    var conn: HttpURLConnection
                    var redirects = 0
                    while (true) {
                        conn = URL(target).openConnection() as HttpURLConnection
                        conn.connectTimeout = 15000
                        conn.readTimeout = 45000
                        conn.instanceFollowRedirects = false
                        conn.setRequestProperty("User-Agent", PlayerActivity.USER_AGENT)
                        val code = conn.responseCode
                        if (code in 300..399 && redirects < 5) {
                            val loc = conn.getHeaderField("Location")
                            conn.disconnect()
                            if (loc == null) break
                            target = URL(URL(target), loc).toString()
                            redirects++
                            continue
                        }
                        break
                    }
                    val code = conn.responseCode
                    val stream = if (code < 400) conn.inputStream else conn.errorStream
                    val body = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
                    conn.disconnect()
                    deliver(id, code < 400, if (code < 400) body else "HTTP $code")
                } catch (e: Throwable) {
                    deliver(id, false, e.javaClass.simpleName + ": " + (e.message ?: ""))
                }
            }.start()
        }

        @JavascriptInterface
        fun play(json: String) {
            val i = Intent(this@MainActivity, PlayerActivity::class.java)
            i.putExtra("data", json)
            runOnUiThread { startActivity(i) }
        }

        @JavascriptInterface
        fun exit() {
            runOnUiThread { finish() }
        }

        @JavascriptInterface
        fun isApp(): Boolean = true
    }
}
