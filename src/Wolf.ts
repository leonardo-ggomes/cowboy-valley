/**
 * Wolf.ts — NPC Lobo com FSM completa
 *
 * Estados:
 *  IDLE     → aguardando, toca animação idle
 *  PATROL   → caminha entre waypoints
 *  CHASE    → persegue o player em velocidade rápida
 *  ATTACK   → ataca quando muito perto
 *  HIT      → reação a dano recebido
 *  DEATH    → animação de morte → spawn de tesouro → remove da cena
 *
 * ─────────────────────────────────────────────────────────────────────
 * NOMES DE ANIMAÇÃO — ajuste as constantes abaixo após debugar o GLB
 * ─────────────────────────────────────────────────────────────────────
 */

import {
    AdditiveBlending,
    AnimationAction,
    AnimationClip,
    AnimationMixer,
    BoxGeometry,
    BufferGeometry,
    CapsuleGeometry,
    Color,
    Float32BufferAttribute,
    LoopOnce,
    LoopRepeat,
    Mesh,
    MeshBasicMaterial,
    MeshLambertMaterial,
    Object3D,
    Points,
    PointsMaterial,
    Quaternion,
    Scene,
    ShaderMaterial,
    SphereGeometry,
    Vector3,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { heightAt }   from './MainScene'
import type Loader    from './Loader'

// ─────────────────────────────────────────────────────────────────────────────
// NOMES DE ANIMAÇÃO — TROCAR APÓS DEBUGAR O GLB
// Se uma animação não existir no GLB, o fallback é ignorar sem erro.
// ─────────────────────────────────────────────────────────────────────────────
// Nomes reais extraídos do npc_01.glb (prefixo "greta|")
const ANIM = {
    IDLE:         'greta|idle_mh',
    WALK_START:   'greta|walk_start',
    WALK:         'greta|walk_forward',
    WALK_STOP:    'greta|walk_stop',
    RUN:          'greta|run_forward',
    // Ataque: jump do idle para impacto imediato
    ATTACK_IDLE:  'greta|attack_jump_idle1',
    // Ataque enquanto corre
    ATTACK_RUN:   'greta|attack_jump_run1',
    // Ataque curto frontal (fallback)
    ATTACK_SHORT: 'greta|attack_short_front',
    // Dano recebido — dois lados
    HIT_BACK:     'greta|hurt_back',
    HIT_HEAD:     'greta|hurt_head',
    // Morte — escolhida aleatoriamente para variedade
    DEATH_BACK:   'greta|die_back',
    DEATH_CHEST:  'greta|die_chest',
    DEATH_RUN:    'greta|die_run',
    // Turns usados quando precisa virar antes de atacar
    TURN_LEFT:    'greta|turn_90left',
    TURN_RIGHT:   'greta|turn_90right',
    // Evade (esquiva) — usado ao levar hit enquanto persegue
    EVADE_LEFT:   'greta|evade_left',
    EVADE_RIGHT:  'greta|evade_right',
} as const

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const PATROL_SPEED    = 2.2    // u/s
const CHASE_SPEED     = 6.5    // u/s
const DETECT_RANGE    = 22     // distância para detectar o player
const ATTACK_RANGE    = 2.0    // distância para atacar
const ATTACK_DAMAGE   = 15     // dano por ataque ao player
const ATTACK_COOLDOWN = 1.4    // segundos entre ataques
const PATROL_RADIUS   = 12     // raio dos waypoints de patrulha
const WOLF_HEALTH     = 80

// Shader do tesouro (glow dourado pulsante)
const TREASURE_VERT = /* glsl */`
uniform float uTime;
attribute float aOffset;
varying float vAlpha;
void main() {
    vec3 p = position;
    p.y += sin(uTime * 3.0 + aOffset * 6.28) * 0.3 + uTime * 0.0; 
    vAlpha = 0.4 + 0.4 * sin(uTime * 4.0 + aOffset * 3.14);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = (0.4 + 0.3 * sin(uTime * 5.0 + aOffset)) * (180.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
}
`
const TREASURE_FRAG = /* glsl */`
varying float vAlpha;
void main() {
    float r = length(gl_PointCoord - 0.5);
    if (r > 0.5) discard;
    float soft = 1.0 - smoothstep(0.1, 0.5, r);
    gl_FragColor = vec4(1.0, 0.85, 0.2, soft * vAlpha);
}
`

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS
// ─────────────────────────────────────────────────────────────────────────────
type WolfState = 'idle' | 'patrol' | 'chase' | 'attack' | 'hit' | 'death'

export type WolfCallbacks = {
    onDamagePlayer: (amount: number) => void    // chamado quando ataca o player
    onDeath:        (pos: Vector3)   => void    // chamado ao morrer (spawn tesouro externo)
}

// ─────────────────────────────────────────────────────────────────────────────
// WOLF CLASS
// ─────────────────────────────────────────────────────────────────────────────
export class Wolf extends Object3D {

    health    = WOLF_HEALTH
    isAlive   = true
    meshes:   Mesh[] = []    // meshes filho — usados para raycasting de bala

    private mixer!:         AnimationMixer
    private _modelRoot:    Object3D | null = null
    private _rootBone:     Object3D | null = null  // origin_01 — bone com root motion
    private clips:          Record<string, AnimationAction> = {}
    private currentAction:  AnimationAction | null = null
    private currentState:   WolfState = 'idle'

    private _scene:         Scene | null = null
    private _gltfLoader:   GLTFLoader | null = null
    private _state:         WolfState = 'idle'
    private _stateTimer     = 0
    private _attackTimer    = 0

    // Patrulha
    private _waypoints:     Vector3[] = []
    private _waypointIdx    = 0
    private _origin:        Vector3

    // Quaternion de rotação
    private _targetQuat     = new Quaternion()
    private _up             = new Vector3(0, 1, 0)

    private _cbs:           WolfCallbacks

    // Tesouro
    private _treasureMat:   ShaderMaterial | null = null
    private _treasureTime   = 0
    private _treasureAlive  = false
    private _treasureMesh:  Points | null = null
    private _treasureBox:   Mesh | null = null
    private _treasurePickupRange = 2.5
    private _camera: import('three').Camera | null = null   // para frustum culling manual
    private _isDead     = false    // morto mas aguardando pickup
    private _deadTimer  = 0        // tempo desde a morte

    constructor(scene: Scene, position: Vector3, callbacks: WolfCallbacks, loader?: Loader) {
        super()
        this._scene      = scene
        this._origin     = position.clone()
        this._cbs        = callbacks
        this._gltfLoader = loader?.createGLTFLoader() ?? new GLTFLoader()

        this.position.copy(position)
        this._generateWaypoints()
        this._load()
    }

    // ── Carrega o GLB ─────────────────────────────────────────────────────
    private _load() {
        const loader = this._gltfLoader ?? new GLTFLoader()
        loader.load('/models/npc/npc_1.glb', (gltf) => {
            const model = gltf.scene
            model.scale.set(0.01, 0.01, 0.01)

            model.traverse(child => {
                if ((child as Mesh).isMesh) {
                    const mesh = child as Mesh
                    mesh.castShadow = true
                    // Marca para raycasting de bala
                    mesh.userData.type      = 'npc'
                    mesh.userData.parentNpc = this
                    this.meshes.push(mesh)
                }
            })

            // Alinha o forward visual do mesh com o +Z do Wolf (pai).
            // O GLB tem greta.rotation=-90°X, fazendo o forward do animal
            // ser +X no espaço local do model. O Wolf._lookAt aponta +Z do
            // Wolf para o alvo via atan2. Então rodamos o model +90°Y
            // para que seu +X fique na direção +Z do pai → mesh enfrenta o alvo.
            // Esta rotação é no Object3D do model, não nos bones — o mixer
            // não é afetado.
            model.rotation.y = -Math.PI / 2

            this.add(model)
            this._modelRoot = model
            // Encontra o bone que tem root motion (origin_01)
            // Guardaremos sua posição pré-mixer e restauraremos pós-mixer
            this._rootBone = model.getObjectByName('origin_01') ?? null

            // Mixer — conectado ao model (não ao Wolf Object3D)
            // Usa o model como raiz para que as animações afetem os bones
            // mas NÃO a posição do Wolf em si (evita root motion indesejado)
            this.mixer = new AnimationMixer(model)

            // Registra todos os clipes por nome
            gltf.animations.forEach((clip: AnimationClip) => {
                this.clips[clip.name] = this.mixer.clipAction(clip)
            })

            this._setState('patrol')
        },
        undefined,
        (err) => console.warn('[Wolf] Erro ao carregar npc_1.glb:', err))
    }

    // ── Waypoints de patrulha ─────────────────────────────────────────────
    private _generateWaypoints() {
        const count = 4 + Math.floor(Math.random() * 3)
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5
            const r     = PATROL_RADIUS * (0.5 + Math.random() * 0.5)
                const wx = this._origin.x + Math.cos(angle) * r
            const wz = this._origin.z + Math.sin(angle) * r
            this._waypoints.push(new Vector3(wx, heightAt(wx, wz), wz))
        }
    }

    // ── setState FSM ──────────────────────────────────────────────────────
    private _setState(state: WolfState) {
        if (this._state === state && state !== 'attack') return
        const prev      = this._state
        this._state     = state
        this._stateTimer = 0

        switch (state) {
            case 'idle':
                this._playAnim(ANIM.IDLE)
                break

            case 'patrol':
                // Vai direto para walk_forward — walk_start/stop causavam
                // conflito de blend e efeito de vai-e-vem indesejado
                this._playAnim(ANIM.WALK)
                break

            case 'chase':
                this._playAnim(ANIM.RUN, false, 1.1)
                break

            case 'attack': {
                // Alterna entre jump_idle e short_front para variedade
                const attackAnim = Math.random() < 0.6
                    ? ANIM.ATTACK_IDLE
                    : ANIM.ATTACK_SHORT
                this._playAnim(attackAnim, true, 1.2)

                // Volta ao chase quando a animação de ataque terminar
                // Sem isso o lobo trava no último frame (clampWhenFinished)
                const onFinished = (e: any) => {
                    if (e.action === this.currentAction) {
                        this.mixer.removeEventListener('finished', onFinished)
                        if (this.isAlive && this._state === 'attack') {
                            this._setState('chase')
                        }
                    }
                }
                if (this.mixer) this.mixer.addEventListener('finished', onFinished)
                break
            }

            case 'hit':
                // Alterna hit_back / hit_head
                const hitAnim = Math.random() < 0.5 ? ANIM.HIT_BACK : ANIM.HIT_HEAD
                // Esquiva aleatória ocasional
                if (Math.random() < 0.3) {
                    const evade = Math.random() < 0.5 ? ANIM.EVADE_LEFT : ANIM.EVADE_RIGHT
                    this._playAnim(evade, true, 1.3)
                } else {
                    this._playAnim(hitAnim, true, 1.1)
                }
                break

            case 'death':
                // 3 variações de morte
                const deathAnims = [ANIM.DEATH_BACK, ANIM.DEATH_CHEST, ANIM.DEATH_RUN]
                const deathAnim  = deathAnims[Math.floor(Math.random() * deathAnims.length)]
                this._playAnim(deathAnim, true, 0.9)
                break
        }
    }

    private _playAnim(name: string, once = false, speed = 1.0) {
        if (!this.mixer) return

        const action = this.clips[name] ?? null
        if (!action) {
            console.warn(`[Wolf] Animação não encontrada: "${name}"`)
            return
        }

        // NÃO reinicia animações que já estão rodando (evita reset loop)
        if (this.currentAction === action) {
            // Só atualiza speed se mudou
            if (action.timeScale !== speed) action.timeScale = speed
            return
        }

        if (this.currentAction) this.currentAction.fadeOut(0.2)

        if (once) {
            action.setLoop(LoopOnce, 1)
            action.clampWhenFinished = true
        } else {
            action.setLoop(LoopRepeat, Infinity)
        }

        action.timeScale = speed
        action.reset().fadeIn(0.2).play()
        this.currentAction = action
    }

    // ── Dano recebido ─────────────────────────────────────────────────────
    takeDamage(amount: number) {
        if (!this.isAlive || this._isDead) return

        this.health -= amount
        if (this.health <= 0) {
            this._die()
        } else {
            this._setState('hit')
            // Volta ao chase depois de 0.6s
            setTimeout(() => {
                if (this.isAlive) this._setState('chase')
            }, 600)
        }
    }

    // ── Morte + tesouro ───────────────────────────────────────────────────
    private _die() {
        if (!this.isAlive) return
        this.isAlive  = false
        this._isDead  = true
        this._deadTimer = 0
        this._setState('death')

        // Spawna tesouro logo após a animação de morte
        setTimeout(() => {
            this._spawnTreasure()
            this._cbs.onDeath(this.position.clone())
        }, 2000)
        // NÃO remove da cena aqui — o corpo some só quando:
        // 1. O tesouro foi coletado, E
        // 2. O lobo está fora da visão da câmera
    }

    // ── Tesouro ───────────────────────────────────────────────────────────
    private _spawnTreasure() {
        if (!this._scene) return

        const pos = this.position.clone()
        pos.y += 0.3

        // Partículas douradas
        const COUNT = 80
        const positions = new Float32Array(COUNT * 3)
        const offsets   = new Float32Array(COUNT)
        for (let i = 0; i < COUNT; i++) {
            const angle = Math.random() * Math.PI * 2
            const r     = Math.random() * 0.6
            positions[i * 3]     = pos.x + Math.cos(angle) * r
            positions[i * 3 + 1] = pos.y + Math.random() * 1.2
            positions[i * 3 + 2] = pos.z + Math.sin(angle) * r
            offsets[i]           = Math.random()
        }

        const geo = new BufferGeometry()
        geo.setAttribute('position', new Float32BufferAttribute(positions, 3))
        geo.setAttribute('aOffset',  new Float32BufferAttribute(offsets, 1))

        this._treasureMat = new ShaderMaterial({
            uniforms:       { uTime: { value: 0 } },
            vertexShader:   TREASURE_VERT,
            fragmentShader: TREASURE_FRAG,
            transparent:    true,
            depthWrite:     false,
            blending:       AdditiveBlending,
        })

        this._treasureMesh = new Points(geo, this._treasureMat)
        this._treasureMesh.frustumCulled = false
        this._scene.add(this._treasureMesh)

        // Baú (caixa simples dourada)
        const boxGeo = new BoxGeometry(0.45, 0.3, 0.35)
        const boxMat = new MeshLambertMaterial({ color: 0xc8901a })
        this._treasureBox = new Mesh(boxGeo, boxMat)
        this._treasureBox.position.copy(pos)
        this._treasureBox.castShadow = true
        this._scene.add(this._treasureBox)

        this._treasureAlive = true
    }

    // ── Update principal ──────────────────────────────────────────────────
    update(delta: number, playerPos: Vector3, onPlayerPickup: () => void, camera?: import('three').Camera) {
        if (camera) this._camera = camera
        if (!this.isAlive && !this._treasureAlive && !this._isDead) return

        if (this.mixer) {
            // ── Cancela root motion ─────────────────────────────────────
            // A animação move o bone 'origin_01' em X (FBX space).
            // Capturamos a posição ANTES do update e restauramos DEPOIS,
            // eliminando qualquer translação que o mixer aplicou.
            // O lobo se move via Wolf.position (pai), não via bone.
            const bx = this._rootBone?.position.x ?? 0
            const by = this._rootBone?.position.y ?? 0
            const bz = this._rootBone?.position.z ?? 0

            this.mixer.update(delta)

            if (this._rootBone) {
                this._rootBone.position.x = bx
                this._rootBone.position.y = by
                this._rootBone.position.z = bz
            }
        }

        // ── Snapping ao relevo do terreno ───────────────────────────────
        const terrainY = heightAt(this.position.x, this.position.z)
        this.position.y = terrainY

        // Tesouro
        if (this._treasureAlive) {
            this._treasureTime += delta
            if (this._treasureMat) {
                this._treasureMat.uniforms.uTime.value = this._treasureTime
            }
            // Flutua levemente
            if (this._treasureBox) {
                this._treasureBox.position.y += Math.sin(this._treasureTime * 2) * 0.002
                this._treasureBox.rotation.y += delta * 1.2
            }
            // Pickup — player se aproxima
            if (this._treasureBox) {
                const d = playerPos.distanceTo(this._treasureBox.position)
                if (d < this._treasurePickupRange) {
                    this._collectTreasure()
                    onPlayerPickup()
                }
            }
        }

        // ── Corpo morto aguardando remoção ────────────────────────────────
        if (this._isDead) {
            this._deadTimer += delta
            // Após 30s sem pickup, remove o corpo de qualquer forma
            if (this._deadTimer > 30 && !this._treasureAlive) {
                this._tryRemoveCorpse()
            }
            return
        }
        if (!this.isAlive) return
        this._stateTimer  += delta
        this._attackTimer  = Math.max(0, this._attackTimer - delta)

        const distToPlayer = this.position.distanceTo(playerPos)

        // ── FSM ──────────────────────────────────────────────────────────
        switch (this._state) {

            case 'idle':
                if (distToPlayer < DETECT_RANGE) {
                    this._setState('chase')
                } else if (this._stateTimer > 2.0) {
                    this._setState('patrol')
                }
                break

            case 'patrol':
                if (distToPlayer < DETECT_RANGE) {
                    this._setState('chase')
                    break
                }
                this._moveToward(this._waypoints[this._waypointIdx], PATROL_SPEED, delta)
                if (this.position.distanceTo(this._waypoints[this._waypointIdx]) < 1.0) {
                    this._waypointIdx = (this._waypointIdx + 1) % this._waypoints.length
                }
                break

            case 'chase':
                if (distToPlayer > DETECT_RANGE * 1.4) {
                    this._setState('patrol')
                    break
                }
                if (distToPlayer < ATTACK_RANGE) {
                    this._setState('attack')
                    break
                }
                this._moveToward(playerPos, CHASE_SPEED, delta)
                break

            case 'attack':
                // Olha para o player
                this._lookAt(playerPos, delta)

                if (distToPlayer > ATTACK_RANGE * 1.5) {
                    this._setState('chase')
                    break
                }

                // Aplica dano com cooldown — NÃO chama _setState para não
                // re-disparar a animação e o listener de 'finished'
                if (this._attackTimer <= 0) {
                    this._attackTimer = ATTACK_COOLDOWN
                    this._cbs.onDamagePlayer(ATTACK_DAMAGE)
                }
                break

            case 'hit':
            case 'death':
                // Gerenciados pelo setTimeout acima
                break
        }
    }

    // ── Movimento ─────────────────────────────────────────────────────────
    private _moveToward(target: Vector3, speed: number, delta: number) {
        const dir = target.clone().sub(this.position)
        dir.y = 0
        const dist = dir.length()
        if (dist < 0.1) return

        dir.normalize()
        // Move no plano XZ — Y é corrigido pelo heightAt no update()
        this.position.x += dir.x * speed * delta
        this.position.z += dir.z * speed * delta
        this._lookAt(target, delta)
    }

    private _lookAt(target: Vector3, delta: number) {
        const dir = target.clone().sub(this.position)
        dir.y = 0
        if (dir.lengthSq() < 0.001) return
        dir.normalize()
        const angle = Math.atan2(dir.x, dir.z)
        this._targetQuat.setFromAxisAngle(this._up, angle)
        this.quaternion.slerpQuaternions(this.quaternion, this._targetQuat, Math.min(1, 8 * delta))
    }

    private _collectTreasure() {
        this._treasureAlive = false
        if (this._treasureMesh) {
            this._treasureMesh.removeFromParent()
            this._treasureMesh = null
        }
        if (this._treasureBox) {
            this._treasureBox.removeFromParent()
            this._treasureBox = null
        }
        // Marca para remoção — o corpo só some se estiver fora da câmera
        this._tryRemoveCorpse()
    }

    private _tryRemoveCorpse() {
        if (!this._isDead || this._treasureAlive) return

        // Remove imediatamente se não há câmera
        if (!this._camera) {
            this.parent?.remove(this)
            return
        }

        // Checa se está fora do frustum usando NDC
        const pos = this.position.clone()
        pos.project(this._camera)
        const inView = Math.abs(pos.x) < 1.2 && Math.abs(pos.y) < 1.2 && pos.z < 1

        if (!inView) {
            // Fora da câmera — remove silenciosamente
            this.parent?.remove(this)
        } else {
            // Ainda visível — tenta de novo em 2s
            setTimeout(() => this._tryRemoveCorpse(), 2000)
        }
    }
}

export default Wolf