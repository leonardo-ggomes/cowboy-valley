import {
  MathUtils,
  Object3D,
  PerspectiveCamera,
  Raycaster,
  Vector2,
  Vector3,
} from 'three'

export class Camera {
  perspectiveCamera: PerspectiveCamera

  yaw   = Math.PI
  pitch = 0.42

  distance    = 7
  minDistance = 3
  maxDistance = 14

  focusOffset = new Vector3(0, 1.9, 0)

  private positionSmoothFactor = 0.15
  private focusSmoothFactor    = 0.18
  private _smoothedFocus       = new Vector3()
  private _focusInitialized    = false

  private shakeAmount = 0
  private shakeDecay  = 10

  private rotationSpeed = 0.004
  isOrbiting = false

  // ── Shoulder offset + Aim mode ─────────────────────────────────────────
  // isArmed: câmera desloca para o ombro direito
  // isAiming (botão direito + armado): zoom in + FOV reduzido + mira precisa
  isArmed  = false
  isAiming = false   // botão direito pressionado COM arma

  // Valores atuais (lerp-ados no update)
  private _shoulderX   = 0      // deslocamento lateral atual

  // Targets
  private readonly SHOULDER_NORMAL = 0.7   // offset lateral quando armado
  private readonly SHOULDER_AIM    = 0.4   // offset menor no aim mode (mais centrado)
  private readonly DIST_NORMAL     = 7     // distância padrão

  private _raycaster    = new Raycaster()
  private _rawMovementX = 0
  private _rawMovementY = 0

  /**
   * Chamado pelo Experience.ts no loop principal com o overshoot do crosshair.
   * Quando a mira está dentro do raio: câmera parada.
   * Quando ultrapassa a borda: câmera gira proporcionalmente ao excesso.
   */
  /**
   * Gira a câmera baseado na posição da mira.
   *
   * @param cx  posição atual da mira relativa ao centro (px)
   * @param cy  posição atual da mira relativa ao centro (px)
   * @param max raio máximo do crosshair (MAX_RANGE)
   * @param ox  overshoot além da borda (excesso)
   * @param oy  overshoot além da borda (excesso)
   * @param delta delta time
   *
   * Modelo de duas zonas:
   *  - Zona morta central (< DEAD_ZONE % do raio): câmera parada
   *  - Zona progressiva: câmera gira proporcionalmente à distância do centro
   *    com aceleração quadrática — suave perto do centro, rápida na borda
   *  - Além da borda (overshoot): câmera gira pelo excesso direto
   */
  applyOvershoot(cx: number, cy: number, max: number, ox: number, oy: number, delta: number) {
    if (this.isOrbiting) return

    const DEAD_ZONE   = 0.55   // zona morta: 55% do raio sem rotação
    const MAX_SPEED   = 0.55   // rad/s máximo na borda do raio
    const OVERSHOOT_S = 0.001  // sensibilidade do excesso além da borda

    // Normaliza posição da mira: 0 no centro, 1 na borda
    const distNorm = Math.sqrt(cx * cx + cy * cy) / max

    if (distNorm > DEAD_ZONE) {
      // Zona progressiva: t vai de 0 (dead zone) até 1 (borda)
      const t = (distNorm - DEAD_ZONE) / (1 - DEAD_ZONE)
      // Aceleração quadrática: suave no começo, rápida na borda
      const speed = MAX_SPEED * t * t

      // Direção normalizada da mira
      const len = Math.sqrt(cx * cx + cy * cy) || 1
      this.yaw   -= (cx / len) * speed * delta
      this.pitch  = MathUtils.clamp(
        this.pitch + (cy / len) * speed * delta,
        -0.35, 1.05
      )
    }

    // Overshoot além da borda (excesso após clamp do crosshair)
    if (Math.abs(ox) > 0.5 || Math.abs(oy) > 0.5) {
      this.yaw   -= ox * OVERSHOOT_S
      this.pitch  = MathUtils.clamp(
        this.pitch + oy * OVERSHOOT_S,
        -0.35, 1.05
      )
    }
  }
  private _camRaycaster = new Raycaster()
  private _collisionMeshes: Object3D[] = []

  setCollisionMeshes(meshes: Object3D[]) {
    this._collisionMeshes = meshes
  }

