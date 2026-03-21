/**
 * Experience.ts — Controles estilo GTA V
 *
 * Modelo de movimento:
 *  - WASD move relativo ao YAW da câmera (não ao getWorldDirection defasado)
 *  - W = frente da câmera, S = trás, A = esquerda, D = direita
 *  - Player SEMPRE vira para a direção de movimento (sem strafe visual)
 *  - Animações: Walk, Running, Backward — sem WalkLeft/WalkRight
 *    (o player gira para a câmera forward em A/D, animação é Walk)
 *  - Shift = sprint com stamina
 *  - Atirar não trava movimento
 */

import {
  BufferGeometry,
  Clock,
  MathUtils,
  Mesh,
  Object3D,
  Quaternion,
  Raycaster,
  Vector3,
} from 'three'
import { Camera }     from './Camera'
import MainScene      from './MainScene'
import Renderer       from './Renderer'
import Player         from './Player'
import Loader         from './Loader'
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh'
import Stats          from 'three/examples/jsm/libs/stats.module.js'
import NPCManager     from './NPCManager'
import { HUD, HUDState } from './HUD'
import { WolfManager }    from './WolfManager'
import { SurvivalSystem }  from './SurvivalSystem'
import { Crosshair }       from './Crosshair'
import { PauseMenu }       from './PauseMenu'

BufferGeometry.prototype.computeBoundsTree = computeBoundsTree
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree
Mesh.prototype.raycast = acceleratedRaycast

// ── Stamina ───────────────────────────────────────────────────────────────
const STAMINA_MAX         = 100
const STAMINA_DRAIN_RUN   = 22
const STAMINA_REGEN_IDLE  = 12
const STAMINA_REGEN_DELAY = 1.8

// ── Player stats ──────────────────────────────────────────────────────────
let playerHealth  = 100
let playerArmor   = 0
let playerStamina = STAMINA_MAX
let playerMoney   = 250
let playerWanted  = 0
let staminaRegenTimer = 0

class Experience {
  camera:      Camera
  mainScene:   MainScene
  renderer:    Renderer
  clock:       Clock
  player:      Player
  loader:      Loader
  npcManager:  NPCManager
  wolfManager:    WolfManager
  survival:       SurvivalSystem
  hud:         HUD
  crosshair:   Crosshair
  pauseMenu:   PauseMenu
  private _isPaused = false
  private _buildKeyPressed = false

  collisionMeshes: Mesh[]  = []   // terreno — colisão vertical
  propMeshes:      Mesh[]  = []   // props — colisão horizontal
  raycaster  = new Raycaster()
  private _sideRaycaster = new Raycaster()  // push-back lateral
  down       = new Vector3(0, -1, 0)
  keysPressed = new Set<string>()

  velocityY  = 0
  gravity    = -18          // mais pesado = mais responsivo, igual GTA
  isOnGround = false
  baseSpeed  = 5.5          // unidades/s — calibrado para o terreno

  // Quaternion alvo do player (suave)
  private _targetQuat = new Quaternion()
  private _up         = new Vector3(0, 1, 0)

  // Impulso acumulado no frame
  private _impulse = new Vector3()

  stats = new Stats()

