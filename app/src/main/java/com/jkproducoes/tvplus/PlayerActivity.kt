package com.jkproducoes.tvplus

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ListView
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
import androidx.media3.ui.DefaultTimeBar
import androidx.media3.ui.PlayerView
import org.json.JSONObject

@SuppressLint("UnsafeOptInUsageError", "SetTextI18n")
class PlayerActivity : Activity() {

    companion object {
        const val USER_AGENT = "TVPlusPlayer/1.0 (Linux; Android) ExoPlayer"
        private const val GOLD = 0xFFF7BF1A.toInt()
    }

    private lateinit var player: ExoPlayer
    private lateinit var view: PlayerView
    private lateinit var topBar: LinearLayout
    private lateinit var titleView: TextView
    private lateinit var bottomBar: LinearLayout
    private lateinit var listPanel: LinearLayout
    private lateinit var listView: ListView
    private lateinit var loading: ProgressBar
    private lateinit var numberView: TextView
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
        if (urls.isEmpty()) { finish(); return }

        buildUi()

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
                        playUri(urls[index], false)
                    } else if (index < urls.size - 1) {
                        savePosition(0)
                        index++
                        start(true)
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
                        else -> cur
                    }
                    playUri(alt, false)
                    return
                }
                loading.visibility = View.GONE
                Toast.makeText(
                    this@PlayerActivity,
                    "Não foi possível reproduzir. Tente novamente ou escolha outro conteúdo.",
                    Toast.LENGTH_LONG
                ).show()
                showBars()
            }
        })
        start(true)
    }

    // ------------------------------------------------------------ interface
    private fun buildUi() {
        val root = FrameLayout(this)
        root.setBackgroundColor(Color.BLACK)

        view = PlayerView(this)
        view.setShowBuffering(PlayerView.SHOW_BUFFERING_NEVER)
        view.useController = !live
        view.controllerShowTimeoutMs = 4000
        view.setShowNextButton(false)
        view.setShowPreviousButton(false)
        root.addView(view, FrameLayout.LayoutParams(-1, -1))

        // Tocar na tela (TV ao vivo) mostra/esconde as barras
        if (live) {
            val touch = View(this)
            touch.setOnClickListener { if (barsVisible()) hideBars() else showBars() }
            root.addView(touch, FrameLayout.LayoutParams(-1, -1))
        }

        loading = ProgressBar(this)
        root.addView(loading, FrameLayout.LayoutParams(dp(56), dp(56), Gravity.CENTER))

        // Barra de cima: Voltar + nome + tamanho da tela
        topBar = LinearLayout(this)
        topBar.orientation = LinearLayout.HORIZONTAL
        topBar.gravity = Gravity.CENTER_VERTICAL
        topBar.setPadding(dp(16), dp(14), dp(16), dp(26))
        topBar.background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(0xE6000000.toInt(), 0x00000000))
        topBar.addView(button("◀  Voltar") { finish() })
        titleView = TextView(this)
        titleView.setTextColor(Color.WHITE)
        titleView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 19f)
        titleView.setTypeface(titleView.typeface, Typeface.BOLD)
        titleView.maxLines = 1
        titleView.ellipsize = TextUtils.TruncateAt.END
        titleView.setPadding(dp(16), 0, dp(8), 0)
        topBar.addView(titleView, LinearLayout.LayoutParams(0, -2, 1f))
        topBar.addView(button("⛶  Tela") { cycleResize() })
        root.addView(topBar, FrameLayout.LayoutParams(-1, -2, Gravity.TOP))

        // Barra de baixo (TV ao vivo): canal anterior / lista / próximo
        bottomBar = LinearLayout(this)
        bottomBar.orientation = LinearLayout.HORIZONTAL
        bottomBar.gravity = Gravity.CENTER
        bottomBar.setPadding(dp(16), dp(26), dp(16), dp(18))
        bottomBar.background = GradientDrawable(GradientDrawable.Orientation.BOTTOM_TOP, intArrayOf(0xE6000000.toInt(), 0x00000000))
        bottomBar.addView(button("▲  Anterior") { changeChannel(-1) })
        bottomBar.addView(button("☰  Lista de canais") { openList() })
        bottomBar.addView(button("Próximo  ▼") { changeChannel(1) })
        root.addView(bottomBar, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM))

        // Lista de canais (painel lateral)
        listPanel = LinearLayout(this)
        listPanel.orientation = LinearLayout.VERTICAL
        listPanel.setBackgroundColor(0xF2101014.toInt())
        val headRow = LinearLayout(this)
        headRow.orientation = LinearLayout.HORIZONTAL
        headRow.gravity = Gravity.CENTER_VERTICAL
        headRow.setPadding(dp(12), dp(12), dp(12), dp(8))
        val head = TextView(this)
        head.text = "Canais"
        head.setTextColor(GOLD)
        head.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
        head.setTypeface(head.typeface, Typeface.BOLD)
        headRow.addView(head, LinearLayout.LayoutParams(0, -2, 1f))
        headRow.addView(button("✕  Fechar") { closeList() })
        listPanel.addView(headRow)
        listView = ListView(this)
        listView.divider = null
        listView.selector = focusBg(0x00000000, 0x55F7BF1A)
        val labels = titles.mapIndexed { i, s -> "${i + 1}   $s" }
        listView.adapter = object : ArrayAdapter<String>(this, android.R.layout.simple_list_item_1, labels) {
            override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
                val v = super.getView(position, convertView, parent) as TextView
                v.setTextColor(if (position == index) GOLD else Color.WHITE)
                v.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
                v.setSingleLine(true)
                v.ellipsize = TextUtils.TruncateAt.END
                v.setPadding(dp(16), dp(10), dp(16), dp(10))
                return v
            }
        }
        listView.onItemClickListener = AdapterView.OnItemClickListener { _, _, pos, _ ->
            index = pos
            closeList()
            start(false)
        }
        listPanel.addView(listView, LinearLayout.LayoutParams(-1, 0, 1f))
        root.addView(listPanel, FrameLayout.LayoutParams(dp(330), -1, Gravity.START))
        listPanel.visibility = View.GONE

        numberView = TextView(this)
        numberView.setTextColor(GOLD)
        numberView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 34f)
        numberView.setTypeface(numberView.typeface, Typeface.BOLD)
        numberView.setBackgroundColor(0xCC000000.toInt())
        numberView.setPadding(dp(20), dp(8), dp(20), dp(8))
        val nlp = FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.END)
        nlp.setMargins(0, dp(80), dp(24), 0)
        root.addView(numberView, nlp)
        numberView.visibility = View.GONE

        bottomBar.visibility = View.GONE
        topBar.visibility = View.GONE
        if (!live) {
            view.setControllerVisibilityListener(PlayerView.ControllerVisibilityListener { vis ->
                topBar.visibility = vis
            })
        }
        setContentView(root)
    }

    private fun focusBg(normal: Int, focused: Int): StateListDrawable {
        fun shape(c: Int, stroke: Boolean): GradientDrawable {
            val g = GradientDrawable()
            g.cornerRadius = dp(10).toFloat()
            g.setColor(c)
            if (stroke) g.setStroke(dp(2), GOLD)
            return g
        }
        val s = StateListDrawable()
        s.addState(intArrayOf(android.R.attr.state_focused), shape(focused, true))
        s.addState(intArrayOf(android.R.attr.state_pressed), shape(focused, true))
        s.addState(intArrayOf(), shape(normal, false))
        return s
    }

    private fun button(text: String, action: () -> Unit): TextView {
        val b = TextView(this)
        b.text = text
        b.setTextColor(Color.WHITE)
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
        b.setTypeface(b.typeface, Typeface.BOLD)
        b.setPadding(dp(16), dp(10), dp(16), dp(10))
        b.background = focusBg(0xB3202024.toInt(), 0xE6403000.toInt())
        b.isFocusable = true
        b.isClickable = true
        b.setOnClickListener { action(); scheduleHide() }
        val lp = LinearLayout.LayoutParams(-2, -2)
        lp.setMargins(dp(6), 0, dp(6), 0)
        b.layoutParams = lp
        return b
    }

    private fun barsVisible() = topBar.visibility == View.VISIBLE

    private fun showBars() {
        topBar.visibility = View.VISIBLE
        if (live) bottomBar.visibility = View.VISIBLE else view.showController()
        scheduleHide()
    }

    private fun hideBars() {
        if (listPanel.visibility == View.VISIBLE) return
        topBar.visibility = View.GONE
        bottomBar.visibility = View.GONE
        if (!live) view.hideController()
    }

    private fun scheduleHide() {
        handler.removeCallbacksAndMessages("hide")
        if (live) handler.postAtTime({ hideBars() }, "hide", SystemClock.uptimeMillis() + 5000)
    }

    private fun openList() {
        handler.removeCallbacksAndMessages("hide")
        listPanel.visibility = View.VISIBLE
        topBar.visibility = View.GONE
        bottomBar.visibility = View.GONE
        (listView.adapter as ArrayAdapter<*>).notifyDataSetChanged()
        listView.setSelection(maxOf(0, index - 3))
        listView.post {
            listView.requestFocus()
            listView.setSelection(index)
        }
    }

    private fun closeList() {
        listPanel.visibility = View.GONE
    }

    // ------------------------------------------------------------ reprodução
    private fun start(resume: Boolean) {
        triedAlt = false
        val name = titles.getOrElse(index) { "" }
        titleView.text = if (live) "${index + 1}  •  $name" else name
        playUri(urls[index], resume)
        if (live) showBars()
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

    private fun changeChannel(delta: Int) {
        if (urls.size < 2) return
        index = (index + delta + urls.size) % urls.size
        start(false)
    }

    private fun goToNumber() {
        val n = numberBuffer.toIntOrNull()
        numberBuffer = ""
        numberView.visibility = View.GONE
        if (n != null && n in 1..urls.size) {
            index = n - 1
            start(false)
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

    // ------------------------------------------------------------ controle remoto
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val code = event.keyCode
        val down = event.action == KeyEvent.ACTION_DOWN
        if (code == KeyEvent.KEYCODE_BACK) {
            if (event.action == KeyEvent.ACTION_UP) {
                if (listPanel.visibility == View.VISIBLE) closeList() else finish()
            }
            return true
        }
        if (listPanel.visibility == View.VISIBLE) return super.dispatchKeyEvent(event)

        if (live) {
            val focusInBars = barsVisible() && (topBar.findFocus() != null || bottomBar.findFocus() != null)
            if (down) {
                if (focusInBars) {
                    scheduleHide()
                    return super.dispatchKeyEvent(event)
                }
                when (code) {
                    KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_CHANNEL_UP, KeyEvent.KEYCODE_PAGE_UP -> { changeChannel(-1); return true }
                    KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_CHANNEL_DOWN, KeyEvent.KEYCODE_PAGE_DOWN -> { changeChannel(1); return true }
                    KeyEvent.KEYCODE_DPAD_LEFT -> { openList(); return true }
                    KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_MENU -> { cycleResize(); return true }
                    KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_INFO -> {
                        showBars()
                        bottomBar.getChildAt(1)?.requestFocus()
                        return true
                    }
                }
                if (code in KeyEvent.KEYCODE_0..KeyEvent.KEYCODE_9) {
                    numberBuffer += (code - KeyEvent.KEYCODE_0).toString()
                    numberView.text = numberBuffer
                    numberView.visibility = View.VISIBLE
                    handler.removeCallbacksAndMessages("num")
                    handler.postAtTime({ goToNumber() }, "num", SystemClock.uptimeMillis() + 1800)
                    return true
                }
            }
            return super.dispatchKeyEvent(event)
        }

        // Filmes e séries
        if (down && code == KeyEvent.KEYCODE_MENU) { cycleResize(); return true }
        if (topBar.findFocus() != null) {
            if (down && code == KeyEvent.KEYCODE_DPAD_DOWN) {
                view.showController()
                view.requestFocus()
                return true
            }
            return super.dispatchKeyEvent(event)
        }
        if (down && code == KeyEvent.KEYCODE_DPAD_UP && view.isControllerFullyVisible) {
            val focused = view.findFocus()
            if (focused !is DefaultTimeBar) {
                topBar.getChildAt(0)?.requestFocus()
                return true
            }
        }
        if (view.dispatchKeyEvent(event)) return true
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
