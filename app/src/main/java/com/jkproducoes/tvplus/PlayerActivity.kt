package com.jkproducoes.tvplus

import android.annotation.SuppressLint
import android.app.Activity
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.BitmapFactory
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
import android.util.Base64
import android.util.TypedValue
import android.view.GestureDetector
import android.view.Gravity
import android.view.MotionEvent
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.ProgressBar
import android.widget.SeekBar
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
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@SuppressLint("UnsafeOptInUsageError", "SetTextI18n")
class PlayerActivity : Activity() {

    companion object {
        const val USER_AGENT = "TVPlusPlayer/1.0 (Linux; Android) ExoPlayer"
        private const val GOLD = 0xFFF7BF1A.toInt()
        private const val RED = 0xFFE3101E.toInt()
    }

    private lateinit var player: ExoPlayer
    private lateinit var view: PlayerView
    private lateinit var loading: ProgressBar
    private lateinit var numberView: TextView
    private lateinit var seekPanel: LinearLayout
    private lateinit var seekText: TextView
    private lateinit var seekTime: TextView
    private lateinit var seekBar: ProgressBar
    private lateinit var listPanel: LinearLayout
    private lateinit var listView: ListView

    // TV ao vivo (modelo P2P): voltar + VIVO em cima, logo / nome / AO VIVO / A SEGUIR embaixo
    private lateinit var liveTop: FrameLayout
    private lateinit var liveInfo: LinearLayout
    private lateinit var logoImg: ImageView
    private lateinit var logoTxt: TextView
    private lateinit var chName: TextView
    private lateinit var progNow: ProgressBar
    private lateinit var nowTime: TextView
    private lateinit var nowTitle: TextView
    private lateinit var nextBadge: TextView
    private lateinit var nextTime: TextView
    private lateinit var nextTitle: TextView
    private lateinit var listBtn: TextView

    // Filmes e séries: "VOD: nome" em cima, play / tempo / barra / duração embaixo, ▼ para mais opções
    private lateinit var vodTop: LinearLayout
    private lateinit var titleView: TextView
    private lateinit var vodBottom: LinearLayout
    private lateinit var playBtn: TextView
    private lateinit var posText: TextView
    private lateinit var durText: TextView
    private lateinit var timeBar: SeekBar
    private lateinit var optionsRow: LinearLayout
    private lateinit var moreBtn: TextView
    private var dragging = false

    private var seekTarget = -1L
    private var seekDelta = 0L
    private val handler = Handler(Looper.getMainLooper())

