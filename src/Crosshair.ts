/**
 * Crosshair.ts
 *
 * - Mira segue o mouse com lerp suave (sem salto na borda do range)
 * - Clamp radial suave: quando passa do MAX_RANGE, a mira resiste mas
 *   não para abruptamente — usa easing na borda
 * - Posição atual sempre disponível em aimScreenX / aimScreenY
 * - Spread dinâmico ao atirar
 * - Progress ring de recarga
 */

export class Crosshair {

    // Posição da mira na tela (px) — lida por Experience → Camera.getAimPoint
    aimScreenX = window.innerWidth  / 2
    aimScreenY = window.innerHeight / 2

    // Config
    private readonly MAX_RANGE  = 140   // raio máximo do centro (px)
    private readonly LERP_SPEED = 18    // velocidade de suavização (maior = mais rápido)
    private readonly DOT_R      = 2.5
    private readonly RING_R     = 8
    private readonly RELOAD_R   = 14
    private readonly LINE_LEN   = 10
    private readonly GAP_BASE   = 5
    private readonly GAP_MAX    = 22
    private readonly SIZE       = 80

    // DOM
    private root!:       HTMLDivElement
    private svg!:        SVGSVGElement
    private dot!:        SVGCircleElement
    private innerRing!:  SVGCircleElement
    private reloadRing!: SVGCircleElement
    private lines:       SVGLineElement[] = []

    // Excesso além do MAX_RANGE — lido pela Camera para girar quando
    // a mira bate na borda. Zero quando dentro do raio.
    overshootX = 0
    overshootY = 0

    // Estado
    private _armed         = false
    private _spread        = 0
    private _targetSpread  = 0
    private _reloading     = false
    private _reloadDur     = 0.8
    private _reloadElapsed = 0
    private _pulseTimer    = 0

    // Posição atual da mira (suavizada, em px relativo ao centro)
    private _currentX = 0
    private _currentY = 0

    // Target bruto do mouse (em px relativo ao centro)
    private _targetX  = 0
    private _targetY  = 0

    constructor() {
        this._buildDOM()
        this._buildElements()
        this._injectStyle()
        this._bindMouse()
        // Posiciona no centro inicialmente
        this._updateDOMPosition()
    }

    private _buildDOM() {
        this.root = document.createElement('div')
        this.root.id = 'crosshair-root'
        Object.assign(this.root.style, {
            position:       'fixed',
            width:          `${this.SIZE}px`,
            height:         `${this.SIZE}px`,
            pointerEvents:  'none',
            zIndex:         '1100',
            opacity:        '0',
            willChange:     'transform, left, top',
        })
        document.body.appendChild(this.root)

        this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement
        this.svg.setAttribute('viewBox', `0 0 ${this.SIZE} ${this.SIZE}`)
        this.svg.setAttribute('width',   String(this.SIZE))
        this.svg.setAttribute('height',  String(this.SIZE))
        this.svg.style.overflow = 'visible'
        this.root.appendChild(this.svg)
    }

    private _bindMouse() {
        // Acumula o delta do mouse com pointer lock.
        // A mira se move livremente dentro do MAX_RANGE.
        // Quando chega na borda, expõe o excesso via overshootX/Y
        // para a câmera girar proporcionalmente.
        document.addEventListener('mousemove', (e: MouseEvent) => {
            if (!document.pointerLockElement) return
            this._targetX += e.movementX
            this._targetY += e.movementY
        })
        window.addEventListener('resize', () => {
            this.resetToCenter()
        })
    }