  constructor() {
    document.body.appendChild(this.stats.dom)
    this.clock = new Clock()

    this.loader     = new Loader()
    this.camera     = new Camera()
    this.mainScene  = new MainScene(this.loader)
    this.renderer   = new Renderer(this.camera, this.mainScene)
    this.player     = new Player(this.loader)
    this.npcManager = new NPCManager(this.loader)
    this.hud        = new HUD()
    this.crosshair  = new Crosshair()
    this.pauseMenu  = new PauseMenu()
    this.wolfManager = new WolfManager(this.mainScene.scene, this.loader)
    this.survival    = new SurvivalSystem(this.mainScene.scene)

    // Terreno procedural — retorna meshes de colisão
    this.collisionMeshes = this.mainScene.buildTerrain()
    // Props sólidos para colisão horizontal
    this.propMeshes      = this.mainScene.propMeshes
    // Registra terreno na câmera para colisão câmera↔terreno
    this.camera.setCollisionMeshes(this.collisionMeshes)

    // Spawna lobos — callbacks de dano e morte
    this.wolfManager.spawnAll(
      (damage) => {
        playerHealth = Math.max(0, playerHealth - damage)
        this.hud.flashDamage()
        this.hud.notify('Ataque!', `Lobo causou ${damage} de dano`, `-${damage}`)
        this.camera.shake(0.2)
        this.player.playHit()   // toca animação de hit no cowboy
      },
      (_pos, _idx) => {
        this.survival.onWolfKilled()
      }
    )
    this.player.position.set(0, 3, 0)
    this.mainScene.scene.add(this.player)
    this.player.setScene(this.mainScene.scene)

    // Radial → arma/desarma o player automaticamente
    this.hud.onItemSelect = (_item, isRanged) => {
      if (isRanged) {
        // Item com munição = arma de fogo → armar
        if (!this.player.states.isArmed) this.player.setArmed(true)
      } else {
        // Item sem munição (laço, faca, escudo…) → desarmar e ocultar arma
        if (this.player.states.isArmed) this.player.setArmed(false)
      }
    }

    // Tecla P continua funcionando e também notifica o HUD
    this.player.onArmedChange = (isArmed) => {
      this.hud.notify(isArmed ? 'Arma equipada' : 'Arma guardada', isArmed ? 'Shotgun pronta' : 'Guardada nas costas')
      this.crosshair.setArmed(isArmed)
      this.camera.setArmed(isArmed)
    }

    // Muzzle flash → pulsa a mira
    this.player.onMuzzleFlash = () => {
      this.crosshair.onFire()
    }

    // Recarga shotgun → anima o ring da mira
    this.player.onReloadStart = (duration) => {
      this.crosshair.startReload(duration)
    }

    // Fornece o aim point ao Player — chamado UMA VEZ por disparo.
    // Usa a posição atual da mira na tela (segue o mouse com clamp radial).
    // Passa apenas terreno + NPCs — não a cena inteira.
    this.player.onAimPointRequest = () => {
      // Inclui terreno + wolves como targets do raycast da mira
      // Os wolf meshes são necessários para a bala apontar diretamente
      // para o NPC quando a mira está sobre ele
      const targets: Object3D[] = [
        ...this.collisionMeshes,
        ...this.wolfManager.collectMeshes(),
      ]
      return this.camera.getAimPoint(
        this.crosshair.aimScreenX,
        this.crosshair.aimScreenY,
        targets
      )
    }

    this.loader.start(() => this.update())
    this._initPointerLock()

    // ── Eventos ───────────────────────────────────────────────────────
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0 && this.player.states.isArmed)
        this.player.isShooting = true
      if (e.button === 2) {
        if (this.player.states.isArmed) {
          // Armado + botão direito = aim mode
          this.camera.setAiming(true)
          this.crosshair.setOrbiting(false)  // mira livre no aim mode
        } else {
          // Desarmado + botão direito = órbita
          this.crosshair.setOrbiting(true)
        }
      }
    })
    window.addEventListener('mouseup', (e) => {
      this.player.isShooting = false
      if (e.button === 2) {
        this.camera.setAiming(false)
        this.crosshair.setOrbiting(false)
      }
    })
    // Bloqueia menu de contexto — segunda camada (Camera.ts já faz isso)
    window.addEventListener('contextmenu', e => e.preventDefault())

    window.addEventListener('keydown', (e) => {
      this.keysPressed.add(e.key.toLowerCase())
      if (e.key.toLowerCase() === 'e') this._buildKeyPressed = true
      // Debug keys
      if (e.key === 'g') { playerMoney  += 200;                       this.hud.notify('Dinheiro',  '+$200 coletado') }
      if (e.key === 'h') { playerHealth  = Math.max(0, playerHealth - 20); this.hud.flashDamage(); this.hud.notify('Dano', 'Você foi atingido!') }
      if (e.key === 'j') { playerArmor   = Math.min(100, playerArmor + 25); this.hud.notify('Colete', 'Armadura +25') }
      if (e.key === 'k') { playerWanted  = Math.min(5, playerWanted + 1);   this.hud.notify('Procurado', `Nível ${playerWanted}`) }
    })
    window.addEventListener('keyup', (e) => this.keysPressed.delete(e.key.toLowerCase()))
  }

  // ── Pointer Lock + Pause ──────────────────────────────────────────────────
  //
  // Pointer Lock captura o cursor dentro do canvas do jogo.
  // ESC do browser solta o lock → pointerlockchange → pausa automática.
  // Menu de pausa tem botão "Continuar" que re-acquires o lock.
  //
  private _initPointerLock() {
    const canvas = this.renderer.renderer.domElement

    // Clique na tela → solicita pointer lock (só quando não pausado)
    canvas.addEventListener('click', () => {
      if (!this._isPaused && !document.pointerLockElement) {
        canvas.requestPointerLock()
      }
    })

    // Mudança de pointer lock
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === canvas) {
        // Lock ativo → retoma o jogo
        this._resume()
      } else {
        // Lock perdido (ESC ou alt-tab) → pausa
        this._pause()
      }
    })

    // PauseMenu "Continuar" → pede o lock de volta
    this.pauseMenu.onResume(() => {
      canvas.requestPointerLock()
    })

    // ESC enquanto pausado → tenta retomar
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this._isPaused) {
        canvas.requestPointerLock()
      }
    })
  }

  private _pause() {
    if (this._isPaused) return
    this._isPaused = true
    this.pauseMenu.show()
    document.body.style.cursor = 'default'
    // Descarta delta acumulado para não ter salto ao retomar
    this.clock.getDelta()
  }

  private _resume() {
    if (!this._isPaused) return
    this._isPaused = false
    this.pauseMenu.hide()
    document.body.style.cursor = 'none'
    // Reseta a mira para o centro ao retomar — evita posição herdada
    this.crosshair.resetToCenter()
    // Descarta delta acumulado durante a pausa
    this.clock.getDelta()
  }

  // ── Física ──────────────────────────────────────────────────────────────
  private applyGravity(delta: number) {
    if (!this.isOnGround) {
      this.velocityY += this.gravity * delta
    } else {
      this.velocityY = Math.max(this.velocityY, 0)
    }
  }

  // ── Colisão vertical (terreno) ─────────────────────────────────────────
  // Ray de cima para baixo a partir de 1.2u acima do player.
  // Busca em range de 3u — cobre quedas rápidas sem perder o hit.
  // Snapping imediato (não lerp) quando penetra o mesh.
  // ── Limite do terreno — respawn ao se aproximar da borda ───────────────
  private readonly TERRAIN_LIMIT = 180   // ±180u do centro (terreno é ±200u)
  private _isFading = false

  private checkBoundary() {
    const p = this.player.position
    const beyond = Math.abs(p.x) > this.TERRAIN_LIMIT
                || Math.abs(p.z) > this.TERRAIN_LIMIT

    if (!beyond || this._isFading) return

    this._isFading = true

    // Fade para preto → teleporta → fade de volta
    const overlay = document.createElement('div')
    Object.assign(overlay.style, {
      position:   'fixed', inset: '0',
      background: '#000',
      opacity:    '0',
      zIndex:     '9998',
      transition: 'opacity 0.5s ease',
      pointerEvents: 'none',
    })
    document.body.appendChild(overlay)

    // Fade in
    requestAnimationFrame(() => { overlay.style.opacity = '1' })

    setTimeout(() => {
      // Teleporta para o centro
      this.player.position.set(0, 3, 0)
      this.velocityY  = 0
      this.isOnGround = false
      // Fade out
      overlay.style.opacity = '0'
      setTimeout(() => {
        overlay.remove()
        this._isFading = false
      }, 500)
    }, 550)
  }

  private checkGround() {
    const PLAYER_HEIGHT = 1.0    // altura do pé ao centro
    const RAY_ORIGIN_Y  = 1.2    // origem do ray acima do pé
    const RAY_RANGE     = 3.0    // distância de busca para baixo

    const origin = this.player.position.clone()
    origin.y += RAY_ORIGIN_Y

    this.raycaster.set(origin, this.down)
    this.raycaster.far = RAY_RANGE + RAY_ORIGIN_Y

    let closest: any = null
    for (const mesh of this.collisionMeshes) {
      const hits = this.raycaster.intersectObject(mesh, true)
      if (hits.length > 0 && (!closest || hits[0].distance < closest.distance)) {
        closest = hits[0]
      }
    }

    if (closest) {
      const surfaceY    = closest.point.y
      const playerFootY = this.player.position.y - PLAYER_HEIGHT / 2
      const penetration = surfaceY - playerFootY   // positivo = player abaixo da superfície

      if (penetration >= -0.15) {
        // Dentro da zona de snap — corrige posição imediatamente
        this.player.position.y = surfaceY + PLAYER_HEIGHT / 2
        this.isOnGround = true
        this.velocityY  = 0
      } else if (penetration > -1.2) {
        // Próximo mas ainda no ar — snap suave
        this.player.position.y = MathUtils.lerp(
          this.player.position.y,
          surfaceY + PLAYER_HEIGHT / 2,
          0.45
        )
        this.isOnGround = true
        this.velocityY  = 0
      } else {
        this.isOnGround = false
      }
    } else {
      this.isOnGround = false
    }
  }

  // ── Colisão horizontal (props: ruínas, cruzes, pedras) ─────────────────
  // Lança 4 rays horizontais nas 4 direções cardeais + diagonal do impulso.
  // Se bater em prop, cancela o componente de velocidade nessa direção.
  private checkHorizontalCollision() {
    if (this._impulse.lengthSq() < 0.00001) return
    if (this.propMeshes.length === 0) return

    const RADIUS   = 0.55    // raio de colisão do player
    const RAY_DIST = RADIUS + 0.1

    const center = this.player.position.clone()
    center.y += 0.8    // altura do tronco (evita hits no chão)

    // Direção do movimento normalizada
    const moveDir = this._impulse.clone().normalize()
    moveDir.y = 0

    // Ray na direção do movimento
    this._sideRaycaster.set(center, moveDir)
    this._sideRaycaster.far = RAY_DIST

    const hits = this._sideRaycaster.intersectObjects(this.propMeshes, true)
    if (hits.length > 0) {
      // Cancela o impulso — player para ao encostar no prop
      this._impulse.set(0, 0, 0)
    }
  }

  // ── Loop principal ──────────────────────────────────────────────────────
  update = () => {
    requestAnimationFrame(this.update)
    if (this._isPaused) return   // loop parado durante a pausa

    this.stats.update()
    this.renderer.update()

    const delta = Math.min(this.clock.getDelta(), 0.05)

    // ── 1. Lê input ────────────────────────────────────────────────────
    const pressW = this.keysPressed.has('w')
    const pressS = this.keysPressed.has('s')
    const pressA = this.keysPressed.has('a')
    const pressD = this.keysPressed.has('d')
    const pressShift = this.keysPressed.has('shift')
    const isMoving   = pressW || pressS || pressA || pressD

    // ── 2. Stamina ─────────────────────────────────────────────────────
    const wantRun = pressW && pressShift
    const canRun  = playerStamina > 5

    if (wantRun && canRun) {
      playerStamina     = Math.max(0, playerStamina - STAMINA_DRAIN_RUN * delta)
      staminaRegenTimer = STAMINA_REGEN_DELAY
    } else {
      if (staminaRegenTimer > 0) staminaRegenTimer -= delta
      else playerStamina = Math.min(STAMINA_MAX, playerStamina + STAMINA_REGEN_IDLE * delta)
    }
    const isRunning = wantRun && canRun

    // ── 3. Eixos da câmera — VIA YAW, nunca via getWorldDirection ─────
    //
    // Esta é a correção central.
    // camera.getForward() e camera.getRight() calculam os vetores
    // diretamente do this.camera.yaw (um número), sem depender de
    // nenhuma matrix que esteja sendo suavizada/lerp-ada.
    // Resultado: zero defasagem entre onde a câmera "aponta" e para
    // onde o player se move.
    //
    const camForward = this.camera.getForward()
    const camRight   = this.camera.getRight()

    // ── 4. Direção de movimento ────────────────────────────────────────
    // S sozinho = anda de costas SEM girar (animação Backward).
    // W/A/D = acumula direção, player gira para onde vai.
    const backwardOnly = pressS && !pressW && !pressA && !pressD

    const moveDir = new Vector3()
    if (pressW) moveDir.add(camForward)
    if (pressA) moveDir.sub(camRight)
    if (pressD) moveDir.add(camRight)

    if (backwardOnly) {
      // Move na direção das costas do player (quaternion atual)
      const playerBack = new Vector3(0, 0, -1).applyQuaternion(this.player.quaternion)
      moveDir.copy(playerBack)
    }

    // Bloqueio de movimento enquanto atira ou está na janela de recarga.
    // isShooting = botão pressionado; reloadTimer > 0 = shotgun cooldown.
    const isBlocked = this.player.isShooting || this.player.reloadTimer > 0

    let moveSpeed = 0
    if (isMoving && moveDir.lengthSq() > 0 && !isBlocked) {
      moveDir.normalize()
      moveSpeed = isRunning ? this.baseSpeed * 2.2 : this.baseSpeed
      this._impulse.copy(moveDir).multiplyScalar(moveSpeed * delta)

      // ── 5. Rotação — movimento WASD ───────────────────────────────────
      // S sozinho NÃO gira — anda de costas.
      // W/A/D giram para a direção de movimento.
      if (!backwardOnly) {
        const targetAngle = Math.atan2(moveDir.x, moveDir.z)
        this._targetQuat.setFromAxisAngle(this._up, targetAngle)
        const turnSpeed = isRunning ? 10 : 14
        this.player.quaternion.slerpQuaternions(
          this.player.quaternion,
          this._targetQuat,
          Math.min(1, turnSpeed * delta)
        )
      }
    } else {
      this._impulse.set(0, 0, 0)

      // ── 5b. Rotação — player sempre acompanha o yaw da câmera ────────
      // Como o mouse sempre rota a câmera, o player também gira
      // suavemente para ficar alinhado com a direção da câmera.
      // Velocidade 6 = responsivo mas sem snap abrupto.
      {
        const camAngle = Math.atan2(camForward.x, camForward.z)
        this._targetQuat.setFromAxisAngle(this._up, camAngle)
        this.player.quaternion.slerpQuaternions(
          this.player.quaternion,
          this._targetQuat,
          Math.min(1, 6 * delta)
        )
      }
    }

    // ── 6. Animações ───────────────────────────────────────────────────
    const armed    = this.player.states.isArmed
    // Quando FireRifle está tocando, Experience.ts não interfere.
    // Player.ts faz a transição de volta para IdleRifle/Idle sozinho.
    const firing   = this.player.currentState === 'FireRifle'

    if (!firing) {
      if (isMoving) {
        if (isRunning) {
          this.player.setState('Running', 1.0)
        } else if (pressS && !pressW && !pressA && !pressD) {
          this.player.setState('Backward', 1.0)
        } else {
          this.player.setState('Walk', 1.0)
        }
      } else {
        this.player.setState(armed ? 'IdleRifle' : 'Idle', 1.0)
      }
    }

    // Tiro é gerenciado inteiramente dentro de Player.update()

    // ── 7. Física (gravidade + colisão) ───────────────────────────────
    this.applyGravity(delta)

    // Colisão horizontal antes de aplicar movimento
    this.checkHorizontalCollision()

    this.player.position.x += this._impulse.x
    this.player.position.z += this._impulse.z
    this.player.position.y += this.velocityY * delta

    this.checkGround()
    this.checkBoundary()

    // ── 8. Câmera — DEPOIS de mover o player ──────────────────────────
    //
    // A câmera usa positionSmoothFactor para seguir o player.
    // O yaw NÃO é suavizado — sempre exato.
    //
    // Wolves: collectMeshes para raycasting de bala + update da IA
    const wolfMeshes = this.wolfManager.collectMeshes()
    this.player.update(delta, wolfMeshes)
    this.wolfManager.update(delta, this.player.position, (_wolfIdx) => {
      playerMoney += 150
      this.hud.notify('Tesouro!', 'Recompensa do lobo', '+$150')
    }, this.camera.perspectiveCamera, this.survival)

    // ── Survival system ────────────────────────────────────────────────
    const isRunningSurvival = this.keysPressed.has('shift') && this.keysPressed.has('w')
    this.survival.update(
      delta,
      this.player.position,
      isRunningSurvival,
      this.player.isShooting,
      this.camera.perspectiveCamera,
      (dmg: number) => {
        playerHealth = Math.max(0, playerHealth - dmg)
        if (playerHealth <= 0) this.hud.notify('💀 Fome!', 'Cace um lobo para sobreviver')
        else if (this.survival.hunger < 20) this.hud.flashDamage()
      },
      this._buildKeyPressed
    )
    this._buildKeyPressed = false

    this.npcManager.update(delta)
    this.mainScene.updateWind(delta)
    // Overshoot da mira → gira a câmera quando mira bate na borda
    // No aim mode a mira segue o mouse com mais precisão
    // (câmera já está perto, FOV menor = mais preciso)
    this.camera.applyOvershoot(
      this.crosshair.currentX,
      this.crosshair.currentY,
      this.crosshair.MAX_RANGE,
      this.crosshair.overshootX,
      this.crosshair.overshootY,
      delta
    )
    this.camera.update(this.player, delta)
    this.crosshair.update(delta)

    // ── 9. HUD ─────────────────────────────────────────────────────────
    const hudState: HUDState = {
      health:        playerHealth,
      maxHealth:     100,
      armor:         playerArmor,
      maxArmor:      100,
      stamina:       playerStamina,
      maxStamina:    STAMINA_MAX,
      money:         playerMoney,
      wantedLevel:   playerWanted,
      activeItemIdx: this.hud.activeItemIdx,
      isShooting:    this.player.isShooting,
      playerX:       this.player.position.x,
      playerZ:       this.player.position.z,
      playerAngle:   this.camera.yaw,
      npcs: this.wolfManager.wolves.map(wolf => ({
        x: wolf.position.x, z: wolf.position.z,
        isAlive: wolf.isAlive, isHostile: true,
      })),
      mission: {
        area:      'Sandy Shores',
        title:     'O Último Trem',
        objective: 'Elimine os bandidos\nna estação ferroviária.',
        progress:  0.4,
      },
    }
    this.hud.update(hudState)
  }
}

new Experience()