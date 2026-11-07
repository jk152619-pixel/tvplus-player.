package com.jkproducoes.tvplus

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.FileProvider
import java.io.File
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : Activity() {

    private lateinit var web: WebView
    private var pendingApk: File? = null
    private var updating = false

    companion object {
        /** Onde fica o APK novo (gerado automaticamente pelo GitHub a cada envio). */
        private const val UPDATE_BASE = "https://github.com/plustv542/tvplus-player./releases/download/latest/"
        private const val REQ_UNKNOWN_SOURCES = 77
    }

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
        // Confere se tem versão nova alguns segundos depois de abrir
        Handler(Looper.getMainLooper()).postDelayed({ checkUpdate(false) }, 4000)
    }

    // ------------------------------------------------------------ atualização automática
    private fun localVersion(): Long = try {
        val pi = packageManager.getPackageInfo(packageName, 0)
        if (Build.VERSION.SDK_INT >= 28) pi.longVersionCode else @Suppress("DEPRECATION") pi.versionCode.toLong()
    } catch (e: Exception) { 0L }

    private fun openUrl(url: String): HttpURLConnection {
        var target = url
        var redirects = 0
        while (true) {
            val conn = URL(target).openConnection() as HttpURLConnection
            conn.connectTimeout = 15000
            conn.readTimeout = 45000
            conn.instanceFollowRedirects = false
            conn.setRequestProperty("User-Agent", PlayerActivity.USER_AGENT)
            val code = conn.responseCode
            if (code in 300..399 && redirects < 8) {
                val loc = conn.getHeaderField("Location")
                conn.disconnect()
                if (loc == null) return conn
                target = URL(URL(target), loc).toString()
                redirects++
                continue
            }
            return conn
        }
    }

    private fun checkUpdate(manual: Boolean) {
        if (updating) return
        Thread {
            var remote = -1L
            try {
                val c = openUrl(UPDATE_BASE + "version.txt?t=" + System.currentTimeMillis())
                if (c.responseCode == 200) remote = c.inputStream.bufferedReader().use { it.readText() }.trim().toLongOrNull() ?: -1L
                c.disconnect()
            } catch (_: Throwable) {}
            runOnUiThread {
                if (isFinishing) return@runOnUiThread
                when {
                    remote > localVersion() -> askUpdate(remote)
                    manual && remote < 0 -> Toast.makeText(this, "Não foi possível verificar agora. Tente mais tarde.", Toast.LENGTH_LONG).show()
                    manual -> Toast.makeText(this, "✔ Você já está na versão mais nova", Toast.LENGTH_LONG).show()
                }
            }
        }.start()
    }

    private fun askUpdate(remote: Long) {
        val d = AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("Atualização disponível")
            .setMessage("Tem uma versão nova do TVPlus+ (1.0.$remote).\nSeu login e seus favoritos continuam salvos.")
            .setPositiveButton("ATUALIZAR AGORA") { _, _ -> downloadUpdate() }
            .setNegativeButton("Depois", null)
            .create()
        d.show()
        d.getButton(AlertDialog.BUTTON_POSITIVE)?.requestFocus()
    }

    private fun downloadUpdate() {
        updating = true
        val box = LinearLayout(this)
        box.orientation = LinearLayout.VERTICAL
        val pad = (20 * resources.displayMetrics.density).toInt()
        box.setPadding(pad, pad, pad, pad)
        val txt = TextView(this)
        txt.text = "Baixando atualização... 0%"
        txt.setTextColor(Color.WHITE)
        txt.textSize = 17f
        box.addView(txt)
        val bar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal)
        bar.max = 100
        box.addView(bar)
        val dlg = AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("TVPlus+")
            .setView(box)
            .setCancelable(false)
            .create()
        dlg.show()
        Thread {
            try {
                val dir = if (Build.VERSION.SDK_INT < 24) (externalCacheDir ?: cacheDir) else cacheDir
                val f = File(dir, "TVPlus-update.apk")
                if (f.exists()) f.delete()
                val c = openUrl(UPDATE_BASE + "TVPlus.apk")
                if (c.responseCode != 200) throw Exception("HTTP " + c.responseCode)
                val total = c.contentLengthLong
                c.inputStream.use { input ->
                    f.outputStream().use { out ->
                        val buf = ByteArray(64 * 1024)
                        var done = 0L
                        var last = -1
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            out.write(buf, 0, n)
                            done += n
                            if (total > 0) {
                                val pct = (done * 100 / total).toInt()
                                if (pct != last) { last = pct; runOnUiThread { bar.progress = pct; txt.text = "Baixando atualização... $pct%" } }
                            }
                        }
                    }
                }
                c.disconnect()
                if (Build.VERSION.SDK_INT < 24) f.setReadable(true, false)
                runOnUiThread { dlg.dismiss(); updating = false; installApk(f) }
            } catch (e: Throwable) {
                runOnUiThread {
                    dlg.dismiss(); updating = false
                    Toast.makeText(this, "Não foi possível baixar a atualização. Verifique a internet e tente de novo.", Toast.LENGTH_LONG).show()
                }
            }
        }.start()
    }

    private fun installApk(f: File) {
        if (Build.VERSION.SDK_INT >= 26 && !packageManager.canRequestPackageInstalls()) {
            pendingApk = f
            Toast.makeText(this, "Ative \"Permitir desta fonte\" para o TVPlus+ e volte", Toast.LENGTH_LONG).show()
            try {
                @Suppress("DEPRECATION")
                startActivityForResult(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")), REQ_UNKNOWN_SOURCES)
                return
            } catch (_: Exception) { /* alguns aparelhos não têm essa tela: tenta instalar mesmo assim */ }
        }
        try {
            val uri = if (Build.VERSION.SDK_INT >= 24) FileProvider.getUriForFile(this, "$packageName.files", f) else Uri.fromFile(f)
            val i = Intent(Intent.ACTION_VIEW)
            i.setDataAndType(uri, "application/vnd.android.package-archive")
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            startActivity(i)
        } catch (e: Exception) {
            Toast.makeText(this, "Não foi possível abrir o instalador. Atualize pelo código do Downloader.", Toast.LENGTH_LONG).show()
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_UNKNOWN_SOURCES) {
            val f = pendingApk ?: return
            pendingApk = null
            if (Build.VERSION.SDK_INT < 26 || packageManager.canRequestPackageInstalls()) installApk(f)
            else Toast.makeText(this, "Sem essa permissão não dá para atualizar pelo app.", Toast.LENGTH_LONG).show()
        }
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

        @JavascriptInterface
        fun checkUpdate() { runOnUiThread { this@MainActivity.checkUpdate(true) } }

        @JavascriptInterface
        fun version(): String = try {
            @Suppress("DEPRECATION")
            packageManager.getPackageInfo(packageName, 0).versionName ?: ""
        } catch (e: Exception) { "" }
    }
}