    private _buildElements() {
        const ns = 'http://www.w3.org/2000/svg'
        const cx = this.SIZE / 2
        const cy = this.SIZE / 2

        // Reload background ring
        const reloadBg = document.createElementNS(ns, 'circle') as SVGCircleElement
        reloadBg.setAttribute('cx', String(cx))
        reloadBg.setAttribute('cy', String(cy))
        reloadBg.setAttribute('r',  String(this.RELOAD_R))
        reloadBg.setAttribute('fill',         'none')
        reloadBg.setAttribute('stroke',       'rgba(255,255,255,0.1)')
        reloadBg.setAttribute('stroke-width', '1.5')
        this.svg.appendChild(reloadBg)

        // Reload progress ring
        this.reloadRing = document.createElementNS(ns, 'circle') as SVGCircleElement
        const circ = 2 * Math.PI * this.RELOAD_R
        this.reloadRing.setAttribute('cx',                String(cx))
        this.reloadRing.setAttribute('cy',                String(cy))
        this.reloadRing.setAttribute('r',                 String(this.RELOAD_R))
        this.reloadRing.setAttribute('fill',              'none')
        this.reloadRing.setAttribute('stroke',            'rgba(255,215,80,0.9)')
        this.reloadRing.setAttribute('stroke-width',      '2')
        this.reloadRing.setAttribute('stroke-linecap',    'round')
        this.reloadRing.setAttribute('stroke-dasharray',  String(circ))
        this.reloadRing.setAttribute('stroke-dashoffset', String(circ))
        this.reloadRing.setAttribute('transform',         `rotate(-90 ${cx} ${cy})`)
        this.svg.appendChild(this.reloadRing)

        // Inner ring
        this.innerRing = document.createElementNS(ns, 'circle') as SVGCircleElement
        this.innerRing.setAttribute('cx',           String(cx))
        this.innerRing.setAttribute('cy',           String(cy))
        this.innerRing.setAttribute('r',            String(this.RING_R))
        this.innerRing.setAttribute('fill',         'none')
        this.innerRing.setAttribute('stroke',       'rgba(255,255,255,0.55)')
        this.innerRing.setAttribute('stroke-width', '1')
        this.svg.appendChild(this.innerRing)

        // 4 linhas
        for (let i = 0; i < 4; i++) {
            const line = document.createElementNS(ns, 'line') as SVGLineElement
            line.setAttribute('stroke',        'rgba(255,255,255,0.85)')
            line.setAttribute('stroke-width',  '1.5')
            line.setAttribute('stroke-linecap','round')
            this.lines.push(line)
            this.svg.appendChild(line)
        }

        // Dot central
        this.dot = document.createElementNS(ns, 'circle') as SVGCircleElement
        this.dot.setAttribute('cx',   String(cx))
        this.dot.setAttribute('cy',   String(cy))
        this.dot.setAttribute('r',    String(this.DOT_R))
        this.dot.setAttribute('fill', 'rgba(255,60,60,0.95)')
        this.svg.appendChild(this.dot)
    }

    private _injectStyle() {
        if (document.getElementById('crosshair-style')) return
        const s = document.createElement('style')
        s.id = 'crosshair-style'
        s.textContent = `
            @keyframes ch-pulse {
                0%   { filter: drop-shadow(0 0 0px rgba(255,80,80,0)); }
                50%  { filter: drop-shadow(0 0 6px rgba(255,80,80,0.9)); }
                100% { filter: drop-shadow(0 0 0px rgba(255,80,80,0)); }
            }
            #crosshair-root.pulse { animation: ch-pulse 0.15s ease-out; }
        `
        document.head.appendChild(s)
    }

    // ── API pública ───────────────────────────────────────────────────────

    resetToCenter() {
        this._targetX  = 0
        this._targetY  = 0
        this._currentX = 0
        this._currentY = 0
        this._updateDOMPosition()
    }

    setArmed(armed: boolean) {
        this._armed = armed
        this.root.style.opacity = armed ? '1' : '0'
        if (!armed) {
            this._currentX = 0; this._currentY = 0
            this._targetX  = 0; this._targetY  = 0
            this._updateDOMPosition()
        }
    }

    onFire() {
        this._targetSpread = 1
        this._pulseTimer   = 0.14
        this.root.classList.remove('pulse')
        void (this.root as HTMLElement).offsetWidth
        this.root.classList.add('pulse')
    }

    startReload(duration: number) {
        this._reloading     = true
        this._reloadDur     = duration
        this._reloadElapsed = 0
    }