    private val urls = ArrayList<String>()
    private val titles = ArrayList<String>()
    private val ids = ArrayList<String>()
    private val logos = ArrayList<String>()
    private var epgBase = ""
    private val logoCache = HashMap<String, Bitmap?>()
    private var index = 0
    private var live = false
    private var triedAlt = false
    private var resizeMode = 0
    private var numberBuffer = ""
    private var currentUri = ""
    private var stallTries = 0
    // "Continuar de onde parou": chave da série/filme e a marca de cada episódio (temporada|posição)
    private var watchKey = ""
    private val tags = ArrayList<String>()
    private val series get() = !live && urls.size > 1

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
        watchKey = data.optString("key", "")
        val tg = data.optJSONArray("tags")
        if (tg != null) for (i in 0 until tg.length()) tags.add(tg.getString(i))
        val di = data.optJSONArray("ids")
        if (di != null) for (i in 0 until di.length()) ids.add(di.optString(i, ""))
        val dl = data.optJSONArray("logos")
        if (dl != null) for (i in 0 until dl.length()) logos.add(dl.optString(i, ""))
        epgBase = data.optString("epg", "")
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
            .setSeekBackIncrementMs(10000)
            .setSeekForwardIncrementMs(10000)
            .build()
        view.player = player
        player.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                loading.visibility = if (state == Player.STATE_BUFFERING) View.VISIBLE else View.GONE
                handler.removeCallbacksAndMessages("stall")
                if (state == Player.STATE_BUFFERING) {
                    // Se ficar girando muito tempo (comum depois de adiantar no IPTV), recarrega no mesmo ponto
                    handler.postAtTime({ recoverStall() }, "stall", SystemClock.uptimeMillis() + 12000)
                }
                if (state == Player.STATE_READY) { triedAlt = false; stallTries = 0 }
                if (state == Player.STATE_ENDED) {
                    if (live) {
                        playUri(urls[index], false)
                    } else if (index < urls.size - 1) {
                        savePosition(0)
                        index++
                        start(true)
                        Toast.makeText(this@PlayerActivity, "Próximo episódio: ${titles.getOrElse(index) { "" }}", Toast.LENGTH_LONG).show()
                    } else {
                        savePosition(0)
                        finish()
                    }
                }
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (!live) updatePlayIcon()
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
    private fun text(sp: Float, color: Int, bold: Boolean = false): TextView {
        val v = TextView(this)
        v.setTextColor(color)
        v.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp)
        if (bold) v.setTypeface(v.typeface, Typeface.BOLD)
        v.maxLines = 1
        v.ellipsize = TextUtils.TruncateAt.END
        return v
    }

    private fun rounded(color: Int, radius: Int, strokeColor: Int = 0): GradientDrawable {
        val g = GradientDrawable()
        g.cornerRadius = dp(radius).toFloat()
        g.setColor(color)
        if (strokeColor != 0) g.setStroke(dp(2), strokeColor)
        return g
    }

    private fun badge(t: String, bgColor: Int): TextView {
        val b = text(14f, Color.WHITE, true)
        b.text = t
        b.setPadding(dp(10), dp(3), dp(10), dp(3))
        b.background = rounded(bgColor, 4)
        return b
    }

    private fun chip(): TextView {
        val c = text(17f, Color.WHITE)
        c.setPadding(dp(10), dp(3), dp(10), dp(3))
        c.background = rounded(0x553A3B42, 4)
        return c
    }

    private fun lp(w: Int, h: Int, weight: Float = 0f, l: Int = 0, t: Int = 0, r: Int = 0, b: Int = 0): LinearLayout.LayoutParams {
        val p = if (weight > 0f) LinearLayout.LayoutParams(w, h, weight) else LinearLayout.LayoutParams(w, h)
        p.setMargins(l, t, r, b)
        return p
    }

    private fun buildUi() {
        val root = FrameLayout(this)
        root.setBackgroundColor(Color.BLACK)

        view = PlayerView(this)
        view.setShowBuffering(PlayerView.SHOW_BUFFERING_NEVER)
        view.useController = false   // barras próprias no modelo P2P
        root.addView(view, FrameLayout.LayoutParams(-1, -1))

        // Toque na tela: mostra/esconde as barras; no filme, dois toques nos lados voltam/adiantam 10s
        val touch = View(this)
        val gd = GestureDetector(this, object : GestureDetector.SimpleOnGestureListener() {
            override fun onDown(e: MotionEvent): Boolean = true
            override fun onSingleTapConfirmed(e: MotionEvent): Boolean {
                if (listPanel.visibility == View.VISIBLE) { closeList(); return true }
                if (barsVisible()) hideBars() else showBars()
                return true
            }
            override fun onDoubleTap(e: MotionEvent): Boolean {
                if (live) return false
                val w = touch.width
                when {
                    e.x < w * 0.4f -> { seekBy(-10000); return true }
                    e.x > w * 0.6f -> { seekBy(10000); return true }
                }
                if (barsVisible()) togglePlay() else showBars()
                return true
            }
        })
        touch.setOnTouchListener { _, ev -> gd.onTouchEvent(ev); true }
        root.addView(touch, FrameLayout.LayoutParams(-1, -1))

        loading = ProgressBar(this)
        loading.indeterminateTintList = ColorStateList.valueOf(GOLD)
        root.addView(loading, FrameLayout.LayoutParams(dp(56), dp(56), Gravity.CENTER))

        buildLiveBars(root)
        buildVodBars(root)

        // Lista de canais (painel lateral)
        listPanel = LinearLayout(this)
        listPanel.orientation = LinearLayout.VERTICAL
        listPanel.setBackgroundColor(0xF2101014.toInt())
        listPanel.isClickable = true
        val headRow = LinearLayout(this)
        headRow.orientation = LinearLayout.HORIZONTAL
        headRow.gravity = Gravity.CENTER_VERTICAL
        headRow.setPadding(dp(12), dp(12), dp(12), dp(8))
        val head = text(18f, GOLD, true)
        head.text = "Canais"
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

        numberView = text(34f, GOLD, true)
        numberView.setBackgroundColor(0xCC000000.toInt())
        numberView.setPadding(dp(20), dp(8), dp(20), dp(8))
        val nlp = FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.END)
        nlp.setMargins(0, dp(80), dp(24), 0)
        root.addView(numberView, nlp)
        numberView.visibility = View.GONE

        // Aviso de adiantar / voltar
        seekPanel = LinearLayout(this)
        seekPanel.orientation = LinearLayout.VERTICAL
        seekPanel.gravity = Gravity.CENTER_HORIZONTAL
        seekPanel.setPadding(dp(26), dp(14), dp(26), dp(16))
        seekPanel.background = rounded(0xD9000000.toInt(), 16)
        seekText = text(26f, GOLD, true)
        seekText.gravity = Gravity.CENTER
        seekPanel.addView(seekText)
        seekTime = text(17f, Color.WHITE)
        seekTime.gravity = Gravity.CENTER
        seekTime.setPadding(0, dp(2), 0, dp(8))
        seekPanel.addView(seekTime)
        seekBar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal)
        seekBar.max = 1000
        seekBar.progressTintList = ColorStateList.valueOf(GOLD)
        seekPanel.addView(seekBar, LinearLayout.LayoutParams(dp(300), dp(8)))
        root.addView(seekPanel, FrameLayout.LayoutParams(-2, -2, Gravity.CENTER))
        seekPanel.visibility = View.GONE

        hideBars()
        setContentView(root)
    }

    private fun buildLiveBars(root: FrameLayout) {
        // Em cima: voltar (esquerda) e selo VIVO (direita)
        liveTop = FrameLayout(this)
        liveTop.setPadding(dp(18), dp(14), dp(18), dp(30))
        liveTop.background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(0x99000000.toInt(), 0x00000000))
        val back = iconButton("↩") { finish() }
        liveTop.addView(back, FrameLayout.LayoutParams(-2, -2, Gravity.START or Gravity.CENTER_VERTICAL))
        val vivo = badge("VIVO", RED)
        vivo.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
        liveTop.addView(vivo, FrameLayout.LayoutParams(-2, -2, Gravity.END or Gravity.CENTER_VERTICAL))
        root.addView(liveTop, FrameLayout.LayoutParams(-1, -2, Gravity.TOP))

        // Embaixo: logo do canal com ▲ ▼, nome, barra do programa, AO VIVO / A SEGUIR
        liveInfo = LinearLayout(this)
        liveInfo.orientation = LinearLayout.HORIZONTAL
        liveInfo.gravity = Gravity.CENTER_VERTICAL
        liveInfo.isClickable = true
        liveInfo.setPadding(dp(20), dp(40), dp(20), dp(14))
        liveInfo.background = GradientDrawable(GradientDrawable.Orientation.BOTTOM_TOP, intArrayOf(0xF0000000.toInt(), 0xB3000000.toInt(), 0x00000000))

        val left = LinearLayout(this)
        left.orientation = LinearLayout.VERTICAL
        left.gravity = Gravity.CENTER_HORIZONTAL
        val up = text(18f, 0xFFB0B0B8.toInt(), true); up.text = "▲"
        up.setOnClickListener { changeChannel(-1) }
        left.addView(up)
        val logoBox = FrameLayout(this)
        logoBox.background = rounded(0xFF26272D.toInt(), 4, 0x66FFFFFF)
        logoImg = ImageView(this)
        logoImg.scaleType = ImageView.ScaleType.FIT_CENTER
        logoImg.setPadding(dp(8), dp(8), dp(8), dp(8))
        logoBox.addView(logoImg, FrameLayout.LayoutParams(-1, -1))
        logoTxt = text(22f, GOLD, true)
        logoTxt.gravity = Gravity.CENTER
        logoBox.addView(logoTxt, FrameLayout.LayoutParams(-1, -1))
        left.addView(logoBox, LinearLayout.LayoutParams(dp(96), dp(96)))
        val down = text(18f, 0xFFB0B0B8.toInt(), true); down.text = "▼"
        down.setOnClickListener { changeChannel(1) }
        left.addView(down)
        liveInfo.addView(left)

        val right = LinearLayout(this)
        right.orientation = LinearLayout.VERTICAL
        val row1 = LinearLayout(this)
        row1.orientation = LinearLayout.HORIZONTAL
        row1.gravity = Gravity.CENTER_VERTICAL
        chName = text(30f, Color.WHITE)
        row1.addView(chName, lp(0, -2, 1f))
        val pills = LinearLayout(this)
        pills.orientation = LinearLayout.HORIZONTAL
        pills.setPadding(dp(6), dp(5), dp(6), dp(5))
        pills.background = rounded(0x99303138.toInt(), 30)
        listBtn = pillButton("☰  Lista") { openList() }
        pills.addView(listBtn)
        pills.addView(pillButton("⛶  Tela") { cycleResize() })
        row1.addView(pills)
        right.addView(row1)

        progNow = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal)
        progNow.max = 1000
        progNow.progressTintList = ColorStateList.valueOf(GOLD)
        progNow.progressBackgroundTintList = ColorStateList.valueOf(0xFF55565E.toInt())
        right.addView(progNow, lp(-1, dp(6), 0f, 0, dp(8), 0, dp(10)))

        val row3 = LinearLayout(this)
        row3.orientation = LinearLayout.HORIZONTAL
        row3.gravity = Gravity.CENTER_VERTICAL
        row3.addView(badge("AO VIVO", RED))
        nowTime = chip()
        row3.addView(nowTime, lp(-2, -2, 0f, dp(10), 0, dp(10), 0))
        nowTitle = text(19f, Color.WHITE)
        row3.addView(nowTitle, lp(0, -2, 1f, 0, 0, dp(14), 0))
        nextBadge = badge("A SEGUIR", 0xFF6B6C74.toInt())
        row3.addView(nextBadge)
        nextTime = chip()
        row3.addView(nextTime, lp(-2, -2, 0f, dp(10), 0, dp(10), 0))
        nextTitle = text(19f, Color.WHITE)
        row3.addView(nextTitle, lp(0, -2, 1f))
        right.addView(row3)
        liveInfo.addView(right, lp(0, -2, 1f, dp(18), 0, 0, 0))
        root.addView(liveInfo, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM))
    }

    private fun buildVodBars(root: FrameLayout) {
        // Em cima: ↩  VOD: nome ............ Clique ▼ ou ☰ para mais opções
        vodTop = LinearLayout(this)
        vodTop.orientation = LinearLayout.HORIZONTAL
        vodTop.gravity = Gravity.CENTER_VERTICAL
        vodTop.isClickable = true
        vodTop.setPadding(dp(18), dp(12), dp(22), dp(30))
        vodTop.background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(0xE6000000.toInt(), 0x00000000))
        vodTop.addView(iconButton("↩") { finish() })
        titleView = text(22f, Color.WHITE)
        titleView.setPadding(dp(12), 0, dp(12), 0)
        vodTop.addView(titleView, lp(0, -2, 1f))
        val hint = text(17f, Color.WHITE)
        hint.text = "Clique ▼ ou ☰ para mais opções"
        vodTop.addView(hint)
        root.addView(vodTop, FrameLayout.LayoutParams(-1, -2, Gravity.TOP))

        // Embaixo: ❚❚ 00:04 ━━━━━━ 45:09  e o ▼ (Tela / episódios)
        vodBottom = LinearLayout(this)
        vodBottom.orientation = LinearLayout.VERTICAL
        vodBottom.isClickable = true
        vodBottom.setPadding(dp(22), dp(34), dp(22), dp(6))
        vodBottom.background = GradientDrawable(GradientDrawable.Orientation.BOTTOM_TOP, intArrayOf(0xE6000000.toInt(), 0x00000000))
        val bar = LinearLayout(this)
        bar.orientation = LinearLayout.HORIZONTAL
        bar.gravity = Gravity.CENTER_VERTICAL
        playBtn = iconButton("❚❚") { togglePlay() }
        playBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 26f)
        bar.addView(playBtn)
        posText = text(20f, Color.WHITE)
        posText.text = "00:00"
        bar.addView(posText, lp(-2, -2, 0f, dp(12), 0, dp(10), 0))
        timeBar = SeekBar(this)
        timeBar.max = 1000
        timeBar.isFocusable = false
        timeBar.progressTintList = ColorStateList.valueOf(Color.WHITE)
        timeBar.thumbTintList = ColorStateList.valueOf(Color.WHITE)
        timeBar.progressBackgroundTintList = ColorStateList.valueOf(0x88FFFFFF.toInt())
        timeBar.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(sb: SeekBar, p: Int, fromUser: Boolean) {
                if (fromUser && ::player.isInitialized && player.duration > 0) posText.text = fmt(player.duration * p / 1000)
            }
            override fun onStartTrackingTouch(sb: SeekBar) { dragging = true; handler.removeCallbacksAndMessages("hide") }
            override fun onStopTrackingTouch(sb: SeekBar) {
                dragging = false
                if (::player.isInitialized && player.duration > 0) player.seekTo(player.duration * sb.progress / 1000)
                scheduleHide()
            }
        })
        bar.addView(timeBar, lp(0, -2, 1f))
        durText = text(20f, Color.WHITE)
        durText.text = "00:00"
        bar.addView(durText, lp(-2, -2, 0f, dp(10), 0, 0, 0))
        vodBottom.addView(bar)

        optionsRow = LinearLayout(this)
        optionsRow.orientation = LinearLayout.HORIZONTAL
        optionsRow.gravity = Gravity.CENTER
        optionsRow.setPadding(0, dp(8), 0, dp(2))
        if (series) {
            optionsRow.addView(button("⏮  Ep. anterior") { changeEpisode(-1) })
            optionsRow.addView(button("Próximo ep.  ⏭") { changeEpisode(1) })
        }
        optionsRow.addView(button("⛶  Tela") { cycleResize() })
        optionsRow.visibility = View.GONE
        vodBottom.addView(optionsRow, lp(-1, -2))

        moreBtn = text(20f, Color.WHITE)
        moreBtn.text = "▼"
        moreBtn.gravity = Gravity.CENTER
        moreBtn.setPadding(dp(30), 0, dp(30), 0)
        moreBtn.setOnClickListener { if (optionsRow.visibility == View.VISIBLE) hideOptions() else showOptions() }
        val mlp = lp(-2, -2)
        mlp.gravity = Gravity.CENTER_HORIZONTAL
        vodBottom.addView(moreBtn, mlp)
        root.addView(vodBottom, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM))
    }

    private fun focusBg(normal: Int, focused: Int): StateListDrawable {
        val s = StateListDrawable()
        s.addState(intArrayOf(android.R.attr.state_focused), rounded(focused, 10, GOLD))
        s.addState(intArrayOf(android.R.attr.state_pressed), rounded(focused, 10, GOLD))
        s.addState(intArrayOf(), rounded(normal, 10))
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

    /** Botão só com ícone (voltar, play/pause). */
    private fun iconButton(icon: String, action: () -> Unit): TextView {
        val b = button(icon, action)
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 24f)
        b.setPadding(dp(12), dp(4), dp(12), dp(4))
        b.background = focusBg(0x00000000, 0x66F7BF1A)
        return b
    }

    /** Botões arredondados do grupo da TV ao vivo (Lista / Tela). */
    private fun pillButton(t: String, action: () -> Unit): TextView {
        val b = button(t, action)
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
        b.setPadding(dp(18), dp(8), dp(18), dp(8))
        val s = StateListDrawable()
        s.addState(intArrayOf(android.R.attr.state_focused), rounded(0x33FFFFFF, 30, GOLD))
        s.addState(intArrayOf(android.R.attr.state_pressed), rounded(0x33FFFFFF, 30, GOLD))
        s.addState(intArrayOf(), rounded(0x00000000, 30))
        b.background = s
        val lp = LinearLayout.LayoutParams(-2, -2)
        lp.setMargins(dp(3), 0, dp(3), 0)
        b.layoutParams = lp
        return b
    }

    private fun barsVisible() = if (live) liveInfo.visibility == View.VISIBLE else vodBottom.visibility == View.VISIBLE

    private fun showBars() {
        if (live) {
            liveTop.visibility = View.VISIBLE
            liveInfo.visibility = View.VISIBLE
            refreshLiveInfo()
        } else {
            vodTop.visibility = View.VISIBLE
            vodBottom.visibility = View.VISIBLE
            updateProgress()
            handler.removeCallbacksAndMessages("tick")
            handler.postAtTime({ tick() }, "tick", SystemClock.uptimeMillis() + 500)
        }
        scheduleHide()
    }

    private fun hideBars() {
        if (listPanel.visibility == View.VISIBLE) return
        if (dragging) return
        val hadFocus = liveTop.findFocus() != null || liveInfo.findFocus() != null || vodTop.findFocus() != null || vodBottom.findFocus() != null
        liveTop.visibility = View.GONE
        liveInfo.visibility = View.GONE
        vodTop.visibility = View.GONE
        vodBottom.visibility = View.GONE
        optionsRow.visibility = View.GONE
        handler.removeCallbacksAndMessages("tick")
        if (hadFocus) backToVideo()
    }

    private fun scheduleHide() {
        handler.removeCallbacksAndMessages("hide")
        handler.postAtTime({ hideBars() }, "hide", SystemClock.uptimeMillis() + 5000)
    }

    private fun showOptions() {
        showBars()
        optionsRow.visibility = View.VISIBLE
        moreBtn.text = "▲"
        optionsRow.getChildAt(0)?.requestFocus()
    }

    private fun hideOptions() {
        optionsRow.visibility = View.GONE
        moreBtn.text = "▼"
        backToVideo()
        scheduleHide()
    }

    private fun togglePlay() {
        if (!::player.isInitialized) return
        player.playWhenReady = !player.playWhenReady
        updatePlayIcon()
        showBars()
    }

    private fun updatePlayIcon() {
        if (!::player.isInitialized) return
        playBtn.text = if (player.playWhenReady) "❚❚" else "▶"
    }

    private fun updateProgress() {
        if (live || !::player.isInitialized) return
        val d = player.duration
        val p = player.currentPosition
        if (!dragging) {
            posText.text = fmt(p)
            timeBar.progress = if (d > 0) ((p * 1000) / d).toInt() else 0
            timeBar.secondaryProgress = if (d > 0) ((player.bufferedPosition * 1000) / d).toInt() else 0
        }
        durText.text = if (d > 0) fmt(d) else "--:--"
        updatePlayIcon()
    }

    private fun tick() {
        if (live || vodBottom.visibility != View.VISIBLE) return
        updateProgress()
        handler.postAtTime({ tick() }, "tick", SystemClock.uptimeMillis() + 500)
    }

    // ------------------------------------------------------------ TV ao vivo: logo e guia (AO VIVO / A SEGUIR)
    private fun refreshLiveInfo() {
        val i = index
        chName.text = titles.getOrElse(i) { "" }
        logoTxt.text = "${i + 1}"
        val logo = logos.getOrElse(i) { "" }
        val cached = logoCache[logo]
        logoImg.setImageBitmap(cached)
        logoTxt.visibility = if (cached != null) View.GONE else View.VISIBLE
        if (logo.isNotEmpty() && !logoCache.containsKey(logo)) {
            Thread {
                val bmp = try {
                    val c = URL(logo).openConnection() as HttpURLConnection
                    c.connectTimeout = 8000; c.readTimeout = 10000
                    c.instanceFollowRedirects = true
                    c.setRequestProperty("User-Agent", USER_AGENT)
                    c.inputStream.use { BitmapFactory.decodeStream(it) }
                } catch (e: Exception) { null }
                runOnUiThread {
                    logoCache[logo] = bmp
                    if (index == i && !isFinishing) {
                        logoImg.setImageBitmap(bmp)
                        logoTxt.visibility = if (bmp != null) View.GONE else View.VISIBLE
                    }
                }
            }.start()
        }
        nowTime.text = "--:--"
        nowTitle.text = chName.text
        progNow.progress = 0
        setNext(null, null)
        val id = ids.getOrElse(i) { "" }
        if (epgBase.isEmpty() || id.isEmpty()) return
        Thread {
            var now: Array<Any>? = null
            var next: Array<Any>? = null
            try {
                val c = URL(epgBase + id).openConnection() as HttpURLConnection
                c.connectTimeout = 8000; c.readTimeout = 10000
                c.setRequestProperty("User-Agent", USER_AGENT)
                val body = c.inputStream.bufferedReader().use { it.readText() }
                val arr = JSONObject(body).optJSONArray("epg_listings")
                val t = System.currentTimeMillis() / 1000
                if (arr != null) for (k in 0 until arr.length()) {
                    val e = arr.getJSONObject(k)
                    val s = e.optString("start_timestamp", "0").toLongOrNull() ?: 0L
                    val f = e.optString("stop_timestamp", "0").toLongOrNull() ?: 0L
                    val title = try { String(Base64.decode(e.optString("title", ""), Base64.DEFAULT), Charsets.UTF_8) } catch (x: Exception) { e.optString("title", "") }
                    if (f <= t) continue
                    if (now == null && s <= t) now = arrayOf<Any>(s, f, title)
                    else if (next == null && s >= t) { next = arrayOf<Any>(s, f, title); if (now != null) break }
                    if (now != null && next != null) break
                }
            } catch (e: Exception) { }
            runOnUiThread {
                if (index != i || isFinishing) return@runOnUiThread
                val n = now
                if (n != null) {
                    val s = n[0] as Long; val f = n[1] as Long
                    nowTime.text = "${hhmm(s)}-${hhmm(f)}"
                    nowTitle.text = n[2] as String
                    val t = System.currentTimeMillis() / 1000
                    progNow.progress = if (f > s) (((t - s) * 1000) / (f - s)).toInt().coerceIn(0, 1000) else 0
                }
                setNext(next, n)
            }
        }.start()
    }

    private fun setNext(next: Array<Any>?, now: Array<Any>?) {
        val vis = if (next != null) View.VISIBLE else View.GONE
        nextBadge.visibility = vis; nextTime.visibility = vis; nextTitle.visibility = vis
        if (next != null) {
            nextTime.text = "${hhmm(next[0] as Long)}-${hhmm(next[1] as Long)}"
            nextTitle.text = next[2] as String
        }
    }

    private fun hhmm(ts: Long): String = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(ts * 1000))

    private fun openList() {
        handler.removeCallbacksAndMessages("hide")
        listPanel.visibility = View.VISIBLE
        liveTop.visibility = View.GONE
        liveInfo.visibility = View.GONE
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
        titleView.text = "VOD: $name"
        playUri(urls[index], resume)
        showBars()
        saveWatch(getPreferences(MODE_PRIVATE).getLong(urls[index], 0L), -1L)
    }

    /** Volta para o episódio anterior ou vai para o próximo (guarda onde parou no atual). */
    private fun changeEpisode(delta: Int) {
        if (!series || !::player.isInitialized) return
        val next = index + delta
        if (next < 0 || next >= urls.size) {
            Toast.makeText(this, if (delta < 0) "Este é o primeiro episódio" else "Este é o último episódio", Toast.LENGTH_SHORT).show()
            return
        }
        val d = player.duration
        val p = player.currentPosition
        if (d > 0 && p > d - 60000) savePosition(0) else savePosition(p)
        index = next
        start(true)
        showBars()
        Toast.makeText(this, titles.getOrElse(index) { "" }, Toast.LENGTH_SHORT).show()
    }

    /** Guarda qual episódio/filme estava passando e em que ponto, para o app continuar dali. */
    private fun saveWatch(pos: Long, dur: Long) {
        if (live || watchKey.isEmpty() || urls.isEmpty()) return
        val o = JSONObject()
        o.put("tag", tags.getOrElse(index) { index.toString() })
        o.put("title", titles.getOrElse(index) { "" })
        o.put("pos", pos)
        o.put("dur", dur)
        o.put("t", System.currentTimeMillis())
        getSharedPreferences("tvplus_watch", MODE_PRIVATE).edit().putString(watchKey, o.toString()).apply()
    }

    private fun playUri(url: String, resume: Boolean) {
        currentUri = url
        player.setMediaItem(MediaItem.fromUri(Uri.parse(url)))
        player.prepare()
        if (resume && !live) {
            val pos = getPreferences(MODE_PRIVATE).getLong(urls[index], 0L)
            if (pos > 10000) player.seekTo(pos)
        }
        player.playWhenReady = true
    }

    /** Destrava o vídeo que ficou carregando sem parar: recarrega o link e volta para o mesmo ponto. */
    private fun recoverStall() {
        if (!::player.isInitialized || player.playbackState != Player.STATE_BUFFERING) return
        if (stallTries >= 3) return
        stallTries++
        val pos = if (live) 0L else player.currentPosition
        player.stop()
        player.setMediaItem(MediaItem.fromUri(Uri.parse(currentUri.ifEmpty { urls[index] })))
        player.prepare()
        if (!live && pos > 0) player.seekTo(pos)
        player.playWhenReady = true
    }

    // ------------------------------------------------------------ adiantar / voltar
    private fun fmt(ms: Long): String {
        val t = maxOf(0L, ms) / 1000
        val h = t / 3600; val m = (t % 3600) / 60; val s = t % 60
        return if (h > 0) String.format("%d:%02d:%02d", h, m, s) else String.format("%02d:%02d", m, s)
    }

    /** Soma o pulo e só aplica quando a pessoa para de apertar (mais leve para IPTV). */
    private fun seekBy(delta: Long) {
        if (live || !::player.isInitialized) return
        val dur = player.duration
        if (seekTarget < 0) { seekTarget = player.currentPosition; seekDelta = 0 }
        var target = seekTarget + delta
        if (target < 0) target = 0
        if (dur > 0 && target > dur - 3000) target = maxOf(0L, dur - 3000)
        seekDelta += target - seekTarget
        seekTarget = target
        val secs = Math.abs(seekDelta) / 1000
        val amount = if (secs >= 60) "${secs / 60} min${if (secs % 60 > 0) " ${secs % 60}s" else ""}" else "${secs}s"
        seekText.text = if (seekDelta >= 0) "⏩  +$amount" else "⏪  -$amount"
        seekTime.text = if (dur > 0) "${fmt(target)}  /  ${fmt(dur)}" else fmt(target)
        seekBar.progress = if (dur > 0) ((target * 1000) / dur).toInt() else 0
        seekPanel.visibility = View.VISIBLE
        handler.removeCallbacksAndMessages("seek")
        handler.postAtTime({ applySeek() }, "seek", SystemClock.uptimeMillis() + 650)
    }

    private fun applySeek() {
        if (seekTarget >= 0) {
            player.seekTo(seekTarget)
            player.playWhenReady = true
        }
        seekTarget = -1
        seekDelta = 0
        handler.removeCallbacksAndMessages("seekhide")
        handler.postAtTime({ seekPanel.visibility = View.GONE }, "seekhide", SystemClock.uptimeMillis() + 900)
    }

    /** Segurando a seta, o pulo vai aumentando: 10s, depois 30s, depois 1 min. */
    private fun stepFor(repeat: Int): Long = when {
        repeat < 6 -> 10000L
        repeat < 20 -> 30000L
        else -> 60000L
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
                when {
                    listPanel.visibility == View.VISIBLE -> closeList()
                    !live && optionsRow.visibility == View.VISIBLE -> hideOptions()
                    else -> finish()
                }
            }
            return true
        }
        if (listPanel.visibility == View.VISIBLE) return super.dispatchKeyEvent(event)

        if (live) {
            val focusInBars = barsVisible() && (liveTop.findFocus() != null || liveInfo.findFocus() != null)
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
                        listBtn.requestFocus()
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
        when (code) {
            KeyEvent.KEYCODE_MENU -> { if (down && event.repeatCount == 0) { if (optionsRow.visibility == View.VISIBLE) hideOptions() else showOptions() }; return true }
            KeyEvent.KEYCODE_MEDIA_NEXT -> { if (down && event.repeatCount == 0) changeEpisode(1); return true }
            KeyEvent.KEYCODE_MEDIA_PREVIOUS -> { if (down && event.repeatCount == 0) changeEpisode(-1); return true }
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> { if (down) seekBy(30000); return true }
            KeyEvent.KEYCODE_MEDIA_REWIND -> { if (down) seekBy(-30000); return true }
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.KEYCODE_MEDIA_PAUSE -> {
                if (down && event.repeatCount == 0) {
                    player.playWhenReady = if (code == KeyEvent.KEYCODE_MEDIA_PLAY) true else if (code == KeyEvent.KEYCODE_MEDIA_PAUSE) false else !player.playWhenReady
                    showBars()
                }
                return true
            }
        }
        val inTop = vodTop.findFocus() != null
        val inOptions = optionsRow.findFocus() != null
        // Nos botões (voltar em cima / opções embaixo): setas para os lados andam entre eles
        if (inTop || inOptions) {
            if (code == KeyEvent.KEYCODE_DPAD_DOWN) {
                if (down) { if (inTop) backToVideo() }
                return true
            }
            if (code == KeyEvent.KEYCODE_DPAD_UP) {
                if (down && inOptions) hideOptions()
                return true
            }
            scheduleHide()
            return super.dispatchKeyEvent(event)
        }
        // Setas para os lados adiantam/voltam
        if (code == KeyEvent.KEYCODE_DPAD_LEFT || code == KeyEvent.KEYCODE_DPAD_RIGHT) {
            if (down) {
                val step = stepFor(event.repeatCount)
                seekBy(if (code == KeyEvent.KEYCODE_DPAD_RIGHT) step else -step)
            }
            return true
        }
        // OK do controle: mostra a barra; com a barra aberta, pausa / continua
        if (code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER) {
            if (down && event.repeatCount == 0) {
                if (!barsVisible()) showBars() else togglePlay()
            }
            return true
        }
        // Seta para baixo: mostra a barra; com a barra aberta, abre as opções (Tela / episódios)
        if (code == KeyEvent.KEYCODE_DPAD_DOWN) {
            if (down && event.repeatCount == 0) { if (!barsVisible()) showBars() else showOptions() }
            return true
        }
        // Seta para cima: mostra a barra e vai para o botão Voltar
        if (code == KeyEvent.KEYCODE_DPAD_UP) {
            if (down && event.repeatCount == 0) {
                showBars()
                vodTop.getChildAt(0)?.requestFocus()
            }
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    /** Tira o foco dos botões e deixa o controle no vídeo (setas = adiantar/voltar, OK = pausar). */
    private fun backToVideo() {
        currentFocus?.clearFocus()
        view.isFocusable = true
        view.isFocusableInTouchMode = false
        view.requestFocus()
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
            if (d > 0 && p > d - 60000) {
                savePosition(0)
                // Terminou o episódio: o "continuar" já aponta para o próximo
                if (series && index < urls.size - 1) { index++; saveWatch(0, -1); index-- } else saveWatch(0, d)
            } else {
                savePosition(p)
                saveWatch(p, d)
            }
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
