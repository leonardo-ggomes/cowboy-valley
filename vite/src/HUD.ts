/**
 * HUD.ts — GTA V layout + Radial Menu moderno
 *
 * Radial redesenhado:
 *  - Arc segments SVG por slot (não círculos simples)
 *  - Info panel lateral deslizante ao hover
 *  - Número de atalho externo a cada slot
 *  - Anel orbit pulsante
 *  - Tick mark no centro apontando para o item selecionado
 */

export interface EquipmentItem {
  id: string
  icon: string
  label: string
  description: string
  category: string
  ammo: number | null
  maxAmmo: number | null
}

export interface HUDState {
  health: number
  maxHealth: number
  armor: number
  maxArmor: number
  stamina: number
  maxStamina: number
  money: number
  wantedLevel: number
  activeItemIdx: number
  isShooting: boolean
  playerX: number
  playerZ: number
  playerAngle: number
  npcs: Array<{ x: number; z: number; isAlive: boolean; isHostile: boolean }>
  mission: { area: string; title: string; objective: string; progress?: number } | null
}

export class HUD {
  private healthFill!: HTMLDivElement
  private armorFill!: HTMLDivElement
  private healthNum!: HTMLSpanElement
  private armorNum!: HTMLSpanElement
  private sprintFill!: HTMLDivElement
  private moneyEl!: HTMLDivElement
  private wantedStars: HTMLDivElement[] = []
  private weaponIcon!: HTMLDivElement
  private weaponAmmo!: HTMLDivElement
  private weaponReserve!: HTMLDivElement
  private weaponName!: HTMLDivElement
  private missionArea!: HTMLDivElement
  private missionName!: HTMLDivElement
  private missionObj!: HTMLDivElement
  private missionBarFill!: HTMLDivElement
  private minimapCtx!: CanvasRenderingContext2D
  private notifWrap!:  HTMLDivElement
  private notifTitle!: HTMLDivElement
  private notifBody!:  HTMLDivElement
  private notifBadge!: HTMLDivElement
  private notifIcon!:  HTMLDivElement

  // Radial
  private radialOverlay!: HTMLDivElement
  private radialSVG!: SVGSVGElement
  private rcName!: HTMLSpanElement
  private rcSub!: HTMLSpanElement
  private ipPanel!: HTMLDivElement
  private ipName!: HTMLDivElement
  private ipDesc!: HTMLDivElement
  private ipAmmo!: HTMLDivElement
  private ipAmmoLabel!: HTMLDivElement
  private radialPulseT = 0

  private equipment: EquipmentItem[]
  activeItemIdx = 0
  // Chamado quando o usuário seleciona um item no radial
  // Parâmetros: item selecionado, se é ranged (tem ammo)
  onItemSelect?: (item: EquipmentItem, isRanged: boolean) => void
  private prevHealth = 100
  private moneyAnim = 0
  private isRadialOpen = false
  private hoveredIdx = -1
  private minimapRange = 50

  // SVG radial geometry
  private readonly R_ORBIT = 125
  private readonly CX = 190
  private readonly CY = 190

  constructor(items: EquipmentItem[] = HUD.defaultEquipment()) {
    this.equipment = items
    this.inject()
    this.build()
    this.bindKeys()
  }

