/**
 * PauseMenu.ts
 *
 * Menu de pausa ativado pelo ESC / perda de pointer lock.
 * Mostra opções: Continuar, Controles, Sair.
 * Callbacks para integrar com Experience.ts.
 */

export class PauseMenu {
    private root!:      HTMLDivElement
    private _visible  = false
    private _onResume: (() => void) | null = null

    constructor() {
        this._build()
    }

    // ── API ───────────────────────────────────────────────────────────────
    onResume(cb: () => void)  { this._onResume = cb }

    get isVisible() { return this._visible }

    show() {
        if (this._visible) return
        this._visible = true
        this.root.style.display  = 'flex'
        requestAnimationFrame(() => { this.root.style.opacity = '1' })
        document.body.style.cursor = 'default'
    }

    hide() {
        if (!this._visible) return
        this._visible = false
        this.root.style.opacity = '0'
        setTimeout(() => { this.root.style.display = 'none' }, 300)
        document.body.style.cursor = 'none'
    }

    // ── Build DOM ─────────────────────────────────────────────────────────
    private _build() {
        this.root = document.createElement('div')
        this.root.id = 'pause-root'
        Object.assign(this.root.style, {
            position:        'fixed',
            inset:           '0',
            zIndex:          '8000',
            display:         'none',
            opacity:         '0',
            flexDirection:   'column',
            alignItems:      'center',
            justifyContent:  'center',
            background:      'rgba(6, 4, 2, 0.82)',
            backdropFilter:  'blur(6px)',
            transition:      'opacity 0.3s ease',
            fontFamily:      "'Barlow Condensed', sans-serif",
        })
        document.body.appendChild(this.root)

        this._injectStyle()

        // Panel
        const panel = document.createElement('div')
        Object.assign(panel.style, {
            display:        'flex',
            flexDirection:  'column',
            alignItems:     'center',
            gap:            '0',
            minWidth:       '280px',
        })
        this.root.appendChild(panel)

        // Badge
        const badge = document.createElement('div')
        badge.innerHTML = `<svg width="36" height="36" viewBox="0 0 52 52">
            <path d="M26 4L30 18L44 18L33 27L37 41L26 33L15 41L19 27L8 18L22 18Z"
                  fill="#c8901a" opacity="0.85"/>
        </svg>`
        badge.style.marginBottom = '10px'
        badge.style.filter = 'drop-shadow(0 0 10px rgba(200,144,26,0.4))'
        panel.appendChild(badge)

        // Title
        const title = document.createElement('div')
        title.textContent = 'PAUSADO'
        Object.assign(title.style, {
            fontSize:      '38px',
            fontWeight:    '700',
            color:         '#e8c060',
            letterSpacing: '6px',
            marginBottom:  '4px',
        })
        panel.appendChild(title)

        const sub = document.createElement('div')
        sub.textContent = 'DUST & IRON'
        Object.assign(sub.style, {
            fontSize:      '11px',
            fontWeight:    '300',
            color:         'rgba(200,160,80,0.4)',
            letterSpacing: '4px',
            marginBottom:  '40px',
        })
        panel.appendChild(sub)

        // Divider
        const div = document.createElement('div')
        Object.assign(div.style, {
            width:        '100%',
            height:       '1px',
            background:   'rgba(255,255,255,0.06)',
            marginBottom: '28px',
        })
        panel.appendChild(div)

        // Buttons
        const btnContinue = this._makeBtn('▶  CONTINUAR', 'primary')
        const btnControls = this._makeBtn('CONTROLES', 'secondary')
        const btnQuit     = this._makeBtn('SAIR', 'danger')

        btnContinue.addEventListener('click', () => {
            this._onResume?.()
        })

        // Controles toggle
        let controlsVisible = false
        const ctrlPanel = this._buildControlsPanel()
        ctrlPanel.style.display = 'none'
        btnControls.addEventListener('click', () => {
            controlsVisible = !controlsVisible
            ctrlPanel.style.display = controlsVisible ? 'block' : 'none'
            btnControls.textContent = controlsVisible ? 'FECHAR CONTROLES' : 'CONTROLES'
        })

        btnQuit.addEventListener('click', () => {
            location.reload()
        })

        panel.appendChild(btnContinue)
        panel.appendChild(btnControls)
        panel.appendChild(ctrlPanel)
        panel.appendChild(btnQuit)

        // Hint
        const hint = document.createElement('div')
        hint.textContent = 'Pressione ESC para continuar'
        Object.assign(hint.style, {
            marginTop:     '28px',
            fontSize:      '10px',
            color:         'rgba(255,255,255,0.18)',
            letterSpacing: '2px',
            fontFamily:    "'Barlow', sans-serif",
        })
        panel.appendChild(hint)
    }

