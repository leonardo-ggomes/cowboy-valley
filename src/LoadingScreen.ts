/**
 * LoadingScreen.ts
 *
 * Tela de carregamento completa estilo Old West moderno:
 *  - Background com gradiente de deserto + silhueta de cidade
 *  - Barra de progresso com fill animado
 *  - Mensagens de loading temáticas que rotacionam
 *  - Após 100%: transição para tela de comandos
 *  - Tela de comandos com layout de duas colunas
 *  - Botão "Iniciar" dispara o callback do jogo
 *  - Fade out suave antes de revelar o jogo
 */

export class LoadingScreen {
    private root!:        HTMLDivElement
    private barFill!:     HTMLDivElement
    private barPercent!:  HTMLSpanElement
    private statusMsg!:   HTMLDivElement
    private loadingView!: HTMLDivElement
    private commandsView!:HTMLDivElement
    private msgInterval:  ReturnType<typeof setInterval> | null = null

    private _onStart: (() => void) | null = null

    // Mensagens temáticas que rotacionam durante o loading
    private readonly MESSAGES = [
        'Aquecendo os cavalos...',
        'Carregando o revólver...',
        'Vasculhando o deserto...',
        'Espalhando areia no chão...',
        'Posicionando os cactos...',
        'Preparando as ruínas...',
        'Colocando os crânios de boi...',
        'Ajustando a mira...',
        'O xerife está chegando...',
        'Última bala no tambor...',
    ]

    constructor() {
        this._injectFonts()
        this._buildDOM()
    }

    private _injectFonts() {
        if (document.getElementById('ls-fonts')) return
        const link = document.createElement('link')
        link.id   = 'ls-fonts'
        link.rel  = 'stylesheet'
        link.href = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@300;400;600;700&family=Barlow:wght@300;400&display=swap'
        document.head.appendChild(link)
    }