  constructor() {
    this.perspectiveCamera = new PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      2000
    )
    this._bindEvents()
  }

  private _bindEvents() {
    // Bloqueia menu de contexto em qualquer situação durante o jogo
    document.addEventListener('contextmenu', e => e.preventDefault())

    document.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button === 2) {
        e.preventDefault()
        if (this.isArmed) {
          // Armado: aim mode (zoom in, não orbita)
          this.isAiming  = true
          this.isOrbiting = false
        } else {
          // Desarmado: órbita livre
          this.isOrbiting = true
          this.isAiming   = false
        }
      }
    })
    document.addEventListener('mouseup', (e: MouseEvent) => {
      if (e.button === 2) {
        this.isOrbiting = false
        this.isAiming   = false
      }
    })

    document.addEventListener('mousemove', (e: MouseEvent) => {
      if (!document.pointerLockElement) return
      // Rotação direta pelo mouse — usada quando isOrbiting (botão direito)
      // ou quando o crosshair não está disponível.
      // Caso contrário, a câmera é girada pelo overshoot do crosshair
      // em applyOvershoot(), chamado pelo Experience.ts no loop principal.
      if (this.isOrbiting) {
        this.yaw   -= e.movementX * this.rotationSpeed
        this.pitch  = MathUtils.clamp(
          this.pitch + e.movementY * this.rotationSpeed,
          -0.35, 1.05
        )
      } else {
        // Guarda o movimento bruto para applyOvershoot usar como fallback
        this._rawMovementX = e.movementX
        this._rawMovementY = e.movementY
      }
    })

    document.addEventListener('wheel', (e: WheelEvent) => {
      this.distance = MathUtils.clamp(
        this.distance + e.deltaY * 0.008,
        this.minDistance,
        this.maxDistance
      )
    }, { passive: true })

    window.addEventListener('resize', () => {
      this.perspectiveCamera.aspect = window.innerWidth / window.innerHeight
      this.perspectiveCamera.updateProjectionMatrix()
    })
  }

  setArmed(armed: boolean) {
    this.isArmed = armed
    if (!armed) this.isAiming = false
  }

  setAiming(aiming: boolean) {
    // Aim mode só funciona quando armado
    this.isAiming = aiming && this.isArmed
  }

  getForward(): Vector3 {
    return new Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize()
  }

  getRight(): Vector3 {
    return new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize()
  }

  shake(amount: number) {
    this.shakeAmount = Math.max(this.shakeAmount, amount)
  }

  /**
   * Calcula o ponto 3D para onde a mira aponta.
   *
   * Usa a posição REAL e ATUAL da câmera (após lerp) para o raycast —
   * não a posição desejada. Isso garante que o aim point seja sempre
   * consistente com o que está visível na tela.
   *
   * @param screenX  aimScreenX do Crosshair (px)
   * @param screenY  aimScreenY do Crosshair (px)
   * @param targets  terreno + NPCs — NÃO a cena inteira
   */
  getAimPoint(screenX: number, screenY: number, targets: Object3D[], maxDist = 200): Vector3 {
    // Converte coordenadas de tela para NDC
    const ndcX =  (screenX / window.innerWidth)  * 2 - 1
    const ndcY = -(screenY / window.innerHeight) * 2 + 1

    // Usa a posição ATUAL da câmera (perspectiveCamera.position já foi lerp-ada)
    this._raycaster.setFromCamera(new Vector2(ndcX, ndcY), this.perspectiveCamera)
    this._raycaster.far = maxDist

    // Testa apenas os targets fornecidos (terreno + NPCs)
    const hits = this._raycaster.intersectObjects(targets, true)

    // Ignora hits muito próximos (própria arma/player)
    for (const hit of hits) {
      if (hit.distance > 1.0) return hit.point.clone()
    }

    // Sem hit — ponto a maxDist na direção da mira
    return this._raycaster.ray.origin.clone()
      .addScaledVector(this._raycaster.ray.direction, maxDist)
  }

  update(target: Object3D, delta: number) {
    // ── Lerp shoulder offset ──────────────────────────────────────────────
    // Zoom e FOV desabilitados — só shoulder offset muda entre estados
    const lerpT = 1 - Math.pow(0.01, delta * 5)

    const targetShoulder = this.isArmed ? this.SHOULDER_NORMAL : 0
    this._shoulderX += (targetShoulder - this._shoulderX) * lerpT

    const focusTarget = target.position.clone().add(this.focusOffset)
    if (!this._focusInitialized) {
      this._smoothedFocus.copy(focusTarget)
      this._focusInitialized = true
    }
    this._smoothedFocus.lerp(focusTarget, 1 - Math.pow(1 - this.focusSmoothFactor, delta * 60))

    const sinYaw   = Math.sin(this.yaw)
    const cosYaw   = Math.cos(this.yaw)
    const sinPitch = Math.sin(this.pitch)
    const cosPitch = Math.cos(this.pitch)

    // Vetor right da câmera (perpendicular ao yaw, horizontal)
    const rightX = Math.cos(this.yaw)
    const rightZ = -Math.sin(this.yaw)

    // Focus com shoulder offset — ponto que a câmera mira
    const focusWithShoulder = this._smoothedFocus.clone()
    focusWithShoulder.x += rightX * this._shoulderX
    focusWithShoulder.z += rightZ * this._shoulderX

    const offset = new Vector3(
      sinYaw  * cosPitch * this.distance,
      sinPitch * this.distance,
      cosYaw  * cosPitch * this.distance
    )

    // Posição da câmera também deslocada lateralmente
    let desiredPos = focusWithShoulder.clone().add(offset)

    // Colisão câmera ↔ terreno
    if (this._collisionMeshes.length > 0) {
      const toCamera = desiredPos.clone().sub(this._smoothedFocus)
      const camDist  = toCamera.length()
      const camDir   = toCamera.clone().normalize()

      this._camRaycaster.set(this._smoothedFocus, camDir)
      this._camRaycaster.far = camDist + 0.1

      const hits = this._camRaycaster.intersectObjects(this._collisionMeshes, true)
      if (hits.length > 0) {
        const safeDistance = Math.max(0.5, hits[0].distance - 0.5)
        desiredPos = this._smoothedFocus.clone().addScaledVector(camDir, safeDistance)
      }

      const downRay = new Raycaster(
        desiredPos.clone().add(new Vector3(0, 2, 0)),
        new Vector3(0, -1, 0)
      )
      downRay.far = 6
      const groundHits = downRay.intersectObjects(this._collisionMeshes, true)
      if (groundHits.length > 0) {
        const minY = groundHits[0].point.y + 0.4
        if (desiredPos.y < minY) desiredPos.y = minY
      }
    }

    if (this.shakeAmount > 0.001) {
      desiredPos.x += (Math.random() - 0.5) * this.shakeAmount
      desiredPos.y += (Math.random() - 0.5) * this.shakeAmount
      this.shakeAmount = MathUtils.lerp(this.shakeAmount, 0, this.shakeDecay * delta)
    }

    this.perspectiveCamera.position.lerp(desiredPos, 1 - Math.pow(1 - this.positionSmoothFactor, delta * 60))
    this.perspectiveCamera.lookAt(focusWithShoulder)
  }
}

export default Camera