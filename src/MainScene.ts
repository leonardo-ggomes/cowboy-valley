/**
 * MainScene.ts — Deserto Old West performático
 *
 * Performance first:
 *  - Terreno: MeshLambertMaterial + vertex color (sem MeshStandard, sem shadow map caro)
 *  - Sombra: shadow map 1024, câmera shadow pequena (frustum culling agressivo)
 *  - Areia: ShaderMaterial animado por uTime — zero needsUpdate por frame
 *  - Todos os props (cactos, ruínas, cruzes, pedras) em InstancedMesh
 *  - Y de cada instância calculado pelo mesmo heightFn do terreno — sem flutuação
 *  - Sem estradas (eram planas e flutuavam)
 *  - FogExp2 âmbar suave
 *
 * Visual:
 *  - Terreno com variação de cor por altura via vertex color
 *  - Cacto saguaro com silhueta correta (tronco + braços curvados)
 *  - Cruz de madeira inclinada
 *  - Ruína de adobe (parede com abertura)
 *  - Pedras achatadas e irregulares (não esferas)
 *  - Crânio de boi decorativo (caixa simples com chifres)
 */

import {
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  DirectionalLight,
  DynamicDrawUsage,
  Float32BufferAttribute,
  FogExp2,
  HemisphereLight,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  MeshBasicMaterial,
  Object3D,
  Points,
  Quaternion,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type Loader    from './Loader'

// ─────────────────────────────────────────────────────────────────────────────
// AREIA SHADER — animada por uTime, zero CPU por frame
// ─────────────────────────────────────────────────────────────────────────────
const SAND_VERT = /* glsl */`
uniform float uTime;
attribute float aOffset;   // fase aleatória por partícula
attribute float aSize;     // tamanho base
varying float vAlpha;

void main() {
    vec3 pos = position;

    // Deriva horizontal suave
    pos.x += mod(uTime * 0.8 + aOffset * 40.0, 180.0) - 90.0
           - (position.x + 90.0);
    // Ondulação vertical
    pos.y += sin(uTime * 1.2 + aOffset * 6.28) * 0.4;
    // Pequena oscilação lateral
    pos.z += sin(uTime * 0.7 + aOffset * 3.14) * 0.2;

    vAlpha = 0.12 + 0.18 * sin(uTime * 2.0 + aOffset * 6.28) * 0.5 + 0.5;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = aSize * (160.0 / -mv.z);
    gl_Position  = projectionMatrix * mv;
}
`
const SAND_FRAG = /* glsl */`
varying float vAlpha;
void main() {
    float r = length(gl_PointCoord - 0.5);
    if (r > 0.5) discard;
    float soft = 1.0 - smoothstep(0.2, 0.5, r);
    gl_FragColor = vec4(0.82, 0.62, 0.32, soft * vAlpha);
}
`


// ─────────────────────────────────────────────────────────────────────────────
// POEIRA DO DESERTO — camada rasa sobre o chão, ondulação lenta
// ─────────────────────────────────────────────────────────────────────────────
const DUST_VERT = /* glsl */`
uniform float uTime;
attribute float aOffset;
attribute float aSize;
varying float vAlpha;

void main() {
    vec3 pos = position;

    // Deriva horizontal muito lenta (vento suave)
    float drift = mod(uTime * 0.3 + aOffset * 60.0, 160.0) - 80.0;
    pos.x += drift - (position.x + 80.0);

    // Ondulação vertical rasante — fica colado ao chão
    pos.y += sin(uTime * 0.5 + aOffset * 4.0) * 0.25;

    // Espiral leve
    pos.z += sin(uTime * 0.4 + aOffset * 5.0) * 0.3;

    // Pulsa suavemente
    vAlpha = 0.06 + 0.08 * (sin(uTime * 0.8 + aOffset * 3.14) * 0.5 + 0.5);

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = aSize * (220.0 / -mv.z);
    gl_Position  = projectionMatrix * mv;
}
`
const DUST_FRAG = /* glsl */`
varying float vAlpha;
void main() {
    float r = length(gl_PointCoord - 0.5);
    if (r > 0.5) discard;
    // Borda muito suave — quase invisível nas extremidades
    float soft = 1.0 - smoothstep(0.1, 0.5, r);
    // Tom quente arenoso
    gl_FragColor = vec4(0.78, 0.58, 0.28, soft * vAlpha);
}
`

// ─────────────────────────────────────────────────────────────────────────────
// HEIGHTMAP — função pura, usada tanto pelo terreno quanto pelos props
// Deve ser idêntica ao displacement do buildTerrain
// ─────────────────────────────────────────────────────────────────────────────
export function heightAt(x: number, z: number): number {
    const dist = Math.sqrt(x * x + z * z)
    const flat = Math.min(1, dist / 18)   // plano ao redor da origem
    const h =
        Math.sin(x * 0.07 + z * 0.05) * 1.6 +
        Math.sin(x * 0.03 - z * 0.06) * 2.8 +
        Math.cos(x * 0.11 + z * 0.08) * 0.8 +
        Math.sin(x * 0.05 + z * 0.03 + 1.2) * 1.9 +
        Math.cos(x * 0.14 - z * 0.04) * 0.4
    return h * flat
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASSE
// ─────────────────────────────────────────────────────────────────────────────
export class MainScene {
    scene: Scene
    private _sandMat!:   ShaderMaterial
    private _dustMat!:   ShaderMaterial
    // Meshes de props sólidos — usados pela colisão horizontal do player
    propMeshes: Mesh[] = []

    private _loader: Loader | null = null

    constructor(loader?: Loader) {
        this._loader = loader ?? null
        this.scene = new Scene()
        this.scene.background = new Color(0xb87840)
        // FogExp2: cor quente âmbar, densidade baixa = visibilidade boa mas horizonte queima
        this.scene.fog = new FogExp2(0xc08848, 0.014)

        this._buildLights()
        this._buildSandDust()
        this._buildDust()
    }

    // ── Luzes ─────────────────────────────────────────────────────────────
    private _buildLights() {
        // Hemisphere: céu laranja / chão terra escura
        this.scene.add(new HemisphereLight(0xf5a54a, 0x3a2008, 0.85))

        // Sol — posição baixa, luz amarelo-laranja intensa
        const sun = new DirectionalLight(0xffc060, 2.0)
        sun.position.set(60, 35, -50)
        sun.castShadow = true
        // Shadow map pequeno = mais rápido
        sun.shadow.mapSize.width  = 1024
        sun.shadow.mapSize.height = 1024
        // Frustum apertado = shadow mais nítida e menos fill
        sun.shadow.camera.left   = -50
        sun.shadow.camera.right  =  50
        sun.shadow.camera.top    =  50
        sun.shadow.camera.bottom = -50
        sun.shadow.camera.far    = 200
        sun.shadow.bias          = -0.002
        this.scene.add(sun)

        // Fill muito fraco — sombras permanecem escuras (deserto)
        this.scene.add(new AmbientLight(0x201008, 0.4))
    }

    // ── Terreno ───────────────────────────────────────────────────────────
    buildTerrain(): Mesh[] {
        const SEG = 110   // bom equilíbrio resolução/vértices
        const geo = new BufferGeometry()

        const W = 400, H = 400
        const nx = SEG + 1, nz = SEG + 1
        const positions = new Float32Array(nx * nz * 3)
        const normals   = new Float32Array(nx * nz * 3)
        const colors    = new Float32Array(nx * nz * 3)
        const indices   = []

        // Gera vértices
        for (let iz = 0; iz < nz; iz++) {
            for (let ix = 0; ix < nx; ix++) {
                const x = (ix / SEG - 0.5) * W
                const z = (iz / SEG - 0.5) * H
                const y = heightAt(x, z)
                const idx = iz * nx + ix
                positions[idx * 3]     = x
                positions[idx * 3 + 1] = y
                positions[idx * 3 + 2] = z

                // Vertex color por altura: vales mais escuros, cumes mais claros
                const t = Math.max(0, Math.min(1, (y + 4) / 8))
                // tons de areia: 0x6b3e1a → 0xc89050
                colors[idx * 3]     = 0.42 + t * 0.36   // R
                colors[idx * 3 + 1] = 0.24 + t * 0.24   // G
                colors[idx * 3 + 2] = 0.10 + t * 0.12   // B
            }
        }

        // Normais — calculadas manualmente
        for (let iz = 0; iz < nz; iz++) {
            for (let ix = 0; ix < nx; ix++) {
                const idx = iz * nx + ix
                const x = positions[idx * 3]
                const z = positions[idx * 3 + 2]
                const step = W / SEG
                // Derivada por diferença finita
                const hL = heightAt(x - step, z)
                const hR = heightAt(x + step, z)
                const hD = heightAt(x, z - step)
                const hU = heightAt(x, z + step)
                const n = new Vector3(hL - hR, 2, hD - hU).normalize()
                normals[idx * 3]     = n.x
                normals[idx * 3 + 1] = n.y
                normals[idx * 3 + 2] = n.z
            }
        }

        // Índices
        for (let iz = 0; iz < SEG; iz++) {
            for (let ix = 0; ix < SEG; ix++) {
                const a = iz * nx + ix
                const b = a + 1
                const c = a + nx
                const d = c + 1
                indices.push(a, c, b, b, c, d)
            }
        }

        geo.setAttribute('position', new Float32BufferAttribute(positions, 3))
        geo.setAttribute('normal',   new Float32BufferAttribute(normals,   3))
        geo.setAttribute('color',    new Float32BufferAttribute(colors,    3))
        geo.setIndex(indices)

        const mat = new MeshLambertMaterial({
            vertexColors: true,
        })

        const mesh = new Mesh(geo, mat)
        mesh.receiveShadow = true
        mesh.castShadow    = false
        mesh.name          = 'terrain'
        this.scene.add(mesh)

        // Props — depois do terreno para que heightAt funcione
        // Os InstancedMesh retornados são registrados em propMeshes
        // para a colisão horizontal do player.
        this._buildCactiGLB()
        this._buildRocks()
        this._buildCrosses()
        this._buildRuins()
        this._buildSkulls()

        return [mesh]
    }

    // ── Areia shader ──────────────────────────────────────────────────────
    private _buildSandDust() {
        const COUNT   = 2800
        const SPREAD  = 140

        const positions = new Float32Array(COUNT * 3)
        const offsets   = new Float32Array(COUNT)   // fase aleatória
        const sizes     = new Float32Array(COUNT)

        for (let i = 0; i < COUNT; i++) {
            positions[i * 3]     = (Math.random() - 0.5) * SPREAD
            positions[i * 3 + 1] = Math.random() * 10
            positions[i * 3 + 2] = (Math.random() - 0.5) * SPREAD
            offsets[i]           = Math.random()
            sizes[i]             = 0.15 + Math.random() * 0.55
        }

        const geo = new BufferGeometry()
        geo.setAttribute('position', new Float32BufferAttribute(positions, 3))
        geo.setAttribute('aOffset',  new Float32BufferAttribute(offsets,   1))
        geo.setAttribute('aSize',    new Float32BufferAttribute(sizes,     1))

        this._sandMat = new ShaderMaterial({
            uniforms:       { uTime: { value: 0 } },
            vertexShader:   SAND_VERT,
            fragmentShader: SAND_FRAG,
            transparent:    true,
            depthWrite:     false,
        })

        const pts = new Points(geo, this._sandMat)
        pts.frustumCulled = false
        pts.renderOrder   = 1
        this.scene.add(pts)
    }

    // ── Poeira do deserto — camada rasa de partículas grandes ────────────
    //
    // Efeito separado da areia fina:
    //  - Altura 0–2.5u (rente ao chão)
    //  - Partículas grandes e muito transparentes (névoa de areia)
    //  - Movimento muito lento — vento suave
    //  - Zero CPU: tudo no GPU via uTime
    //
    private _buildDust() {
        const COUNT  = 1200
        const SPREAD = 120

        const positions = new Float32Array(COUNT * 3)
        const offsets   = new Float32Array(COUNT)
        const sizes     = new Float32Array(COUNT)

        for (let i = 0; i < COUNT; i++) {
            positions[i * 3]     = (Math.random() - 0.5) * SPREAD
            positions[i * 3 + 1] = Math.random() * 2.5       // rente ao chão
            positions[i * 3 + 2] = (Math.random() - 0.5) * SPREAD
            offsets[i]           = Math.random()
            sizes[i]             = 1.2 + Math.random() * 2.8  // grandes e difusas
        }

        const geo = new BufferGeometry()
        geo.setAttribute('position', new Float32BufferAttribute(positions, 3))
        geo.setAttribute('aOffset',  new Float32BufferAttribute(offsets,   1))
        geo.setAttribute('aSize',    new Float32BufferAttribute(sizes,     1))

        this._dustMat = new ShaderMaterial({
            uniforms:       { uTime: { value: 0 } },
            vertexShader:   DUST_VERT,
            fragmentShader: DUST_FRAG,
            transparent:    true,
            depthWrite:     false,
        })

        const pts = new Points(geo, this._dustMat)
        pts.frustumCulled = false
        pts.renderOrder   = 2   // renderiza sobre a areia fina
        this.scene.add(pts)
    }

    // ── Cactos GLB — distribuição verdadeiramente aleatória ──────────────
    //
    // Cada posição sorteia um dos 3 modelos ao acaso.
    // Ao carregar, cada modelo só posiciona as instâncias que lhe cabem.
    // Isso garante mistura visual — não blocos geográficos por tipo.
    //
    private _buildCactiGLB() {
        const TOTAL    = 54
        const SPREAD   = 180
        const MIN_DIST = 12
        const loader   = this._loader?.createGLTFLoader() ?? new GLTFLoader()

        type CPos = { x: number; z: number; scale: number; rot: number }

        // Gera todas as posições e sorteia o modelo (1, 2 ou 3) para cada uma
        const buckets: Record<number, CPos[]> = { 1: [], 2: [], 3: [] }

        for (let i = 0; i < TOTAL; i++) {
            let x: number, z: number
            do {
                x = (Math.random() - 0.5) * SPREAD
                z = (Math.random() - 0.5) * SPREAD
            } while (Math.sqrt(x * x + z * z) < MIN_DIST)

            // Sorteia o modelo aleatoriamente
            const model = (Math.floor(Math.random() * 3) + 1) as 1 | 2 | 3
            buckets[model].push({
                x, z,
                scale: 0.7 + Math.random() * 0.9,
                rot:   Math.random() * Math.PI * 2,
            })
        }

        const dummy = new Matrix4()
        const q     = new Quaternion()
        const _up   = new Vector3(0, 1, 0)

        ;([1, 2, 3] as const).forEach(n => {
            const pts = buckets[n]
            if (pts.length === 0) return

            loader.load(`/models/glTF/cactu_${n}.glb`, (gltf) => {
                // Coleta submeshes do modelo
                const meshes: Mesh[] = []
                gltf.scene.traverse(child => {
                    if ((child as Mesh).isMesh) meshes.push(child as Mesh)
                })

                // Um InstancedMesh por submesh — um draw call por material
                meshes.forEach(srcMesh => {
                    const inst = new InstancedMesh(
                        srcMesh.geometry,
                        srcMesh.material,
                        pts.length
                    )
                    inst.castShadow    = true
                    inst.receiveShadow = false

                    pts.forEach((p, i) => {
                        q.setFromAxisAngle(_up, p.rot)
                        dummy.compose(
                            new Vector3(p.x, heightAt(p.x, p.z), p.z),
                            q,
                            new Vector3(p.scale, p.scale, p.scale)
                        )
                        inst.setMatrixAt(i, dummy)
                    })

                    inst.instanceMatrix.needsUpdate = true
                    this.scene.add(inst)
                })
            },
            undefined,
            (err) => console.warn(`cactu_${n}.glb não carregado:`, err))
        })
    }

    // ── Pedras achatadas ─────────────────────────────────────────────────
    private _buildRocks() {
        const COUNT  = 90
        const mat    = new MeshLambertMaterial({ color: 0x7a5c38 })
        // Cubo deformado — mais rock-like que esfera
        const geo    = new BoxGeometry(1, 0.5, 1, 2, 1, 2)
        // Deforma vértices para parecer rocha irregular
        const pos = geo.attributes.position
        for (let i = 0; i < pos.count; i++) {
            pos.setX(i, pos.getX(i) + (Math.random() - 0.5) * 0.3)
            pos.setY(i, pos.getY(i) + (Math.random() - 0.5) * 0.2)
            pos.setZ(i, pos.getZ(i) + (Math.random() - 0.5) * 0.3)
        }
        geo.computeVertexNormals()

        const rocks  = new InstancedMesh(geo, mat, COUNT)
        rocks.castShadow    = true
        rocks.receiveShadow = true

        const dummy = new Matrix4()
        const q     = new Quaternion()
        const _up   = new Vector3(0, 1, 0)

        for (let i = 0; i < COUNT; i++) {
            const x  = (Math.random() - 0.5) * 200
            const z  = (Math.random() - 0.5) * 200
            const y  = heightAt(x, z)
            const sx = 0.4 + Math.random() * 1.4
            const sy = 0.2 + Math.random() * 0.5
            const sz = 0.4 + Math.random() * 1.2
            const rot = Math.random() * Math.PI
            q.setFromAxisAngle(_up, rot)
            dummy.compose(
                new Vector3(x, y + sy * 0.25, z),
                q,
                new Vector3(sx, sy, sz)
            )
            rocks.setMatrixAt(i, dummy)
        }
        rocks.instanceMatrix.needsUpdate = true
        this.scene.add(rocks)
        this.propMeshes.push(rocks as unknown as Mesh)
    }

    // ── Cruzes de madeira ────────────────────────────────────────────────
    private _buildCrosses() {
        const COUNT   = 12
        const matWood = new MeshLambertMaterial({ color: 0x4a3218 })

        // Poste vertical
        const postGeo = new BoxGeometry(0.12, 2.2, 0.12)
        const posts   = new InstancedMesh(postGeo, matWood, COUNT)

        // Travessa horizontal
        const crossGeo = new BoxGeometry(1.1, 0.12, 0.12)
        const crosses  = new InstancedMesh(crossGeo, matWood, COUNT)

        const dummy = new Matrix4()
        const q     = new Quaternion()
        const _up   = new Vector3(0, 1, 0)

        for (let i = 0; i < COUNT; i++) {
            let x: number, z: number
            do {
                x = (Math.random() - 0.5) * 140
                z = (Math.random() - 0.5) * 140
            } while (Math.sqrt(x * x + z * z) < 15)

            const y    = heightAt(x, z)
            const rot  = Math.random() * Math.PI * 2
            // Inclinação leve (desgaste do tempo)
            const tilt = (Math.random() - 0.5) * 0.18
            const qTilt = new Quaternion()
            qTilt.setFromAxisAngle(new Vector3(1, 0, 0), tilt)
            q.setFromAxisAngle(_up, rot).multiply(qTilt)

            dummy.compose(new Vector3(x, y + 1.1, z), q, new Vector3(1, 1, 1))
            posts.setMatrixAt(i, dummy)

            // Travessa: 65% da altura do poste
            dummy.compose(new Vector3(x, y + 1.5, z), q, new Vector3(1, 1, 1))
            crosses.setMatrixAt(i, dummy)
        }

        posts.instanceMatrix.needsUpdate   = true
        crosses.instanceMatrix.needsUpdate = true
        posts.castShadow   = true
        crosses.castShadow = true
        this.scene.add(posts)
        this.scene.add(crosses)
        this.propMeshes.push(posts as unknown as Mesh, crosses as unknown as Mesh)
    }

    // ── Ruínas de adobe ──────────────────────────────────────────────────
    // 2–3 paredes de altura variável, sem teto
    private _buildRuins() {
        const COUNT  = 8
        const mat    = new MeshLambertMaterial({ color: 0x9a7048 })

        // Parede A — larga
        const wallAGeo = new BoxGeometry(4.5, 2.2, 0.5)
        const wallA    = new InstancedMesh(wallAGeo, mat, COUNT)

        // Parede B — lateral curta
        const wallBGeo = new BoxGeometry(0.5, 1.6, 3.0)
        const wallB    = new InstancedMesh(wallBGeo, mat, COUNT)

        // Fragmento caído
        const fragGeo  = new BoxGeometry(1.8, 0.4, 0.5)
        const frags    = new InstancedMesh(fragGeo, mat, COUNT)

        const dummy = new Matrix4()
        const q     = new Quaternion()
        const _up   = new Vector3(0, 1, 0)

        for (let i = 0; i < COUNT; i++) {
            let x: number, z: number
            do {
                x = (Math.random() - 0.5) * 160
                z = (Math.random() - 0.5) * 160
            } while (Math.sqrt(x * x + z * z) < 20)

            const y   = heightAt(x, z)
            const rot = Math.floor(Math.random() * 4) * (Math.PI / 2) + (Math.random() - 0.5) * 0.15
            q.setFromAxisAngle(_up, rot)

            dummy.compose(new Vector3(x, y + 1.1, z), q, new Vector3(1, 1, 1))
            wallA.setMatrixAt(i, dummy)

            dummy.compose(new Vector3(x + 2.2, y + 0.8, z), q, new Vector3(1, 1, 1))
            wallB.setMatrixAt(i, dummy)

            // Fragmento caído perto da parede
            const fx = x - 1.5 + Math.random()
            const fz = z + 0.8 + Math.random() * 0.5
            dummy.compose(new Vector3(fx, heightAt(fx, fz) + 0.2, fz), q, new Vector3(1, 1, 1))
            frags.setMatrixAt(i, dummy)
        }

        ;[wallA, wallB, frags].forEach(m => {
            m.instanceMatrix.needsUpdate = true
            m.castShadow    = true
            m.receiveShadow = true
            this.scene.add(m)
            this.propMeshes.push(m as unknown as Mesh)
        })
    }

    // ── Crânios de boi ───────────────────────────────────────────────────
    private _buildSkulls() {
        const COUNT   = 14
        const matBone = new MeshLambertMaterial({ color: 0xd4c49a })

        // Caixa craniana
        const headGeo  = new BoxGeometry(0.6, 0.4, 0.5)
        const heads    = new InstancedMesh(headGeo, matBone, COUNT)

        // Chifre esq
        const hornGeo  = new ConeGeometry(0.05, 0.7, 5)
        const hornsL   = new InstancedMesh(hornGeo, matBone, COUNT)
        const hornsR   = new InstancedMesh(hornGeo, matBone, COUNT)

        const dummy = new Matrix4()
        const q     = new Quaternion()
        const _up   = new Vector3(0, 1, 0)

        for (let i = 0; i < COUNT; i++) {
            const x   = (Math.random() - 0.5) * 170
            const z   = (Math.random() - 0.5) * 170
            const y   = heightAt(x, z)
            const rot = Math.random() * Math.PI * 2
            q.setFromAxisAngle(_up, rot)

            dummy.compose(new Vector3(x, y + 0.2, z), q, new Vector3(1, 1, 1))
            heads.setMatrixAt(i, dummy)

            // Chifres inclinados para fora
            const qHornL = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1),  0.7)
            const qHornR = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -0.7)

            dummy.compose(new Vector3(x - 0.4, y + 0.45, z), qHornL, new Vector3(1, 1, 1))
            hornsL.setMatrixAt(i, dummy)

            dummy.compose(new Vector3(x + 0.4, y + 0.45, z), qHornR, new Vector3(1, 1, 1))
            hornsR.setMatrixAt(i, dummy)
        }

        ;[heads, hornsL, hornsR].forEach(m => {
            m.instanceMatrix.needsUpdate = true
            m.castShadow = true
            this.scene.add(m)
        })
    }

    // ── updateWind — apenas atualiza o uniform, zero CPU de partículas ────
    updateWind(delta: number) {
        const t = this._sandMat.uniforms.uTime.value + delta
        this._sandMat.uniforms.uTime.value = t
        this._dustMat.uniforms.uTime.value = t
    }
}

export default MainScene