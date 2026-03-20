/**
 * SurvivalSystem.ts
 *
 * Gerencia:
 *  - Fome: barra que esvazia com o tempo; correr/lutar acelera
 *  - Recursos: madeira, pedra, couro
 *  - Construção da cabana (integra com Cabin.ts)
 *  - HUD survival (fome + materiais + instrução de construção)
 *  - Dano quando fome = 0
 */

import { Scene, Vector3 } from 'three'
import { Cabin, CABIN_RECIPES, SAFE_ZONE_RADIUS } from './Cabin'
import { spawnResourceNodes, ResourceNode, ResourceType } from './ResourceNode'

// ── Config ────────────────────────────────────────────────────────────────
const HUNGER_MAX         = 100
const HUNGER_DRAIN_IDLE  = 1.2    // por segundo parado
const HUNGER_DRAIN_RUN   = 3.5    // por segundo correndo
const HUNGER_DRAIN_FIGHT = 2.5    // por segundo atirando
const HUNGER_DAMAGE_RATE = 5      // dano/s quando fome = 0
const FOOD_PER_WOLF      = 35     // comida por lobo abatido
const LEATHER_PER_WOLF   = 1      // couro por lobo abatido

export class SurvivalSystem {

    // ── Estado ────────────────────────────────────────────────────────────
    hunger   = HUNGER_MAX
    wood     = 0
    stone    = 0
    leather  = 0

    cabin:   Cabin
    private _nodes:      ResourceNode[] = []
    private _scene:      Scene
    private _hudRoot!:   HTMLDivElement
    private _hungerFill!:HTMLDivElement
    private _hungerNum!: HTMLSpanElement
    private _resWood!:   HTMLSpanElement
    private _resStone!:  HTMLSpanElement
    private _resLeather!:HTMLSpanElement
    private _buildHint!: HTMLDivElement
    private _notifEl!:   HTMLDivElement
    private _notifTimer = 0

    constructor(scene: Scene) {
        this._scene = scene

        // Cabana próxima ao spawn do player
        this.cabin = new Cabin(scene, new Vector3(15, 0, 15))

        // Spawna recursos no mapa
        this._nodes = spawnResourceNodes(scene, 18, 14)

        this._buildHUD()
    }

    // ── API pública ───────────────────────────────────────────────────────

    /** Chamado ao matar um lobo */
    onWolfKilled() {
        this.hunger  = Math.min(HUNGER_MAX, this.hunger + FOOD_PER_WOLF)
        this.leather += LEATHER_PER_WOLF
        this._notify('Lobo abatido', `+${LEATHER_PER_WOLF} couro`, `+${FOOD_PER_WOLF}`)
        this._updateHUD()
    }

    /** Tenta construir próximo estágio da cabana. Retorna true se bem-sucedido. */
    tryBuild(): boolean {
        const result = this.cabin.build({ wood: this.wood, stone: this.stone, leather: this.leather })
        if (!result) return false

        this.wood    = result.wood
        this.stone   = result.stone
        this.leather = result.leather

        const stages = ['', 'Fundação construída', 'Paredes erguidas', 'Zona Segura Ativa']
        const badges = ['', '1/3', '2/3', '3/3']
        this._notify('Construção', stages[this.cabin.stage] ?? '', badges[this.cabin.stage] ?? '')
        this._updateHUD()
        return true
    }

    /** Verifica se a posição está dentro da zona segura */
    isInSafeZone(pos: Vector3): boolean {
        return this.cabin.isInsideSafeZone(pos)
    }

    /** Verifica se o lobo deve parar por estar perto da zona segura */
    shouldWolfStop(wolfPos: Vector3): boolean {
        if (!this.cabin.isComplete()) return false
        return wolfPos.distanceTo(this.cabin.position) < SAFE_ZONE_RADIUS
    }

    // ── Update ────────────────────────────────────────────────────────────