    // ── Update ────────────────────────────────────────────────────────────
    update(delta: number) {
        if (!this._armed) return

        // ── 1. Mira se move dentro do raio, câmera gira na borda ─────────
        const dist = Math.sqrt(this._targetX ** 2 + this._targetY ** 2)

        if (dist <= this.MAX_RANGE) {
            // Dentro do raio — mira livre, câmera parada
            this._currentX   = this._targetX
            this._currentY   = this._targetY
            this.overshootX  = 0
            this.overshootY  = 0
        } else {
            // Fora do raio — mira trava na borda, excesso vai para câmera
            const scale      = this.MAX_RANGE / dist
            this._currentX   = this._targetX * scale
            this._currentY   = this._targetY * scale
            // Overshoot normalizado: quanto além do raio (0..N px/frame)
            this.overshootX  = this._targetX - this._currentX
            this.overshootY  = this._targetY - this._currentY
            // Mantém o target clampado para não acumular infinitamente
            this._targetX    = this._currentX
            this._targetY    = this._currentY
        }

        this.aimScreenX = window.innerWidth  / 2 + this._currentX
        this.aimScreenY = window.innerHeight / 2 + this._currentY
        this._updateDOMPosition()

        // ── 2. Spread ─────────────────────────────────────────────────────
        this._targetSpread = Math.max(0, this._targetSpread - delta * 5)
        this._spread += (this._targetSpread - this._spread) * Math.min(1, delta * 18)

        const vcx     = this.SIZE / 2
        const vcy     = this.SIZE / 2
        const gap     = this.GAP_BASE + this._spread * (this.GAP_MAX - this.GAP_BASE)
        const lineEnd = gap + this.LINE_LEN

        this._setLine(0, vcx, vcy - gap,  vcx, vcy - lineEnd)   // top
        this._setLine(1, vcx, vcy + gap,  vcx, vcy + lineEnd)   // bottom
        this._setLine(2, vcx - gap, vcy,  vcx - lineEnd, vcy)   // left
        this._setLine(3, vcx + gap, vcy,  vcx + lineEnd, vcy)   // right

        const ringR = this.RING_R + this._spread * 3
        this.innerRing.setAttribute('r',      String(ringR))
        this.innerRing.setAttribute('stroke', `rgba(255,255,255,${(0.55 - this._spread * 0.25).toFixed(2)})`)

        // ── 3. Recarga ────────────────────────────────────────────────────
        if (this._reloading) {
            this._reloadElapsed += delta
            const frac = Math.min(1, this._reloadElapsed / this._reloadDur)
            const circ = 2 * Math.PI * this.RELOAD_R
            this.reloadRing.setAttribute('stroke-dashoffset', String(circ * (1 - frac)))
            this.reloadRing.setAttribute('stroke',
                frac >= 0.9 ? 'rgba(100,255,120,0.95)' : 'rgba(255,215,80,0.9)')
            if (frac >= 1) {
                this._reloading = false
                setTimeout(() => {
                    this.reloadRing.setAttribute('stroke-dashoffset', String(circ))
                    this.reloadRing.setAttribute('stroke', 'rgba(255,215,80,0.9)')
                }, 300)
            }
        }

        // ── 4. Pulso do dot ───────────────────────────────────────────────
        if (this._pulseTimer > 0) {
            this._pulseTimer -= delta
            this.dot.setAttribute('r', String(this.DOT_R * (1 + (this._pulseTimer / 0.14) * 0.5)))
        } else {
            this.dot.setAttribute('r', String(this.DOT_R))
        }
    }

    private _updateDOMPosition() {
        const cx = window.innerWidth  / 2
        const cy = window.innerHeight / 2
        this.root.style.left = `${Math.round(cx + this._currentX - this.SIZE / 2)}px`
        this.root.style.top  = `${Math.round(cy + this._currentY - this.SIZE / 2)}px`
    }

    private _setLine(idx: number, x1: number, y1: number, x2: number, y2: number) {
        const l = this.lines[idx]
        l.setAttribute('x1', String(x1)); l.setAttribute('y1', String(y1))
        l.setAttribute('x2', String(x2)); l.setAttribute('y2', String(y2))
    }
}

export default Crosshair