  static defaultEquipment(): EquipmentItem[] {
    return [
      { id:'revolver',  icon:'🔫', label:'Revólver',  description:'Arma primária do cowboy',  category:'ARMA',  ammo:6,    maxAmmo:36   },
      { id:'lasso',     icon:'🪃', label:'Laço',      description:'Captura alvos vivos',       category:'UTIL',  ammo:null, maxAmmo:null },
      { id:'dynamite',  icon:'💣', label:'Dinamite',  description:'Explosivo de área',         category:'EXPLO', ammo:3,    maxAmmo:9    },
      { id:'elixir',    icon:'🧪', label:'Elixir',    description:'Recupera 50 de vida',       category:'ITEM',  ammo:2,    maxAmmo:5    },
      { id:'knife',     icon:'🗡',  label:'Faca',      description:'Silencioso e rápido',       category:'CORPO', ammo:null, maxAmmo:null },
      { id:'axe',       icon:'🪓',  label:'Machado',   description:'Alto dano, baixo alcance',  category:'CORPO', ammo:null, maxAmmo:null },
      { id:'rifle',     icon:'🔭', label:'Rifle',     description:'Precisão longa distância',  category:'ARMA',  ammo:8,    maxAmmo:24   },
      { id:'shield',    icon:'🛡',  label:'Escudo',    description:'Reduz dano em 40%',         category:'DEF',   ammo:null, maxAmmo:null },
    ]
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CSS
  // ─────────────────────────────────────────────────────────────────────────
  private inject() {
    if (document.getElementById('hud-css')) return
    const s = document.createElement('style')
    s.id = 'hud-css'
    s.textContent = `
@import url('https://fonts.googleapis.com/css2?family=Barlow:wght@300;400;700&family=Inter:wght@300;400;500;600&display=swap');
:root{--gg:rgba(200,240,132,1);--ggd:rgba(200,240,132,.5);--gw:rgba(255,255,255,.88);--gm:rgba(255,255,255,.35);--gf:'Barlow',sans-serif;}
#hud-root{position:fixed;inset:0;pointer-events:none;z-index:1000;font-family:var(--gf);}

/* minimap */
#hud-mm-wrap{position:absolute;bottom:56px;left:18px;}
#hud-mm{display:block;border:2px solid rgba(0,0,0,.55);outline:1px solid rgba(255,255,255,.07);}
#hud-mm-area{font-size:11px;font-weight:700;color:var(--gw);letter-spacing:1px;text-transform:uppercase;margin-top:4px;}
#hud-mm-street{font-size:9px;color:var(--gm);letter-spacing:.5px;}

/* vitals */
#hud-vitals{position:absolute;bottom:18px;left:18px;display:flex;flex-direction:column;gap:5px;}
.g-bar{display:flex;align-items:center;gap:6px;}
.g-bar-track{width:130px;height:4px;background:rgba(255,255,255,.08);overflow:hidden;}
.g-bar-fill{height:100%;transition:width .3s;}
#g-hp-fill{background:rgba(225,225,225,.9);}
#g-ap-fill{background:#4a9fd4;}
.g-bar-num{font-size:11px;font-weight:700;color:var(--gm);min-width:22px;}

/* sprint */
#hud-sprint{position:absolute;bottom:18px;left:160px;width:50px;height:3px;background:rgba(255,255,255,.06);}
#hud-sprint-fill{height:100%;background:#e8c84a;transition:width .3s;}
@keyframes sp-low{0%,100%{opacity:1}50%{opacity:.2}}
.sp-low #hud-sprint-fill{animation:sp-low .6s ease infinite;}

/* money */
#hud-money{position:absolute;top:16px;right:18px;text-align:right;}
#hud-money-main{font-size:28px;font-weight:700;color:var(--gg);letter-spacing:-1px;text-shadow:0 1px 8px rgba(0,0,0,.9);}
#hud-money-label{font-size:10px;color:var(--ggd);letter-spacing:.5px;margin-top:1px;}

/* wanted */
#hud-wanted{position:absolute;top:62px;right:18px;display:flex;gap:4px;}
.g-star{width:15px;height:15px;opacity:.14;transition:opacity .2s;}
.g-star.on{opacity:1;}

/* weapon */
#hud-weapon{position:absolute;bottom:18px;right:18px;text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:2px;}
#hw-icon{font-size:30px;line-height:1;}
#hw-ammo{font-size:24px;font-weight:700;color:var(--gw);letter-spacing:-1px;}
#hw-res{font-size:12px;color:var(--gm);letter-spacing:1px;}
#hw-name{font-size:9px;color:var(--gm);letter-spacing:2px;text-transform:uppercase;}
#hud-weapon.unarmed{opacity:.2;}

/* mission */
#hud-mission{position:absolute;right:18px;top:50%;transform:translateY(-50%);text-align:right;max-width:220px;}
#hm-area{font-size:9px;color:var(--gm);letter-spacing:2px;text-transform:uppercase;margin-bottom:2px;}
#hm-name{font-size:15px;font-weight:700;color:var(--gw);margin-bottom:5px;display:block;}
#hm-obj{font-size:11px;font-weight:300;color:var(--gm);line-height:1.5;display:block;}
#hm-bar{width:100%;height:2px;background:rgba(255,255,255,.06);margin-top:8px;}
#hm-bar-fill{height:100%;background:var(--ggd);transition:width .6s;}

/* crosshair */

/* vignette / damage */
#hud-dmg{position:fixed;inset:0;pointer-events:none;transition:background .15s;}
#hud-dmg.hit{background:radial-gradient(ellipse at center,transparent 25%,rgba(180,20,20,.55) 100%);}

/* notification */
#hud-notif{
  position:absolute;bottom:60px;left:18px;
  background:#1a1208;
  border:1px solid rgba(200,144,26,0.4);
  border-left:4px solid #e8c060;
  border-radius:0 4px 4px 0;
  padding:10px 12px 10px 10px;
  max-width:280px;
  display:flex;align-items:center;gap:10px;
  opacity:0;transform:translateX(-12px);
  transition:opacity .25s ease,transform .25s ease;
  pointer-events:none;
}
#hud-notif.show{opacity:1;transform:translateX(0);}
#hn-icon{
  width:32px;height:32px;min-width:32px;
  border-radius:50%;
  background:rgba(200,144,26,0.15);
  border:1px solid rgba(200,144,26,0.35);
  display:flex;align-items:center;justify-content:center;
  flex-shrink:0;
}
#hn-icon svg{width:15px;height:15px;}
#hn-content{flex:1;min-width:0;}
#hn-title{font-size:12px;font-weight:700;color:#e8c060;letter-spacing:.8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
#hn-body{font-size:10px;color:rgba(200,180,120,0.6);margin-top:2px;line-height:1.4;letter-spacing:.3px;}
#hn-badge{
  font-size:11px;font-weight:700;
  color:#0d0a06;background:#e8c060;
  border-radius:2px;padding:2px 7px;
  white-space:nowrap;flex-shrink:0;
  display:none;
}

/* ── RADIAL MENU MODERNO ── */
#hud-radial{
  position:fixed;inset:0;
  background:rgba(0,0,0,0);
  display:none;align-items:center;justify-content:center;
  pointer-events:auto;z-index:2000;
  transition:background .2s;
}
#hud-radial.open{display:flex;background:rgba(0,0,0,.52);}
#hr-hint{
  position:absolute;top:20px;left:50%;transform:translateX(-50%);
  font-family:'Inter',sans-serif;font-size:9px;font-weight:400;
  color:rgba(255,255,255,.2);letter-spacing:2px;text-transform:uppercase;
}
#hr-scene{
  position:relative;width:380px;height:380px;
  display:flex;align-items:center;justify-content:center;
}
#hr-svg{position:absolute;inset:0;pointer-events:none;overflow:visible;}

/* center */
#hr-center{
  position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
  width:80px;height:80px;z-index:10;
  display:flex;flex-direction:column;align-items:center;justify-content:center;
}
#hr-disc{
  position:absolute;inset:0;border-radius:50%;
  background:rgba(8,8,18,.95);
  border:1.5px solid rgba(255,255,255,.1);
  transition:border-color .2s;
}
#hr-cn{
  position:relative;font-family:'Inter',sans-serif;
  font-size:9px;font-weight:600;letter-spacing:1.5px;
  text-transform:uppercase;color:rgba(255,255,255,.8);text-align:center;line-height:1.2;
}
#hr-cd{
  position:relative;font-family:'Inter',sans-serif;
  font-size:8px;font-weight:300;color:rgba(255,255,255,.28);margin-top:3px;text-align:center;
}

/* items */
.hr-item{
  position:absolute;transform:translate(-50%,-50%);
  width:68px;height:68px;
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  cursor:pointer;z-index:5;
}
.hr-disc{
  position:absolute;inset:0;border-radius:50%;
  background:rgba(10,10,20,.9);
  border:1.5px solid rgba(255,255,255,.08);
  transition:background .15s,border-color .15s,transform .15s;
}
.hr-item:hover .hr-disc,.hr-item.hov .hr-disc{
  background:rgba(255,255,255,.06);
  border-color:rgba(255,255,255,.35);
  transform:scale(1.1);
}
.hr-item.sel .hr-disc{
  background:rgba(255,255,255,.04);
  border-color:rgba(255,255,255,.55);
}
.hr-ico{position:relative;font-size:22px;line-height:1;transition:transform .15s;}
.hr-item:hover .hr-ico,.hr-item.hov .hr-ico{transform:scale(1.08);}
.hr-lbl{
  position:relative;font-family:'Inter',sans-serif;
  font-size:7.5px;font-weight:500;letter-spacing:.8px;text-transform:uppercase;
  color:rgba(255,255,255,.28);margin-top:3px;text-align:center;transition:color .15s;
}
.hr-item:hover .hr-lbl,.hr-item.hov .hr-lbl{color:rgba(255,255,255,.75);}
.hr-item.sel .hr-lbl{color:rgba(255,255,255,.6);}
.hr-badge{
  position:absolute;top:4px;right:4px;
  font-family:'Inter',sans-serif;font-size:8px;font-weight:600;
  color:rgba(255,255,255,.45);background:rgba(0,0,0,.6);
  border:1px solid rgba(255,255,255,.1);border-radius:3px;padding:1px 4px;line-height:1;
  transition:color .15s,border-color .15s;
}
.hr-item:hover .hr-badge,.hr-item.hov .hr-badge{color:rgba(255,255,255,.9);border-color:rgba(255,255,255,.3);}
.hr-item.sel .hr-badge{color:rgba(255,255,255,.8);}
.hr-sel-ring{
  position:absolute;inset:-5px;border-radius:50%;
  border:1px solid rgba(255,255,255,0);
  transition:border-color .2s;pointer-events:none;
}
.hr-item.sel .hr-sel-ring{border-color:rgba(255,255,255,.18);}
.hr-outer-num{
  position:absolute;transform:translate(-50%,-50%);
  font-family:'Inter',sans-serif;font-size:9px;font-weight:500;letter-spacing:1px;
  color:rgba(255,255,255,.18);pointer-events:none;
  transition:color .15s;
}
.hr-outer-num.active{color:rgba(255,255,255,.65);}

/* info panel */
#hr-info{
  position:absolute;right:-145px;top:50%;transform:translateY(-50%);
  width:130px;opacity:0;
  transition:opacity .2s,right .2s;
  pointer-events:none;
}
#hr-info.show{opacity:1;right:-152px;}
#hr-info-div{
  width:1px;height:60px;background:rgba(255,255,255,.08);
  position:absolute;left:-16px;top:50%;transform:translateY(-50%);
}
#hr-info-name{font-family:'Inter',sans-serif;font-size:13px;font-weight:600;color:rgba(255,255,255,.9);margin-bottom:4px;}
#hr-info-desc{font-family:'Inter',sans-serif;font-size:11px;font-weight:300;color:rgba(255,255,255,.38);line-height:1.5;}
#hr-info-ammo{font-family:'Inter',sans-serif;font-size:20px;font-weight:600;color:rgba(255,255,255,.8);margin-top:8px;letter-spacing:-1px;}
#hr-info-ammo-lbl{font-family:'Inter',sans-serif;font-size:9px;color:rgba(255,255,255,.22);letter-spacing:1px;text-transform:uppercase;}
`
    document.head.appendChild(s)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DOM
  // ─────────────────────────────────────────────────────────────────────────
  private build() {
    const dmg = document.createElement('div'); dmg.id = 'hud-dmg'; document.body.appendChild(dmg)
    const root = document.createElement('div'); root.id = 'hud-root'; document.body.appendChild(root)

    // Minimap
    const mmWrap = document.createElement('div'); mmWrap.id = 'hud-mm-wrap'
    const mmC = document.createElement('canvas'); mmC.id = 'hud-mm'; mmC.width = 112; mmC.height = 112
    const mmArea = document.createElement('div'); mmArea.id = 'hud-mm-area'; mmArea.textContent = 'Sandy Shores'
    const mmStreet = document.createElement('div'); mmStreet.id = 'hud-mm-street'; mmStreet.textContent = 'Route 68'
    mmWrap.append(mmC, mmArea, mmStreet); root.appendChild(mmWrap)
    this.minimapCtx = mmC.getContext('2d')!

    // Vitals
    const vitals = document.createElement('div'); vitals.id = 'hud-vitals'
    vitals.innerHTML = `
      <div class="g-bar">
        <svg width="14" height="14" viewBox="0 0 14 14"><path d="M7 12C3 9 1 6.5 1 4.5A2.5 2.5 0 017 3.2 2.5 2.5 0 0113 4.5C13 6.5 11 9 7 12Z" fill="rgba(215,215,215,.9)"/></svg>
        <div class="g-bar-track"><div class="g-bar-fill" id="g-hp-fill" style="width:100%"></div></div>
        <span class="g-bar-num" id="g-hp-num">100</span>
      </div>
      <div class="g-bar">
        <svg width="14" height="14" viewBox="0 0 14 14"><path d="M7 2L3 5v4l4 3 4-3V5z" fill="#4a9fd4" opacity=".9"/></svg>
        <div class="g-bar-track"><div class="g-bar-fill" id="g-ap-fill" style="width:0%"></div></div>
        <span class="g-bar-num" id="g-ap-num">0</span>
      </div>`
    root.appendChild(vitals)
    this.healthFill = document.getElementById('g-hp-fill')! as HTMLDivElement
    this.armorFill  = document.getElementById('g-ap-fill')! as HTMLDivElement
    this.healthNum  = document.getElementById('g-hp-num')!  as HTMLSpanElement
    this.armorNum   = document.getElementById('g-ap-num')!  as HTMLSpanElement

    // Sprint
    const sprint = document.createElement('div'); sprint.id = 'hud-sprint'
    const sf = document.createElement('div'); sf.id = 'hud-sprint-fill'
    sprint.appendChild(sf); root.appendChild(sprint); this.sprintFill = sf

    // Money
    const money = document.createElement('div'); money.id = 'hud-money'
    money.innerHTML = `<div id="hud-money-main">$0</div><div id="hud-money-label">Carteira</div>`
    root.appendChild(money)
    this.moneyEl = document.getElementById('hud-money-main')! as HTMLDivElement

    // Wanted
    const wanted = document.createElement('div'); wanted.id = 'hud-wanted'
    for (let i = 0; i < 5; i++) {
      const star = document.createElement('div'); star.className = 'g-star'
      star.innerHTML = `<svg width="15" height="15" viewBox="0 0 14 14"><path d="M7 1l1.5 3.5L12 5l-2.5 2.5.6 3.5L7 9.5 3.9 11l.6-3.5L2 5l3.5-.5z" fill="#d4af37"/></svg>`
      wanted.appendChild(star); this.wantedStars.push(star)
    }
    root.appendChild(wanted)

    // Weapon
    const weapon = document.createElement('div'); weapon.id = 'hud-weapon'
    weapon.innerHTML = `<div id="hw-icon">🔫</div><div id="hw-ammo">—</div><div id="hw-res"></div><div id="hw-name">Nenhum</div>`
    root.appendChild(weapon)
    this.weaponIcon    = document.getElementById('hw-icon')! as HTMLDivElement
    this.weaponAmmo    = document.getElementById('hw-ammo')! as HTMLDivElement
    this.weaponReserve = document.getElementById('hw-res')!  as HTMLDivElement
    this.weaponName    = document.getElementById('hw-name')! as HTMLDivElement

    // Mission
    const mission = document.createElement('div'); mission.id = 'hud-mission'
    mission.innerHTML = `<div id="hm-area">Missão Ativa</div><span id="hm-name">—</span><span id="hm-obj">Nenhum objetivo.</span><div id="hm-bar"><div id="hm-bar-fill" style="width:0%"></div></div>`
    root.appendChild(mission)
    this.missionArea    = document.getElementById('hm-area')!     as HTMLDivElement
    this.missionName    = document.getElementById('hm-name')!     as HTMLDivElement
    this.missionObj     = document.getElementById('hm-obj')!      as HTMLDivElement
    this.missionBarFill = document.getElementById('hm-bar-fill')! as HTMLDivElement

    // Crosshair removida — gerenciada por Crosshair.ts

    // Notif — Opção A: banner lateral com ícone + badge
    const notif = document.createElement('div'); notif.id = 'hud-notif'
    notif.innerHTML = `
      <div id="hn-icon">
        <svg viewBox="0 0 16 16" fill="none">
          <path d="M8 2L9.5 6H14L10.5 8.5L12 13L8 10.5L4 13L5.5 8.5L2 6H6.5Z" fill="#e8c060"/>
        </svg>
      </div>
      <div id="hn-content">
        <div id="hn-title"></div>
        <div id="hn-body"></div>
      </div>
      <div id="hn-badge"></div>
    `
    root.appendChild(notif)
    this.notifWrap  = notif
    this.notifTitle = notif.querySelector('#hn-title')!  as HTMLDivElement
    this.notifBody  = notif.querySelector('#hn-body')!   as HTMLDivElement
    this.notifBadge = notif.querySelector('#hn-badge')!  as HTMLDivElement
    this.notifIcon  = notif.querySelector('#hn-icon')!   as HTMLDivElement

    this.buildRadial()
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Radial menu moderno
  // ─────────────────────────────────────────────────────────────────────────
  private itemAngle(i: number): number {
    return (i / this.equipment.length) * Math.PI * 2 - Math.PI / 2
  }

  private itemPos(i: number, r: number): { x: number; y: number } {
    const a = this.itemAngle(i)
    return { x: this.CX + Math.cos(a) * r, y: this.CY + Math.sin(a) * r }
  }

  private buildRadial() {
    const overlay = document.createElement('div'); overlay.id = 'hud-radial'
    const hint = document.createElement('div'); hint.id = 'hr-hint'; hint.textContent = 'Selecione a arma — ESC para fechar'
    overlay.appendChild(hint)

    const scene = document.createElement('div'); scene.id = 'hr-scene'

    // SVG layer
    const svgNS = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(svgNS, 'svg') as SVGSVGElement
    svg.id = 'hr-svg'
    svg.setAttribute('viewBox', '0 0 380 380')
    svg.setAttribute('xmlns', svgNS)
    scene.appendChild(svg)
    this.radialSVG = svg

    // Center
    const center = document.createElement('div'); center.id = 'hr-center'
    center.innerHTML = `<div id="hr-disc"></div><span id="hr-cn">ARMAS</span><span id="hr-cd">TAB · fechar</span>`
    scene.appendChild(center)
    this.rcName = center.querySelector('#hr-cn')! as HTMLSpanElement
    this.rcSub  = center.querySelector('#hr-cd')! as HTMLSpanElement

    // Info panel
    const info = document.createElement('div'); info.id = 'hr-info'
    info.innerHTML = `<div id="hr-info-div"></div><div id="hr-info-name">—</div><div id="hr-info-desc">—</div><div id="hr-info-ammo" style="display:none"></div><div id="hr-info-ammo-lbl" style="display:none">munição</div>`
    scene.appendChild(info)
    this.ipPanel    = info
    this.ipName     = info.querySelector('#hr-info-name')!     as HTMLDivElement
    this.ipDesc     = info.querySelector('#hr-info-desc')!     as HTMLDivElement
    this.ipAmmo     = info.querySelector('#hr-info-ammo')!     as HTMLDivElement
    this.ipAmmoLabel= info.querySelector('#hr-info-ammo-lbl')! as HTMLDivElement

    // Items
    this.equipment.forEach((item, i) => {
      const p = this.itemPos(i, this.R_ORBIT)
      const el = document.createElement('div')
      el.className = `hr-item${i === 0 ? ' sel' : ''}`
      el.id = `hr-item-${i}`
      el.style.left = p.x + 'px'; el.style.top = p.y + 'px'
      el.innerHTML = `
        <div class="hr-disc"></div>
        <div class="hr-sel-ring"></div>
        <div class="hr-ico">${item.icon}</div>
        <div class="hr-lbl">${item.label}</div>
        ${item.ammo !== null ? `<div class="hr-badge">${item.ammo}</div>` : ''}
      `
      el.addEventListener('mouseenter', () => this.onRadialHover(i))
      el.addEventListener('mouseleave', () => this.onRadialLeave())
      el.addEventListener('click', () => this.selectItem(i, true))
      scene.appendChild(el)

      // Outer number label
      const lp = this.itemPos(i, this.R_ORBIT + 56)
      const lbl = document.createElement('div')
      lbl.className = 'hr-outer-num'
      lbl.id = `hr-num-${i}`
      lbl.style.left = lp.x + 'px'; lbl.style.top = lp.y + 'px'
      lbl.textContent = String(i + 1)
      scene.appendChild(lbl)
    })

    overlay.appendChild(scene)
    overlay.addEventListener('click', e => { if (e.target === overlay) this.closeRadial() })
    document.body.appendChild(overlay)
    this.radialOverlay = overlay

    this.drawRadialSVG()
    this.animateRadialRing()
  }

  private drawRadialSVG() {
    const svg = this.radialSVG
    const svgNS = 'http://www.w3.org/2000/svg'
    svg.innerHTML = ''
    const N = this.equipment.length
    const CX = this.CX, CY = this.CY, R = this.R_ORBIT

    // Outer dashed ring
    const outerR = document.createElementNS(svgNS, 'circle')
    outerR.setAttribute('cx', String(CX)); outerR.setAttribute('cy', String(CY))
    outerR.setAttribute('r', String(R + 38)); outerR.setAttribute('fill', 'none')
    outerR.setAttribute('stroke', 'rgba(255,255,255,.04)'); outerR.setAttribute('stroke-width', '1')
    outerR.setAttribute('stroke-dasharray', '3 8')
    svg.appendChild(outerR)

    // Inner ring
    const innerR = document.createElementNS(svgNS, 'circle')
    innerR.setAttribute('cx', String(CX)); innerR.setAttribute('cy', String(CY))
    innerR.setAttribute('r', '44'); innerR.setAttribute('fill', 'none')
    innerR.setAttribute('stroke', 'rgba(255,255,255,.05)'); innerR.setAttribute('stroke-width', '1')
    svg.appendChild(innerR)

    // Orbit ring (pulsante — id para animação)
    const orbitR = document.createElementNS(svgNS, 'circle')
    orbitR.id = 'hr-orbit-ring'
    orbitR.setAttribute('cx', String(CX)); orbitR.setAttribute('cy', String(CY))
    orbitR.setAttribute('r', String(R)); orbitR.setAttribute('fill', 'none')
    orbitR.setAttribute('stroke', 'rgba(255,255,255,.05)'); orbitR.setAttribute('stroke-width', '1')
    svg.appendChild(orbitR)

    // Arc segments
    const segGap = 0.10
    for (let i = 0; i < N; i++) {
      const startA = this.itemAngle(i) + segGap
      const endA   = this.itemAngle(i + 1) - segGap
      const r1 = R - 36, r2 = R + 36
      const x1 = CX + Math.cos(startA) * r2, y1 = CY + Math.sin(startA) * r2
      const x2 = CX + Math.cos(endA)   * r2, y2 = CY + Math.sin(endA)   * r2
      const x3 = CX + Math.cos(endA)   * r1, y3 = CY + Math.sin(endA)   * r1
      const x4 = CX + Math.cos(startA) * r1, y4 = CY + Math.sin(startA) * r1
      const la = endA - startA > Math.PI ? 1 : 0
      const path = document.createElementNS(svgNS, 'path')
      path.id = `hr-arc-${i}`
      path.setAttribute('d', `M${x1},${y1} A${r2},${r2} 0 ${la} 1 ${x2},${y2} L${x3},${y3} A${r1},${r1} 0 ${la} 0 ${x4},${y4} Z`)
      const isSel = i === this.activeItemIdx
      const isHov = i === this.hoveredIdx
      path.setAttribute('fill', isSel ? 'rgba(255,255,255,.04)' : isHov ? 'rgba(255,255,255,.025)' : 'rgba(255,255,255,.008)')
      path.setAttribute('stroke', isSel ? 'rgba(255,255,255,.18)' : isHov ? 'rgba(255,255,255,.1)' : 'rgba(255,255,255,.04)')
      path.setAttribute('stroke-width', isSel ? '1.5' : '1')
      svg.appendChild(path)
    }

    // Divider lines between segments
    for (let i = 0; i < N; i++) {
      const a = this.itemAngle(i) - Math.PI / N
      const r1 = R - 36, r2 = R + 36
      const line = document.createElementNS(svgNS, 'line')
      line.setAttribute('x1', String(CX + Math.cos(a) * r1)); line.setAttribute('y1', String(CY + Math.sin(a) * r1))
      line.setAttribute('x2', String(CX + Math.cos(a) * r2)); line.setAttribute('y2', String(CY + Math.sin(a) * r2))
      line.setAttribute('stroke', 'rgba(255,255,255,.05)'); line.setAttribute('stroke-width', '1')
      svg.appendChild(line)
    }

    // Tick mark pointing to selected item
    const tickA = this.itemAngle(this.activeItemIdx)
    const tick = document.createElementNS(svgNS, 'line')
    tick.id = 'hr-tick'
    tick.setAttribute('x1', String(CX + Math.cos(tickA) * 50)); tick.setAttribute('y1', String(CY + Math.sin(tickA) * 50))
    tick.setAttribute('x2', String(CX + Math.cos(tickA) * 60)); tick.setAttribute('y2', String(CY + Math.sin(tickA) * 60))
    tick.setAttribute('stroke', 'rgba(255,255,255,.5)'); tick.setAttribute('stroke-width', '2')
    tick.setAttribute('stroke-linecap', 'round')
    svg.appendChild(tick)
  }

  private animateRadialRing() {
    const animate = () => {
      if (!this.isRadialOpen) { requestAnimationFrame(animate); return }
      this.radialPulseT += 0.025
      const ring = document.getElementById('hr-orbit-ring')
      if (ring) {
        const v = (0.04 + Math.sin(this.radialPulseT) * 0.02).toFixed(3)
        ring.setAttribute('stroke', `rgba(255,255,255,${v})`)
      }
      requestAnimationFrame(animate)
    }
    requestAnimationFrame(animate)
  }

  private onRadialHover(i: number) {
    this.hoveredIdx = i
    const item = this.equipment[i]
    this.rcName.textContent = item.label.toUpperCase()
    this.rcSub.textContent  = item.category

    this.ipName.textContent = item.label
    this.ipDesc.textContent = item.description
    if (item.ammo !== null) {
      this.ipAmmo.textContent = String(item.ammo)
      this.ipAmmo.style.display = 'block'
      this.ipAmmoLabel.style.display = 'block'
    } else {
      this.ipAmmo.style.display = 'none'
      this.ipAmmoLabel.style.display = 'none'
    }
    this.ipPanel.classList.add('show')

    this.drawRadialSVG()
    document.querySelectorAll('.hr-outer-num').forEach((l, li) => l.classList.toggle('active', li === i))
  }

  private onRadialLeave() {
    this.hoveredIdx = -1
    this.rcName.textContent = 'ARMAS'
    this.rcSub.textContent  = 'TAB · fechar'
    this.ipPanel.classList.remove('show')
    this.drawRadialSVG()
    document.querySelectorAll('.hr-outer-num').forEach(l => l.classList.remove('active'))
  }

  openRadial() {
    this.isRadialOpen = true
    this.radialOverlay.classList.add('open')
    this.drawRadialSVG()
  }
  closeRadial() {
    this.isRadialOpen = false
    this.radialOverlay.classList.remove('open')
  }
  toggleRadial() { this.isRadialOpen ? this.closeRadial() : this.openRadial() }

  selectItem(idx: number, close = false) {
    document.getElementById(`hr-item-${this.activeItemIdx}`)?.classList.remove('sel')
    this.activeItemIdx = idx
    document.getElementById(`hr-item-${idx}`)?.classList.add('sel')
    const item = this.equipment[idx]
    if (item) {
      this.weaponIcon.textContent    = item.icon
      this.weaponAmmo.textContent    = item.ammo !== null ? String(item.ammo) : '—'
      this.weaponReserve.textContent = item.maxAmmo !== null ? `/ ${item.maxAmmo}` : ''
      this.weaponName.textContent    = item.label.toUpperCase()
      document.getElementById('hud-weapon')!.classList.toggle('unarmed', item.ammo === null)
      this.notify('Equipado', item.label)
      // Notifica Experience.ts para armar/desarmar o player
      const isRanged = item.ammo !== null
      this.onItemSelect?.(item, isRanged)
    }
    this.drawRadialSVG()
    if (close) this.closeRadial()
  }

  private bindKeys() {
    document.addEventListener('keydown', e => {
      if (e.key === 'Tab')    { e.preventDefault(); this.toggleRadial(); return }
      if (e.key === 'Escape') { this.closeRadial(); return }
      const n = parseInt(e.key)
      if (n >= 1 && n <= this.equipment.length) this.selectItem(n - 1)
    })
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Update
  // ─────────────────────────────────────────────────────────────────────────
  update(s: HUDState) {
    const hp = (s.health / s.maxHealth) * 100
    this.healthFill.style.width = `${hp}%`
    this.healthNum.textContent  = String(Math.round(s.health))
    if (s.health < this.prevHealth) this.flashDamage()
    this.prevHealth = s.health

    const ap = (s.armor / s.maxArmor) * 100
    this.armorFill.style.width = `${ap}%`
    this.armorNum.textContent  = String(Math.round(s.armor))

    const sp = (s.stamina / s.maxStamina) * 100
    this.sprintFill.style.width = `${sp}%`
    document.getElementById('hud-sprint')!.classList.toggle('sp-low', sp < 20)

    const diff = s.money - this.moneyAnim
    this.moneyAnim += diff * 0.1
    if (Math.abs(diff) < 0.5) this.moneyAnim = s.money
    this.moneyEl.textContent = `$${Math.round(this.moneyAnim).toLocaleString('pt-BR')}`

    this.wantedStars.forEach((star, i) => star.classList.toggle('on', i < s.wantedLevel))

    if (this.activeItemIdx !== s.activeItemIdx) this.selectItem(s.activeItemIdx)

    if (s.mission) {
      document.getElementById('hud-mission')!.style.opacity = '1'
      this.missionArea.textContent    = s.mission.area
      this.missionName.textContent    = s.mission.title
      this.missionObj.textContent     = s.mission.objective
      this.missionBarFill.style.width = `${(s.mission.progress ?? 0) * 100}%`
    } else {
      document.getElementById('hud-mission')!.style.opacity = '0.3'
    }

    this.drawMinimap(s)
  }

  private drawMinimap(s: HUDState) {
    const ctx = this.minimapCtx
    const W = 112, CX = 56, CY = 56, R = 55
    ctx.clearRect(0, 0, W, W)
    ctx.fillStyle = '#0b0905'; ctx.fillRect(0, 0, W, W)
    ctx.strokeStyle = 'rgba(255,255,255,.03)'; ctx.lineWidth = .5
    for (let i = 0; i <= W; i += 20) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, W); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(W, i); ctx.stroke()
    }
    ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 3
    ctx.beginPath(); ctx.moveTo(CX, 0); ctx.lineTo(CX, W); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, CY + 10); ctx.lineTo(W, CY + 10); ctx.stroke()

    const toMap = (wx: number, wz: number) => ({
      x: CX + ((wx - s.playerX) / this.minimapRange) * R,
      y: CY + ((wz - s.playerZ) / this.minimapRange) * R,
    })
    s.npcs.forEach(npc => {
      if (!npc.isAlive) return
      const { x, y } = toMap(npc.x, npc.z)
      if (Math.hypot(x - CX, y - CY) > R - 3) return
      ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2)
      ctx.fillStyle = npc.isHostile ? '#e03030' : '#d4af37'; ctx.fill()
    })
    ctx.save(); ctx.translate(CX, CY); ctx.rotate(s.playerAngle)
    ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(-4, 4); ctx.lineTo(4, 4); ctx.closePath()
    ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fill(); ctx.restore()
  }