    update(
        delta: number,
        playerPos: Vector3,
        isRunning: boolean,
        isShooting: boolean,
        camera: import('three').Camera,
        onPlayerDamage: (amount: number) => void,
        onBuildKey: boolean   // tecla E pressionada
    ) {
        // ── Fome ──────────────────────────────────────────────────────────
        let drain = HUNGER_DRAIN_IDLE
        if (isRunning) drain = HUNGER_DRAIN_RUN
        else if (isShooting) drain = HUNGER_DRAIN_FIGHT

        this.hunger = Math.max(0, this.hunger - drain * delta)

        if (this.hunger <= 0) {
            onPlayerDamage(HUNGER_DAMAGE_RATE * delta)
        }

        // ── Construção com E ───────────────────────────────────────────────
        const distToCabin = playerPos.distanceTo(this.cabin.position)
        if (onBuildKey && distToCabin < 4.5 && this.cabin.nextRecipe()) {
            if (!this.tryBuild()) {
                const recipe = this.cabin.nextRecipe()!
                const missing: string[] = []
                if (this.wood    < recipe.wood)    missing.push(`${recipe.wood - this.wood} madeira`)
                if (this.stone   < recipe.stone)   missing.push(`${recipe.stone - this.stone} pedra`)
                if (this.leather < recipe.leather) missing.push(`${recipe.leather - this.leather} couro`)
                this._notify('Recursos insuficientes', missing.join(' · '))
            }
        }

        // ── Recursos ──────────────────────────────────────────────────────
        for (const node of this._nodes) {
            node.update(delta, playerPos, (type: ResourceType) => {
                if (type === 'wood')  { this.wood++;  this._notify('Madeira coletada', `Total: ${this.wood}`, `+1`) }
                if (type === 'stone') { this.stone++; this._notify('Pedra coletada',   `Pedra: ${this.stone}`) }
                this._updateHUD()
            })
        }

        // ── Cabin update (label projeção) ──────────────────────────────────
        this.cabin.update(camera)

        // ── HUD ────────────────────────────────────────────────────────────
        this._updateHUD()

        // Dica de construção quando perto
        const recipe = this.cabin.nextRecipe()
        if (distToCabin < 6 && recipe) {
            const canBuild = this.wood >= recipe.wood && this.stone >= recipe.stone && this.leather >= recipe.leather
            this._buildHint.style.display = 'block'
            this._buildHint.textContent   = canBuild
                ? `[ E ] Construir (Estágio ${this.cabin.stage + 1})`
                : `Precisa: ${recipe.wood}🪵 ${recipe.stone}🪨 ${recipe.leather > 0 ? recipe.leather + '🐺' : ''}`
            this._buildHint.style.color   = canBuild ? 'rgba(100,255,120,0.95)' : 'rgba(255,180,60,0.85)'
        } else {
            this._buildHint.style.display = 'none'
        }

        // Notificação timer
        if (this._notifTimer > 0) {
            this._notifTimer -= delta
            if (this._notifTimer <= 0) {
                this._notifEl.style.opacity = '0'
            }
        }
    }

    // ── HUD Survival ──────────────────────────────────────────────────────