    private _buildDOM() {
        // ── Root overlay ────────────────────────────────────────────────
        this.root = document.createElement('div')
        this.root.id = 'ls-root'
        Object.assign(this.root.style, {
            position:   'fixed',
            inset:      '0',
            zIndex:     '9999',
            fontFamily: "'Barlow Condensed', sans-serif",
            overflow:   'hidden',
            transition: 'opacity 0.8s ease',
        })
        document.body.appendChild(this.root)

        // ── Background ──────────────────────────────────────────────────
        const bg = document.createElement('div')
        Object.assign(bg.style, {
            position:   'absolute',
            inset:      '0',
            background: 'linear-gradient(to bottom, #0d0a06 0%, #1a1008 30%, #2a1a08 55%, #3a2010 75%, #1a0e04 100%)',
        })
        this.root.appendChild(bg)

        // Silhueta de cidade western (SVG inline)
        const skyline = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        skyline.setAttribute('viewBox', '0 0 1200 200')
        skyline.setAttribute('preserveAspectRatio', 'xMidYMax meet')
        Object.assign(skyline.style, {
            position: 'absolute',
            bottom:   '0',
            left:     '0',
            width:    '100%',
            height:   '35%',
            opacity:  '0.22',
        })
        skyline.innerHTML = `
          <g fill="#c8843a">
            <!-- saloon esq -->
            <rect x="20"  y="80"  width="80"  height="120"/>
            <rect x="10"  y="68"  width="100" height="16"/>
            <rect x="25"  y="55"  width="70"  height="18"/>
            <rect x="55"  y="40"  width="12"  height="20"/>
            <!-- casa -->
            <rect x="120" y="100" width="55"  height="100"/>
            <polygon points="120,100 175,100 147,72"/>
            <!-- torre do sheriff -->
            <rect x="195" y="60"  width="45"  height="140"/>
            <rect x="188" y="50"  width="60"  height="14"/>
            <rect x="214" y="30"  width="8"   height="24"/>
            <!-- estável -->
            <rect x="260" y="110" width="90"  height="90"/>
            <polygon points="260,110 350,110 305,78"/>
            <!-- banco -->
            <rect x="370" y="75"  width="70"  height="125"/>
            <rect x="362" y="62"  width="86"  height="16"/>
            <rect x="380" y="45"  width="12"  height="20"/>
            <rect x="438" y="45"  width="12"  height="20"/>
            <!-- igreja -->
            <rect x="460" y="85"  width="60"  height="115"/>
            <polygon points="460,85 520,85 490,58"/>
            <rect x="486" y="34"  width="8"   height="28"/>
            <rect x="482" y="46"  width="16"  height="4"/>
            <!-- casa direita -->
            <rect x="540" y="100" width="55"  height="100"/>
            <polygon points="540,100 595,100 567,72"/>
            <!-- saloon dir -->
            <rect x="615" y="70"  width="90"  height="130"/>
            <rect x="608" y="58"  width="104" height="16"/>
            <rect x="620" y="44"  width="78"  height="18"/>
            <!-- torre água -->
            <rect x="730" y="50"  width="30"  height="50"/>
            <ellipse cx="745" cy="50" rx="28" ry="18"/>
            <rect x="738" y="100" width="4"   height="100"/>
            <rect x="750" y="100" width="4"   height="100"/>
            <!-- casas fundo -->
            <rect x="780" y="90"  width="50"  height="110"/>
            <rect x="848" y="105" width="44"  height="95"/>
            <rect x="904" y="80"  width="60"  height="120"/>
            <rect x="978" y="95"  width="50"  height="105"/>
            <rect x="1042" y="85" width="70"  height="115"/>
            <rect x="1124" y="75" width="80"  height="125"/>
          </g>
          <!-- chão -->
          <rect x="0" y="195" width="1200" height="10" fill="#8a5520" opacity="0.6"/>
        `
        this.root.appendChild(skyline)

        // Grão de película
        const grain = document.createElement('div')
        Object.assign(grain.style, {
            position:    'absolute',
            inset:       '0',
            backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\' opacity=\'0.04\'/%3E%3C/svg%3E")',
            backgroundSize: '200px',
            opacity:     '0.35',
            pointerEvents:'none',
        })
        this.root.appendChild(grain)

        // ── LOADING VIEW ────────────────────────────────────────────────
        this.loadingView = document.createElement('div')
        Object.assign(this.loadingView.style, {
            position:       'absolute',
            inset:          '0',
            display:        'flex',
            flexDirection:  'column',
            alignItems:     'center',
            justifyContent: 'center',
            padding:        '0 20px',
        })
        this.root.appendChild(this.loadingView)

        // Badge / estrela
        const badge = document.createElement('div')
        badge.innerHTML = `<svg width="52" height="52" viewBox="0 0 52 52" fill="none">
            <path d="M26 4 L30 18 L44 18 L33 27 L37 41 L26 33 L15 41 L19 27 L8 18 L22 18Z"
                  fill="#c8901a" opacity="0.9"/>
            <path d="M26 4 L30 18 L44 18 L33 27 L37 41 L26 33 L15 41 L19 27 L8 18 L22 18Z"
                  fill="none" stroke="#e8b840" stroke-width="1.5" opacity="0.7"/>
        </svg>`
        badge.style.marginBottom = '14px'
        badge.style.filter = 'drop-shadow(0 0 12px rgba(200,144,26,0.5))'
        this.loadingView.appendChild(badge)

        // Título
        const title = document.createElement('div')
        title.textContent = 'DUST & IRON'
        Object.assign(title.style, {
            fontSize:      '52px',
            fontWeight:    '700',
            color:         '#e8c060',
            letterSpacing: '8px',
            textTransform: 'uppercase',
            textShadow:    '0 0 30px rgba(200,144,26,0.4)',
            marginBottom:  '4px',
            lineHeight:    '1',
        })
        this.loadingView.appendChild(title)

        const subtitle = document.createElement('div')
        subtitle.textContent = 'OPEN WORLD WESTERN'
        Object.assign(subtitle.style, {
            fontSize:      '13px',
            fontWeight:    '300',
            color:         'rgba(200,160,80,0.45)',
            letterSpacing: '6px',
            marginBottom:  '52px',
        })
        this.loadingView.appendChild(subtitle)

        // Barra de progresso
        const barWrap = document.createElement('div')
        Object.assign(barWrap.style, {
            width:     '340px',
            marginBottom: '10px',
        })

        const barTrack = document.createElement('div')
        Object.assign(barTrack.style, {
            width:        '100%',
            height:       '3px',
            background:   'rgba(255,255,255,0.08)',
            borderRadius: '2px',
            overflow:     'hidden',
            marginBottom: '10px',
        })

        this.barFill = document.createElement('div')
        Object.assign(this.barFill.style, {
            height:           '100%',
            width:            '0%',
            background:       'linear-gradient(90deg, #8a5010, #c8901a, #e8c060)',
            borderRadius:     '2px',
            transition:       'width 0.4s ease',
            boxShadow:        '0 0 8px rgba(200,144,26,0.6)',
        })
        barTrack.appendChild(this.barFill)
        barWrap.appendChild(barTrack)

        const barRow = document.createElement('div')
        Object.assign(barRow.style, {
            display:        'flex',
            justifyContent: 'space-between',
            alignItems:     'center',
        })

        this.statusMsg = document.createElement('div')
        Object.assign(this.statusMsg.style, {
            fontSize:      '11px',
            fontWeight:    '300',
            color:         'rgba(200,160,80,0.5)',
            letterSpacing: '1.5px',
            fontFamily:    "'Barlow', sans-serif",
            fontStyle:     'italic',
            transition:    'opacity 0.3s',
        })
        this.statusMsg.textContent = 'Inicializando...'

        this.barPercent = document.createElement('span')
        Object.assign(this.barPercent.style, {
            fontSize:      '11px',
            fontWeight:    '600',
            color:         'rgba(200,160,80,0.5)',
            letterSpacing: '1px',
        })
        this.barPercent.textContent = '0%'

        barRow.appendChild(this.statusMsg)
        barRow.appendChild(this.barPercent)
        barWrap.appendChild(barRow)
        this.loadingView.appendChild(barWrap)

        // ── COMMANDS VIEW (oculta inicialmente) ─────────────────────────
        this.commandsView = document.createElement('div')
        Object.assign(this.commandsView.style, {
            position:        'absolute',
            inset:           '0',
            display:         'none',
            flexDirection:   'column',
            alignItems:      'center',
            justifyContent:  'center',
            padding:         '0 40px',
            opacity:         '0',
            transition:      'opacity 0.5s ease',
        })
        this.root.appendChild(this.commandsView)

        // Título dos comandos
        const cmdTitle = document.createElement('div')
        cmdTitle.textContent = 'CONTROLES'
        Object.assign(cmdTitle.style, {
            fontSize:      '11px',
            fontWeight:    '400',
            color:         'rgba(200,160,80,0.4)',
            letterSpacing: '5px',
            marginBottom:  '20px',
        })
        this.commandsView.appendChild(cmdTitle)

        // Grade de comandos
        const grid = document.createElement('div')
        Object.assign(grid.style, {
            display:             'grid',
            gridTemplateColumns: '1fr 1fr',
            gap:                 '8px 40px',
            marginBottom:        '36px',
            maxWidth:            '520px',
            width:               '100%',
        })

        const commands = [
            // [tecla, ação]
            ['W A S D',        'Movimentar'],
            ['Shift + W',      'Correr'],
            ['Mouse Direito',  'Girar câmera'],
            ['Scroll',         'Zoom'],
            ['P',              'Equipar / Guardar arma'],
            ['Tab',            'Menu de armas'],
            ['Clique Esq',     'Atirar'],
            ['1 – 8',          'Selecionar item rápido'],
            ['G',              '+$200 (debug)'],
            ['H',              'Receber dano (debug)'],
        ]

        commands.forEach(([key, action]) => {
            const row = document.createElement('div')
            Object.assign(row.style, {
                display:     'flex',
                alignItems:  'center',
                gap:         '10px',
                borderBottom:'1px solid rgba(255,255,255,0.05)',
                paddingBottom:'7px',
            })

            const keyEl = document.createElement('span')
            keyEl.textContent = key
            Object.assign(keyEl.style, {
                fontSize:      '11px',
                fontWeight:    '600',
                color:         'rgba(220,180,80,0.85)',
                background:    'rgba(200,144,26,0.12)',
                border:        '1px solid rgba(200,144,26,0.25)',
                borderRadius:  '3px',
                padding:       '2px 8px',
                whiteSpace:    'nowrap',
                letterSpacing: '0.5px',
                minWidth:      '100px',
                textAlign:     'center',
                flexShrink:    '0',
            })

            const actEl = document.createElement('span')
            actEl.textContent = action
            Object.assign(actEl.style, {
                fontSize:      '12px',
                fontWeight:    '300',
                color:         'rgba(255,255,255,0.55)',
                fontFamily:    "'Barlow', sans-serif",
                letterSpacing: '0.5px',
            })

            row.appendChild(keyEl)
            row.appendChild(actEl)
            grid.appendChild(row)
        })
        this.commandsView.appendChild(grid)

        // Botão Iniciar
        const btn = document.createElement('button')
        btn.textContent = 'INICIAR JOGO'
        Object.assign(btn.style, {
            fontFamily:    "'Barlow Condensed', sans-serif",
            fontSize:      '14px',
            fontWeight:    '700',
            letterSpacing: '4px',
            color:         '#0d0a06',
            background:    'linear-gradient(90deg, #c8901a, #e8c060)',
            border:        'none',
            borderRadius:  '3px',
            padding:       '12px 48px',
            cursor:        'pointer',
            transition:    'transform 0.15s, box-shadow 0.15s',
            boxShadow:     '0 0 20px rgba(200,144,26,0.3)',
        })
        btn.addEventListener('mouseenter', () => {
            btn.style.transform  = 'scale(1.04)'
            btn.style.boxShadow  = '0 0 30px rgba(200,144,26,0.6)'
        })
        btn.addEventListener('mouseleave', () => {
            btn.style.transform  = 'scale(1)'
            btn.style.boxShadow  = '0 0 20px rgba(200,144,26,0.3)'
        })
        btn.addEventListener('click', () => this._startGame())
        this.commandsView.appendChild(btn)

        // Dica de mouse
        const hint = document.createElement('div')
        hint.textContent = 'Pressione Enter para iniciar'
        Object.assign(hint.style, {
            marginTop:     '14px',
            fontSize:      '10px',
            fontWeight:    '300',
            color:         'rgba(255,255,255,0.2)',
            letterSpacing: '2px',
            fontFamily:    "'Barlow', sans-serif",
        })
        this.commandsView.appendChild(hint)

        // Enter como atalho
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Enter' && this.commandsView.style.display !== 'none') {
                document.removeEventListener('keydown', onKey)
                this._startGame()
            }
        }
        document.addEventListener('keydown', onKey)
    }

    // ── API pública ───────────────────────────────────────────────────────

    /** Chama para registrar o callback que inicia o jogo */
    onStart(cb: () => void) {
        this._onStart = cb
    }

    /** Atualiza o progresso (0–100) */
    setProgress(pct: number) {
        const p = Math.round(Math.min(100, Math.max(0, pct)))
        this.barFill.style.width   = `${p}%`
        this.barPercent.textContent = `${p}%`

        if (p >= 100) {
            this._onLoadComplete()
        }
    }

    /** Atualiza a mensagem de status */
    setMessage(msg: string) {
        this.statusMsg.style.opacity = '0'
        setTimeout(() => {
            this.statusMsg.textContent  = msg
            this.statusMsg.style.opacity = '1'
        }, 200)
    }

    // ── Interno ───────────────────────────────────────────────────────────

    private _onLoadComplete() {
        if (this.msgInterval) clearInterval(this.msgInterval)

        // Pequeno delay para o 100% ser visto
        setTimeout(() => {
            // Esconde loading, mostra comandos
            this.loadingView.style.opacity    = '0'
            this.loadingView.style.transition = 'opacity 0.4s'
            setTimeout(() => {
                this.loadingView.style.display    = 'none'
                this.commandsView.style.display   = 'flex'
                requestAnimationFrame(() => {
                    this.commandsView.style.opacity = '1'
                })
            }, 400)
        }, 600)
    }

    private _startGame() {
        // Fade out da tela inteira → inicia jogo
        this.root.style.opacity = '0'
        setTimeout(() => {
            this.root.style.display = 'none'
            this._onStart?.()
        }, 850)
    }

    /** Inicia o ciclo de mensagens temáticas */
    startMessages() {
        let idx = 0
        this.setMessage(this.MESSAGES[0])
        this.msgInterval = setInterval(() => {
            idx = (idx + 1) % this.MESSAGES.length
            this.setMessage(this.MESSAGES[idx])
        }, 2200)
    }
}

export default LoadingScreen