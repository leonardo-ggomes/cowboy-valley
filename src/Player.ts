import {
    AdditiveBlending,
    BufferAttribute,
    BufferGeometry,
    CapsuleGeometry,
    Clock,
    CylinderGeometry,
    DynamicDrawUsage,
    Float32BufferAttribute,
    LoopOnce,
    LoopRepeat,
    Mesh,
    MeshBasicMaterial,
    NormalBlending,
    Object3D,
    AnimationMixer,
    AnimationAction,
    PlaneGeometry,
    Points,
    Raycaster,
    Scene,
    ShaderMaterial,
    SphereGeometry,
    Vector3,
    Quaternion,
} from 'three'
import Loader from './Loader'
import NPC    from './NPC'

// ─────────────────────────────────────────────────────────────────────────────
// SHADERS
// ─────────────────────────────────────────────────────────────────────────────

const BULLET_VERT = /* glsl */`
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
const BULLET_FRAG = /* glsl */`
uniform float uTime;
varying vec2  vUv;
void main() {
    float core    = 1.0 - abs(vUv.x - 0.5) * 2.0;
    core          = pow(core, 3.0);
    float trail   = pow(vUv.y, 0.5);
    float flicker = 0.92 + 0.08 * sin(uTime * 80.0);
    float alpha   = core * trail * flicker;
    vec3  tip     = vec3(1.0, 0.96, 0.7);
    vec3  tail    = vec3(1.0, 0.45, 0.05);
    vec3  color   = mix(tail, tip, vUv.y);
    gl_FragColor  = vec4(color * 2.2, alpha);
}
`

const FLASH_VERT = /* glsl */`varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`
const FLASH_FRAG = /* glsl */`
uniform float uLife;
varying vec2  vUv;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5);}
void main(){
    vec2  uv  = vUv - 0.5;
    float r   = length(uv);
    float ang = atan(uv.y, uv.x);
    float ray = 0.5 + 0.5 * sin(ang * 5.0 + hash(vec2(ang,uLife)) * 6.28);
    float a   = (smoothstep(0.5,0.0,r)*0.8 + smoothstep(0.45*ray,0.0,r)*ray*0.6) * uLife;
    vec3  col = mix(vec3(1.0,0.95,0.5), vec3(1.0,0.5,0.1), r * 2.0);
    gl_FragColor = vec4(col * 2.2, a);
}
`

const SMOKE_VERT = /* glsl */`
attribute float aSize;
void main(){
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (180.0 / -mv.z);
    gl_Position  = projectionMatrix * mv;
}
`
const SMOKE_FRAG = /* glsl */`
uniform float uAlpha;
void main(){
    float r = 1.0 - smoothstep(0.3, 0.5, length(gl_PointCoord - 0.5));
    gl_FragColor = vec4(vec3(0.65), r * uAlpha);
}
`

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────────────────────────────────────
const BULLET_POOL_SIZE = 30
const BULLET_SPEED     = 90
const BULLET_MAX_DIST  = 150
const FIRE_COOLDOWN    = 0.85   // shotgun: tempo entre tiros
const RELOAD_ANIM_TIME = 0.75   // duração visual da recarga no HUD
const SMOKE_COUNT      = 200


// ─────────────────────────────────────────────────────────────────────────────
// TIPOS
// ─────────────────────────────────────────────────────────────────────────────
interface Bullet {
    active:    boolean
    mesh:      Mesh
    direction: Vector3
    distance:  number
    mat:       ShaderMaterial
}

interface SmokeParticle {
    active:  boolean
    idx:     number
    pos:     Vector3
    vel:     Vector3
    life:    number
    maxLife: number
    size:    number
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAYER
// ─────────────────────────────────────────────────────────────────────────────
class Player extends Object3D {

    // ── Modelo ────────────────────────────────────────────────────────────
    radius         = 0.5
    capSegments    = 10
    height         = 2
    radialSegments = 30
    loader:  Loader
    model?: Object3D

    // ── Animação ──────────────────────────────────────────────────────────
    mixer!:        AnimationMixer
    clips:         { [key: string]: AnimationAction } = {}
    currentAction: AnimationAction | null = null
    currentState:  string = ''
    isLoadedModel: Promise<void>

    // ── Arma ──────────────────────────────────────────────────────────────
    handleObject: Object3D = new Object3D()
    states = { isArmed: false, isAttacking: false }
    isShooting   = false
    reloadTimer  = 0

    // ── Sincronização animação → bala ─────────────────────────────────────
    // Fluxo:
    //   1. Usuário pressiona botão → _startFireSequence()
    //   2. Animação FireRifle começa (timeScale 1.8)
    //   3. update() monitora action.time / duration
    //   4. Quando >= FIRE_ANIM_THRESHOLD → _doShoot() spawna balas
    //   5. reloadTimer inicia → animação de recarga na mira
    // Aim point capturado no momento do clique
    private _aimPoint = new Vector3()

    // ── Callbacks ─────────────────────────────────────────────────────────
    onArmedChange?:    (isArmed: boolean)  => void
    onReloadStart?:    (duration: number)  => void
    onReloadEnd?:      ()                  => void
    onMuzzleFlash?:    ()                  => void
    // Experience.ts fornece o aim point atual chamando camera.getAimPoint()
    // UMA vez por disparo — não chamar no update()
    onAimPointRequest?: () => Vector3

    // ── Cena ──────────────────────────────────────────────────────────────
    private _scene: Scene | null = null
    private _clock = new Clock()

    // ── Pool de balas ─────────────────────────────────────────────────────
    private bulletPool:    Bullet[] = []
    private activeBullets: Bullet[] = []
    private _bulletGeo:    CylinderGeometry
    private _raycaster     = new Raycaster()
    private _muzzleWorld   = new Vector3()
    private _playerQuat    = new Quaternion()

    // ── Efeitos visuais ───────────────────────────────────────────────────
    private _flashMesh!:  Mesh
    private _flashMat!:   ShaderMaterial
    private _flashLife    = 0

    private _smokeGeo!:   BufferGeometry
    private _smokePoints!:Points
    private _smokeMat!:   ShaderMaterial
    private _smokePool:   SmokeParticle[] = []
    private _smokePos!:   Float32Array
    private _smokeSizes!: Float32Array

    private _impactPool: Mesh[] = []

    // ─────────────────────────────────────────────────────────────────────
    constructor(loader: Loader) {
        super()
        this.loader = loader

        // Geometria da bala orientada em +Z
        this._bulletGeo = new CylinderGeometry(0.025, 0.055, 0.5, 6)
        this._bulletGeo.rotateX(Math.PI / 2)

        this._buildEffects()
        this._buildBulletPool()
        this._buildImpactPool()

        this.isLoadedModel = this._loadModel()
        this._loadWeapon()

        window.addEventListener('keypress', (e) => {
            if (e.key.toUpperCase() === 'P') this.toggleArmed()
        })
    }

    // ── Armar/Desarmar ────────────────────────────────────────────────────
    toggleArmed() { this.setArmed(!this.states.isArmed) }

    setArmed(armed: boolean) {
        this.states.isArmed = armed
        if (armed) {
            this.placeWeaponAtHand(true)
        } else {
            this.placeWeaponAtSpine(true)
            this.isShooting         = false
            this.states.isAttacking = false
        }
        this.onArmedChange?.(armed)
    }

    // ── Modelo ────────────────────────────────────────────────────────────
    private async _loadModel(): Promise<void> {
        return new Promise<void>((resolve) => {
            this.loader.loader.load('/models/cowboy@model.glb', (gltf) => {
                const capsule = new Mesh(
                    new CapsuleGeometry(this.radius, this.height, this.capSegments, this.radialSegments),
                    new MeshBasicMaterial({ visible: false })
                )
                this.add(capsule)
                this.model = gltf.scene
                this.model.scale.set(2, 2, 2)
                capsule.position.y = (this.height + 0.3 * this.radius) / 2
                this.model.position.y = -(this.height * this.radius) / 2
                this.model.traverse((child) => {
                    if (child instanceof Mesh && child.geometry)
                        child.geometry.computeBoundsTree?.()
                })
                this.add(this.model)
                this.mixer = new AnimationMixer(this.model)
                for (const key in this.loader.globalAnimations)
                    this.clips[key] = this.mixer.clipAction(this.loader.globalAnimations[key])
                if (gltf.animations.length > 0)
                    this.clips['Idle'] = this.mixer.clipAction(gltf.animations[0])
                this.setState('Idle', 1.0)
                resolve()
            })
        })
    }

    // ── Arma ──────────────────────────────────────────────────────────────
    private async _loadWeapon() {
        await this.isLoadedModel
        const gltf = await this.loader.loader.loadAsync('models/shotgun.glb')
        this.handleObject = gltf.scene
        this.handleObject.name = 'rifle'
        this.placeWeaponAtSpine(true)
    }

    moveWeaponTo(boneName: string, position: Vector3, rotation: Vector3, visible = true) {
        const bone = this.model?.getObjectByName(boneName)
        if (!bone) return
        if (this.handleObject.parent) this.handleObject.parent.remove(this.handleObject)
        this.handleObject.position.set(0, 0, 0)
        this.handleObject.rotation.set(0, 0, 0)
        this.handleObject.scale.set(0.3, 0.3, 0.3)
        bone.attach(this.handleObject)
        this.handleObject.position.copy(position)
        this.handleObject.rotation.set(rotation.x, rotation.y, rotation.z)
        this.handleObject.visible = visible
    }

    placeWeaponAtHand(v = true) {
        this.moveWeaponTo('mixamorigRightHand',
            new Vector3(8.2, 0.3, -0.4),
            new Vector3(0.2827, -Math.PI, 1.521), v)
    }
    placeWeaponAtSpine(v = true) {
        this.moveWeaponTo('mixamorigSpine1',
            new Vector3(14.4, -4.1, -21.3),
            new Vector3(0.2073, Math.PI, 0.8230), v)
    }

    // ── Efeitos visuais ───────────────────────────────────────────────────
    private _buildEffects() {
        // Flash
        this._flashMat = new ShaderMaterial({
            uniforms:       { uLife: { value: 0 } },
            vertexShader:   FLASH_VERT,
            fragmentShader: FLASH_FRAG,
            transparent: true, depthWrite: false, blending: AdditiveBlending,
        })
        this._flashMesh = new Mesh(new PlaneGeometry(1.0, 1.0), this._flashMat)
        this._flashMesh.visible = false
        this._flashMesh.renderOrder = 10

        // Smoke
        this._smokePos   = new Float32Array(SMOKE_COUNT * 3)
        this._smokeSizes = new Float32Array(SMOKE_COUNT)
        this._smokeGeo   = new BufferGeometry()
        this._smokeGeo.setAttribute('position',
            new Float32BufferAttribute(this._smokePos, 3).setUsage(DynamicDrawUsage))
        this._smokeGeo.setAttribute('aSize',
            new Float32BufferAttribute(this._smokeSizes, 1).setUsage(DynamicDrawUsage))
        this._smokeMat = new ShaderMaterial({
            uniforms:       { uAlpha: { value: 0 } },
            vertexShader:   SMOKE_VERT,
            fragmentShader: SMOKE_FRAG,
            transparent: true, depthWrite: false, blending: NormalBlending,
        })
        this._smokePoints = new Points(this._smokeGeo, this._smokeMat)
        this._smokePoints.frustumCulled = false
        this._smokePoints.renderOrder = 5

        for (let i = 0; i < SMOKE_COUNT; i++) {
            this._smokePos[i * 3 + 1] = -9999
            this._smokePool.push({
                active: false, idx: i,
                pos: new Vector3(), vel: new Vector3(),
                life: 0, maxLife: 1, size: 0,
            })
        }
    }

    private _buildBulletPool() {
        for (let i = 0; i < BULLET_POOL_SIZE; i++) {
            const mat = new ShaderMaterial({
                uniforms:       { uTime: { value: 0 } },
                vertexShader:   BULLET_VERT,
                fragmentShader: BULLET_FRAG,
                transparent: true, depthWrite: false,
                blending: AdditiveBlending, side: 2,
            })
            const mesh = new Mesh(this._bulletGeo, mat)
            mesh.visible = false
            mesh.frustumCulled = false
            mesh.renderOrder = 8
            this.bulletPool.push({ active: false, mesh, mat, direction: new Vector3(), distance: 0 })
        }
    }

    private _buildImpactPool() {
        for (let i = 0; i < 8; i++) {
            const m = new Mesh(
                new SphereGeometry(0.1, 5, 5),
                new MeshBasicMaterial({
                    color: 0xff6600, transparent: true, opacity: 0,
                    depthWrite: false, blending: AdditiveBlending,
                })
            )
            m.visible = false
            m.frustumCulled = false
            this._impactPool.push(m)
        }
    }

    // ── Flash ─────────────────────────────────────────────────────────────
    private _spawnFlash() {
        const rifle = this.model?.getObjectByName('rifle')
        if (rifle) {
            this._muzzleWorld.set(0, 0, 0.8)
            rifle.localToWorld(this._muzzleWorld)
        }
        this._flashMesh.position.copy(this._muzzleWorld)
        // Billboard: aponta para câmera
        this._flashMesh.lookAt(
            this._flashMesh.position.clone().add(
                this._aimPoint.clone().sub(this._muzzleWorld).normalize().negate()
            )
        )
        this._flashMat.uniforms.uLife.value = 1.0
        this._flashMesh.visible = true
        this._flashLife = 1.0
    }

    // ── Fumaça ────────────────────────────────────────────────────────────
    private _spawnSmoke(origin: Vector3, dir: Vector3, count: number) {
        let spawned = 0
        for (const p of this._smokePool) {
            if (p.active) continue
            p.active  = true
            p.life    = 0
            p.maxLife = 0.35 + Math.random() * 0.45
            p.pos.copy(origin)
            p.vel.set(
                dir.x * 0.6 + (Math.random() - 0.5) * 1.2,
                dir.y * 0.6 + Math.random() * 1.8,
                dir.z * 0.6 + (Math.random() - 0.5) * 1.2,
            )
            p.size = 0.25 + Math.random() * 0.5
            if (++spawned >= count) break
        }
    }

    // ── Impacto ───────────────────────────────────────────────────────────
    private _spawnImpact(pos: Vector3) {
        const m = this._impactPool.find(i => !i.visible)
        if (!m || !this._scene) return
        m.position.copy(pos)
        ;(m.material as MeshBasicMaterial).opacity = 1.0
        m.visible = true
        const t0 = performance.now()
        const fade = () => {
            const t = (performance.now() - t0) / 220
            if (t >= 1) { m.visible = false; return }
            ;(m.material as MeshBasicMaterial).opacity = 1 - t
            requestAnimationFrame(fade)
        }
        requestAnimationFrame(fade)
        if (!m.parent) this._scene.add(m)
        this._spawnSmoke(pos, new Vector3(0, 1, 0), 6)
    }

    // ── Sequência de tiro ─────────────────────────────────────────────────
    //
    // 1. Captura aim point UMA VEZ (sem raycast por frame)
    // _startFireSequence: dispara imediatamente + toca animação em paralelo.
    // Sem threshold — a bala sai no instante do clique (padrão AAA).
    // A animação é cosmética; o gameplay não espera por ela.
    private _startFireSequence() {
        // Captura aim point
        this._aimPoint.copy(this.onAimPointRequest?.() ?? new Vector3(0, 0, 500))

        // Spawna balas agora
        this._doShoot()

        // Toca animação FireRifle (não bloqueia nada)
        const action = this.clips['FireRifle']
        if (action) {
            if (this.currentAction && this.currentState !== 'FireRifle')
                this.currentAction.fadeOut(0.08)
            action.reset().fadeIn(0.08).play()
            action.timeScale        = 1.8
            action.setLoop(LoopOnce, 1)
            action.clampWhenFinished = true
            this.currentAction = action
            this.currentState  = 'FireRifle'
        }
    }

    // ── Spawna as balas no momento certo da animação ──────────────────────
    private _doShoot() {
        const scene = this._scene
        if (!scene) return

        // Posição do cano
        const rifle = this.model?.getObjectByName('rifle')
        if (rifle) {
            this._muzzleWorld.set(0, 0, 0.6)
            rifle.localToWorld(this._muzzleWorld)
        } else {
            this.getWorldPosition(this._muzzleWorld)
            this._muzzleWorld.y += 1.4
        }

        // Direção base: do cano para o aim point
        // Isso garante que a bala vai para onde a mira aponta
        const toAim = this._aimPoint.clone().sub(this._muzzleWorld)
        let baseDir: Vector3

        if (toAim.lengthSq() > 0.1) {
            baseDir = toAim.normalize()
        } else {
            // Fallback: forward da câmera via yaw+pitch
            this.getWorldQuaternion(this._playerQuat)
            baseDir = new Vector3(0, 0, 1).applyQuaternion(this._playerQuat).normalize()
        }

        // Shotgun: 5 pellets com spread ortogonal à direção de mira
        const spread = 0.045
        for (let p = 0; p < 5; p++) {
            const bullet = this.bulletPool.find(b => !b.active)
            if (!bullet) break

            const dir = baseDir.clone()

            // Vetores perpendiculares à direção de mira para spread correto
            const up    = Math.abs(dir.y) < 0.99 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)
            const right = new Vector3().crossVectors(dir, up).normalize()
            const upOrt = new Vector3().crossVectors(right, dir).normalize()

            dir.addScaledVector(right, (Math.random() - 0.5) * spread)
            dir.addScaledVector(upOrt, (Math.random() - 0.5) * spread)
            dir.normalize()

            bullet.active    = true
            bullet.distance  = 0
            bullet.direction.copy(dir)
            bullet.mesh.position.copy(this._muzzleWorld)
            bullet.mesh.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), dir)
            bullet.mesh.visible = true
            bullet.mat.uniforms.uTime.value = 0
            if (!bullet.mesh.parent) scene.add(bullet.mesh)
            this.activeBullets.push(bullet)
        }

        this._spawnFlash()
        this._spawnSmoke(this._muzzleWorld.clone(), baseDir, 14)

        this.reloadTimer    = FIRE_COOLDOWN
        this.onReloadStart?.(RELOAD_ANIM_TIME)
        this.onMuzzleFlash?.()
    }

    // ── Update ────────────────────────────────────────────────────────────
    update(delta: number, npcs?: Mesh[]) {
        const elapsed = this._clock.getElapsedTime()
        if (this.mixer) this.mixer.update(delta)

        // Cooldown de recarga
        if (this.reloadTimer > 0) {
            this.reloadTimer -= delta
            if (this.reloadTimer <= 0) {
                this.reloadTimer = 0
                this.onReloadEnd?.()
            }
        }

        // ── Disparo ────────────────────────────────────────────────────
        // Condições: armado + pressionado + cooldown zerado
        if (this.isShooting && this.states.isArmed && this.reloadTimer <= 0) {
            this._startFireSequence()
        }

        // ── Volta ao idle quando para de atirar ────────────────────────
        // Só quando a animação FireRifle terminou (isRunning = false)
        // ou o player soltou o botão e o cooldown zerou.
        if (!this.isShooting && this.currentState === 'FireRifle') {
            const action = this.clips['FireRifle']
            const animDone = !action || !action.isRunning()
            if (animDone || this.reloadTimer <= 0) {
                this.states.isAttacking = false
                this.setState(this.states.isArmed ? 'IdleRifle' : 'Idle', 1.0)
            }
        }

        // ── Flash ──────────────────────────────────────────────────────
        if (this._flashLife > 0) {
            this._flashLife -= delta * 16
            this._flashMat.uniforms.uLife.value = Math.max(0, this._flashLife)
            if (this._flashLife <= 0) this._flashMesh.visible = false
        }

        // ── Balas — sweep test para não perder hits ──────────────────
        const toRemove: Bullet[] = []
        for (const b of this.activeBullets) {
            const stepDist = BULLET_SPEED * delta

            // Sweep: raycasta da posição ANTERIOR até a posição ATUAL
            // Isso evita que a bala "pule" por NPCs entre frames
            const prevPos = b.mesh.position.clone()
            b.mesh.position.addScaledVector(b.direction, stepDist)
            b.distance += stepDist
            b.mat.uniforms.uTime.value = elapsed

            if (npcs && npcs.length > 0) {
                // Origem no frame anterior, far = distância percorrida + margem
                this._raycaster.set(prevPos, b.direction)
                this._raycaster.far = stepDist + 1.5   // margem generosa
                const hits = this._raycaster.intersectObjects(npcs, true)
                if (hits.length > 0) {
                    const hit = hits[0]
                    if (hit.object.userData.type === 'npc') {
                        const npc = hit.object.userData.parentNpc as NPC
                        npc.takeDamage(30)
                    }
                    this._spawnImpact(hit.point)
                    toRemove.push(b)
                    continue
                }
            }
            if (b.distance > BULLET_MAX_DIST) toRemove.push(b)
        }
        for (const b of toRemove) {
            b.active = false
            b.mesh.visible = false
            this.activeBullets.splice(this.activeBullets.indexOf(b), 1)
        }

        // ── Fumaça ─────────────────────────────────────────────────────
        let anySmoke = false
        for (const p of this._smokePool) {
            if (!p.active) continue
            anySmoke = true
            p.life += delta / p.maxLife
            if (p.life >= 1) {
                p.active = false
                this._smokePos[p.idx * 3 + 1] = -9999
                this._smokeSizes[p.idx] = 0
                continue
            }
            p.pos.addScaledVector(p.vel, delta)
            p.vel.y += 0.4 * delta
            this._smokePos[p.idx * 3]     = p.pos.x
            this._smokePos[p.idx * 3 + 1] = p.pos.y
            this._smokePos[p.idx * 3 + 2] = p.pos.z
            this._smokeSizes[p.idx] = p.size * (1 + p.life * 1.8)
        }
        if (anySmoke) {
            (this._smokeGeo.attributes.position as BufferAttribute).needsUpdate = true
            ;(this._smokeGeo.attributes.aSize    as BufferAttribute).needsUpdate = true
            this._smokeMat.uniforms.uAlpha.value = 0.32
        } else {
            this._smokeMat.uniforms.uAlpha.value = 0
        }
    }

    // ── setScene ──────────────────────────────────────────────────────────
    setScene(scene: Scene) {
        this._scene = scene
        scene.add(this._flashMesh)
        scene.add(this._smokePoints)
        for (const b of this.bulletPool) scene.add(b.mesh)
        for (const m of this._impactPool) scene.add(m)
    }

    // ── setState ──────────────────────────────────────────────────────────
    setState(name: string, speed: number): AnimationAction | null {
        if (this.currentState === name || !this.clips[name]) return null
        const action = this.clips[name]
        action.timeScale = speed
        if (this.currentAction) this.currentAction.fadeOut(0.22)
        action.reset().fadeIn(0.22).play()
        this.currentAction = action
        this.currentState  = name
        return action
    }

    attack(_scene: Scene) { /* legado */ }
}

export default Player