  /**
   * Exibe notificação estilo banner lateral (Opção A).
   * @param title  Título em destaque dourado
   * @param body   Subtexto descritivo
   * @param badge  Texto do badge direito (ex: '+35', '1/3'). Omitir para esconder.
   * @param icon   SVG path do ícone central. Omitir para usar estrela padrão.
   * @param duration ms visível (padrão 2800)
   */
  notify(title: string, body = '', badge = '', icon = '', duration = 2800) {
    this.notifTitle.textContent = title
    this.notifBody.textContent  = body

    // Badge
    if (badge) {
      this.notifBadge.textContent   = badge
      this.notifBadge.style.display = 'block'
    } else {
      this.notifBadge.style.display = 'none'
    }

    // Ícone customizado
    if (icon) {
      this.notifIcon.innerHTML = `<svg viewBox="0 0 16 16" fill="none">${icon}</svg>`
    } else {
      this.notifIcon.innerHTML = `<svg viewBox="0 0 16 16" fill="none">
        <path d="M8 2L9.5 6H14L10.5 8.5L12 13L8 10.5L4 13L5.5 8.5L2 6H6.5Z" fill="#e8c060"/>
      </svg>`
    }

    this.notifWrap.classList.remove('show')
    void (this.notifWrap as any).offsetWidth   // force reflow para reiniciar transição
    this.notifWrap.classList.add('show')
    clearTimeout((this.notifWrap as any)._t)
    ;(this.notifWrap as any)._t = setTimeout(() => this.notifWrap.classList.remove('show'), duration)
  }

  flashDamage() {
    const el = document.getElementById('hud-dmg')!
    el.classList.add('hit'); setTimeout(() => el.classList.remove('hit'), 320)
  }

  getActiveItem(): EquipmentItem | null { return this.equipment[this.activeItemIdx] ?? null }
}

export default HUD