package com.jkproducoes.tvplus

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import org.json.JSONObject

@SuppressLint("UnsafeOptInUsageError")
class PlayerActivity : Activity() {

    companion object {
        const val USER_AGENT = "TVPlusPlayer/1.0 (Linux; Android) ExoPlayer"
    }

    private lateinit var player: ExoPlayer
    private lateinit var view: PlayerView
    private lateinit var overlay: TextView
    private lateinit var loading: ProgressBar
    private val handler = Handler(Looper.getMainLooper())

    private val urls = ArrayList<String>()
    private val titles = ArrayList<String>()
    private var index = 0
    private var live = false
    private var triedAlt = false
    private var resizeMode = 0
    private var numberBuffer = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        hideSystemUi()

        val data = JSONObject(intent.getStringExtra("data") ?: "{}")
        val u = data.optJSONArray("urls")
        val t = data.optJSONArray("titles")
        if (u != null) for (i in 0 until u.length()) urls.add(u.getString(i))
        if (t != null) for (i in 0 until t.length()) titles.add(t.getString(i))
        index = data.optInt("index", 0).coerceIn(0, maxOf(0, urls.size - 1))
        live = data.optBoolean("live", false)

        val root = FrameLayout(this)
        root.setBackgroundColor(Color.BLACK)
        view = PlayerView(this)
        view.setShowBuffering(PlayerView.SHOW_BUFFERING_NEVER)
        view.useController = !live
        view.controllerShowTimeoutMs = 4000
        view.setKeepContentOnPlayerReset(false)
        root.addView(view, FrameLayout.LayoutParams(-1, -1))

        loading = ProgressBar(this)
        root.addView(loading, FrameLayout.LayoutParams(dp(56), dp(56), Gravity.CENTER))

        overlay = TextView(this)
        overlay.setTextColor(Color.WHITE)
        overlay.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
        overlay.setBackgroundColor(0xCC000000.toInt())
        overlay.setPadding(dp(18), dp(10), dp(18), dp(10))
        val lp = FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.START)
        lp.setMargins(dp(24), dp(24), dp(24), dp(24))
        root.addView(overlay, lp)
        overlay.visibility = View.GONE
        setContentView(root)

        val http = DefaultHttpDataSource.Factory()
            .setUserAgent(USER_AGENT)
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(15000)
            .setReadTimeoutMs(20000)
        val loadControl = DefaultLoadControl.Builder()
            .setBufferDurationsMs(15000, 50000, 2000, 4000)
            .build()
        player = ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(this).setDataSourceFactory(http))
            .setLoadControl(loadControl)
            .build()
        view.player = player
        player.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                loading.visibility = if (state == Player.STATE_BUFFERING) View.VISIBLE else View.GONE
                if (state == Player.STATE_READY) triedAlt = false
                if (state == Player.STATE_ENDED) {
                    if (live) {
                        start(urls.getOrNull(index) ?: return, false)
                    } else if (index < urls.size - 1) {
                        savePosition(0)
                        index++
                        start(urls[index], true)
                    } else {
                        savePosition(0)
                        finish()
                    }
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                val cur = urls.getOrNull(index) ?: return
                if (!triedAlt) {
                    triedAlt = true
                    val alt = when {
                        cur.endsWith(".ts") -> cur.removeSuffix(".ts") + ".m3u8"
                        cur.endsWith(".m3u8") -> cur.removeSuffix(".m3u8") + ".ts"
                        else -> null
                    }
                    if (alt != null) {
                        playUri(alt, false)
                        return
                    }
                    playUri(cur, false)
                    return
                }
                loading.visibility = View.GONE
                Toast.makeText(
                    this@PlayerActivity,
                    "Não foi possível reproduzir. Tente novamente ou escolha outro conteúdo.",
                    Toast.LENGTH_LONG
                ).show()
            }
        })

        if (urls.isEmpty()) {
            finish()
            return
        }
        start(urls[index], true)
    }

    private fun start(url: String, resume: Boolean) {
        triedAlt = false
        playUri(url, resume)
        showTitle()
    }

    private fun playUri(url: String, resume: Boolean) {
        player.setMediaItem(MediaItem.fromUri(Uri.parse(url)))
        player.prepare()
        if (resume && !live) {
            val pos = getPreferences(MODE_PRIVATE).getLong(urls[index], 0L)
            if (pos > 10000) player.seekTo(pos)
        }
        player.playWhenReady = true
    }

    private fun showTitle() {
        val title = titles.getOrNull(index) ?: return
        overlay.text = if (live) "${index + 1}  •  $title" else title
        overlay.visibility = View.VISIBLE
        handler.removeCallbacksAndMessages("title")
        handler.postAtTime({ overlay.visibility = View.GONE }, "title", android.os.SystemClock.uptimeMillis() + 3500)
    }

    private fun changeChannel(delta: Int) {
        if (urls.size < 2) return
        index = (index + delta + urls.size) % urls.size
        start(urls[index], false)
    }

    private fun goToNumber() {
        val n = numberBuffer.toIntOrNull()
        numberBuffer = ""
        if (n != null && n in 1..urls.size) {
            index = n - 1
            start(urls[index], false)
        }
    }

    private fun cycleResize() {
        resizeMode = (resizeMode + 1) % 3
        view.resizeMode = when (resizeMode) {
            1 -> AspectRatioFrameLayout.RESIZE_MODE_FILL
            2 -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM
            else -> AspectRatioFrameLayout.RESIZE_MODE_FIT
        }
        val name = when (resizeMode) { 1 -> "Tela cheia (esticar)"; 2 -> "Zoom"; else -> "Original" }
        Toast.makeText(this, name, Toast.LENGTH_SHORT).show()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN) {
            val code = event.keyCode
            if (live) {
                when (code) {
                    KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_CHANNEL_UP, KeyEvent.KEYCODE_PAGE_UP -> { changeChannel(-1); return true }
                    KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_CHANNEL_DOWN, KeyEvent.KEYCODE_PAGE_DOWN -> { changeChannel(1); return true }
                    KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_INFO -> { showTitle(); return true }
                    KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_MENU -> { cycleResize(); return true }
                }
                if (code in KeyEvent.KEYCODE_0..KeyEvent.KEYCODE_9) {
                    numberBuffer += (code - KeyEvent.KEYCODE_0).toString()
                    overlay.text = "Canal $numberBuffer"
                    overlay.visibility = View.VISIBLE
                    handler.removeCallbacksAndMessages("num")
                    handler.postAtTime({ goToNumber() }, "num", android.os.SystemClock.uptimeMillis() + 1800)
                    return true
                }
            } else {
                if (code == KeyEvent.KEYCODE_MENU) { cycleResize(); return true }
            }
        }
        if (!live && event.keyCode != KeyEvent.KEYCODE_BACK) {
            if (view.dispatchKeyEvent(event)) return true
        }
        return super.dispatchKeyEvent(event)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemUi()
    }

    @Suppress("DEPRECATION")
    private fun hideSystemUi() {
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN)
    }

    private fun savePosition(pos: Long) {
        if (live || urls.isEmpty()) return
        getPreferences(MODE_PRIVATE).edit().putLong(urls[index], pos).apply()
    }

    override fun onStart() {
        super.onStart()
        if (::player.isInitialized) player.playWhenReady = true
    }

    override fun onStop() {
        super.onStop()
        if (::player.isInitialized) {
            val d = player.duration
            val p = player.currentPosition
            if (d > 0 && p > d - 60000) savePosition(0) else savePosition(p)
            player.playWhenReady = false
        }
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        if (::player.isInitialized) player.release()
        super.onDestroy()
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
}