    private _buildHUD() {
        // Injeta fonte se necessário
        if (!document.getElementById('survival-style')) {
            const s = document.createElement('style')
            s.id = 'survival-style'
            s.textContent = `
                @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700&display=swap');
                #survival-hud { font-family: 'Barlow Condensed', sans-serif; }
            `
            document.head.appendChild(s)
        }

        this._hudRoot = document.createElement('div')
        this._hudRoot.id = 'survival-hud'
        Object.assign(this._hudRoot.style, {
            position:      'fixed',
            bottom:        '120px',
            right:         '18px',
            display:       'flex',
            flexDirection: 'column',
            alignItems:    'flex-end',
            gap:           '6px',
            pointerEvents: 'none',
            zIndex:        '900',
        })
        document.body.appendChild(this._hudRoot)

        // ── Fome ────────────────────────────────────────────────────────
        const hungerWrap = document.createElement('div')
        Object.assign(hungerWrap.style, {
            display:     'flex',
            alignItems:  'center',
            gap:         '6px',
        })
        const hungerIcon = document.createElement('span')
        hungerIcon.textContent = '🍖'
        hungerIcon.style.fontSize = '14px'
        hungerWrap.appendChild(hungerIcon)

        const hungerBar = document.createElement('div')
        Object.assign(hungerBar.style, {
            width:        '90px',
            height:       '5px',
            background:   'rgba(255,255,255,0.1)',
            borderRadius: '3px',
            overflow:     'hidden',
            border:       '1px solid rgba(255,255,255,0.12)',
        })
        this._hungerFill = document.createElement('div')
        Object.assign(this._hungerFill.style, {
            height:       '100%',
            width:        '100%',
            background:   'linear-gradient(90deg,#e05010,#f09040)',
            borderRadius: '3px',
            transition:   'width 0.3s ease, background 0.5s',
        })
        hungerBar.appendChild(this._hungerFill)
        hungerWrap.appendChild(hungerBar)

        this._hungerNum = document.createElement('span')
        Object.assign(this._hungerNum.style, {
            fontSize:      '11px',
            fontWeight:    '700',
            color:         'rgba(255,200,100,0.8)',
            minWidth:      '28px',
            textAlign:     'right',
            letterSpacing: '0.5px',
        })
        this._hungerNum.textContent = '100'
        hungerWrap.appendChild(this._hungerNum)
        this._hudRoot.appendChild(hungerWrap)

        // ── Recursos ────────────────────────────────────────────────────
        const resRow = document.createElement('div')
        Object.assign(resRow.style, {
            display:    'flex',
            gap:        '10px',
            alignItems: 'center',
        })

        const makeRes = (icon: string): HTMLSpanElement => {
            const el = document.createElement('span')
            Object.assign(el.style, {
                fontSize:      '11px',
                fontWeight:    '600',
                color:         'rgba(220,200,140,0.75)',
                letterSpacing: '0.5px',
            })
            el.textContent = `${icon} 0`
            resRow.appendChild(el)
            return el
        }

        this._resWood    = makeRes('🪵')
        this._resStone   = makeRes('🪨')
        this._resLeather = makeRes('🐺')
        this._hudRoot.appendChild(resRow)

        // ── Dica construção ─────────────────────────────────────────────
        this._buildHint = document.createElement('div')
        Object.assign(this._buildHint.style, {
            fontSize:      '11px',
            fontWeight:    '600',
            letterSpacing: '1px',
            display:       'none',
            textShadow:    '0 1px 4px rgba(0,0,0,0.9)',
        })
        this._hudRoot.appendChild(this._buildHint)

        // ── Notificação survival ─────────────────────────────────────────
        this._notifEl = document.createElement('div')
        Object.assign(this._notifEl.style, {
            position:      'fixed',
            top:           '50%',
            left:          '50%',
            transform:     'translate(-50%, -50%)',
            background:    'rgba(0,0,0,0.7)',
            border:        '1px solid rgba(255,200,80,0.3)',
            borderRadius:  '6px',
            padding:       '10px 20px',
            textAlign:     'center',
            pointerEvents: 'none',
            zIndex:        '2000',
            opacity:       '0',
            transition:    'opacity 0.3s',
            fontFamily:    "'Barlow Condensed', sans-serif",
        })
        document.body.appendChild(this._notifEl)
    }

    private _updateHUD() {
        const pct = this.hunger / HUNGER_MAX
        this._hungerFill.style.width = `${pct * 100}%`
        this._hungerNum.textContent  = String(Math.ceil(this.hunger))

        // Cor: verde → laranja → vermelho
        if (pct > 0.5)       this._hungerFill.style.background = 'linear-gradient(90deg,#20c040,#60d860)'
        else if (pct > 0.25) this._hungerFill.style.background = 'linear-gradient(90deg,#e09010,#f0b040)'
        else                 this._hungerFill.style.background = 'linear-gradient(90deg,#e02010,#f04030)'

        this._resWood.textContent    = `🪵 ${this.wood}`
        this._resStone.textContent   = `🪨 ${this.stone}`
        this._resLeather.textContent = `🐺 ${this.leather}`
    }

    private _notify(title: string, body: string, badge = '') {
        this._notifEl.innerHTML = `
            <div style="font-size:13px;font-weight:700;color:rgba(255,210,80,0.9);letter-spacing:1px">${title}${badge ? `<span style="margin-left:8px;font-size:11px;font-weight:700;color:#0d0a06;background:#e8c060;border-radius:2px;padding:1px 7px">${badge}</span>` : ''}</div>
            <div style="font-size:11px;font-weight:400;color:rgba(255,255,255,0.6);margin-top:3px">${body}</div>
        `
        this._notifEl.style.opacity = '1'
        this._notifTimer = 2.5
    }
}

export default SurvivalSystem