    private _makeBtn(label: string, type: 'primary' | 'secondary' | 'danger') {
        const btn = document.createElement('button')
        btn.textContent = label
        btn.className   = `pause-btn pause-btn-${type}`
        return btn
    }

    private _buildControlsPanel() {
        const wrap = document.createElement('div')
        Object.assign(wrap.style, {
            width:         '100%',
            marginTop:     '12px',
            marginBottom:  '8px',
        })

        const commands = [
            ['W A S D',       'Movimentar'],
            ['Shift + W',     'Correr'],
            ['Mouse Dir',     'Girar câmera'],
            ['Scroll',        'Zoom'],
            ['P',             'Equipar / Guardar arma'],
            ['Tab',           'Menu de armas'],
            ['Clique Esq',    'Atirar'],
            ['ESC',           'Pausar / Continuar'],
        ]

        commands.forEach(([key, action]) => {
            const row = document.createElement('div')
            Object.assign(row.style, {
                display:       'flex',
                justifyContent:'space-between',
                alignItems:    'center',
                padding:       '5px 0',
                borderBottom:  '1px solid rgba(255,255,255,0.05)',
                gap:           '12px',
            })

            const keyEl = document.createElement('span')
            keyEl.textContent = key
            Object.assign(keyEl.style, {
                fontSize:      '10px',
                fontWeight:    '600',
                color:         'rgba(220,180,80,0.85)',
                background:    'rgba(200,144,26,0.12)',
                border:        '1px solid rgba(200,144,26,0.2)',
                borderRadius:  '3px',
                padding:       '2px 8px',
                whiteSpace:    'nowrap',
                minWidth:      '90px',
                textAlign:     'center',
            })

            const actEl = document.createElement('span')
            actEl.textContent = action
            Object.assign(actEl.style, {
                fontSize:    '11px',
                fontWeight:  '300',
                color:       'rgba(255,255,255,0.5)',
                fontFamily:  "'Barlow', sans-serif",
            })

            row.appendChild(keyEl)
            row.appendChild(actEl)
            wrap.appendChild(row)
        })

        return wrap
    }

    private _injectStyle() {
        if (document.getElementById('pause-style')) return
        const s = document.createElement('style')
        s.id = 'pause-style'
        s.textContent = `
            @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@300;400;600;700&family=Barlow:wght@300;400&display=swap');

            .pause-btn {
                width: 100%;
                margin-bottom: 10px;
                padding: 11px 0;
                border: none;
                border-radius: 3px;
                font-family: 'Barlow Condensed', sans-serif;
                font-size: 13px;
                font-weight: 700;
                letter-spacing: 3px;
                cursor: pointer;
                transition: transform 0.12s, filter 0.12s;
            }
            .pause-btn:hover { transform: scale(1.03); filter: brightness(1.15); }
            .pause-btn:active { transform: scale(0.98); }

            .pause-btn-primary {
                background: linear-gradient(90deg, #c8901a, #e8c060);
                color: #0d0a06;
            }
            .pause-btn-secondary {
                background: rgba(255,255,255,0.06);
                color: rgba(220,200,140,0.8);
                border: 1px solid rgba(255,255,255,0.1);
            }
            .pause-btn-danger {
                background: rgba(180,40,30,0.18);
                color: rgba(255,120,100,0.8);
                border: 1px solid rgba(180,40,30,0.25);
            }
        `
        document.head.appendChild(s)
    }
}

export default PauseMenu