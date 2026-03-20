/**
 * Cabin.ts — Cabana com 3 estágios de construção
 *
 * Estágio 0: Nada (apenas marcador no chão)
 * Estágio 1: Fundação (plataforma de pedra + estacas de madeira)
 * Estágio 2: Paredes (4 paredes de madeira sem telhado)
 * Estágio 3: Completa (paredes + telhado + porta) → zona segura
 *
 * Receita:
 *   Estágio 1: 5 madeira + 3 pedra
 *   Estágio 2: 10 madeira + 5 pedra
 *   Estágio 3: 8 madeira + 4 pedra + 3 couro
 *
 * Zona segura: raio de SAFE_ZONE_RADIUS — lobos param na borda.
 */

import {
    BoxGeometry,
    CircleGeometry,
    ConeGeometry,
    CylinderGeometry,
    Mesh,
    MeshLambertMaterial,
    MeshBasicMaterial,
    Object3D,
    PlaneGeometry,
    RingGeometry,
    Scene,
    Vector3,
} from 'three'
import { heightAt } from './MainScene'

export const SAFE_ZONE_RADIUS = 12   // lobos não entram nesse raio quando stage=3

export const CABIN_RECIPES = [
    null,                                        // stage 0 → 1
    { wood: 5,  stone: 3, leather: 0 },          // stage 1 → fundação
    { wood: 10, stone: 5, leather: 0 },          // stage 2 → paredes
    { wood: 8,  stone: 4, leather: 3 },          // stage 3 → telhado
]

export interface CabinResources {
    wood:    number
    stone:   number
    leather: number
}

export class Cabin extends Object3D {
    stage     = 0        // 0=nada, 1=fundação, 2=paredes, 3=completa
    position3D: Vector3  // posição fixa no mapa

    private _scene:   Scene
    private _built:   Object3D[] = []   // meshes do estágio atual
    private _marker!: Mesh              // círculo no chão sempre visível
    private _label!:  HTMLDivElement    // indicador HUD

    constructor(scene: Scene, position: Vector3) {
        super()
        this._scene    = scene
        this.position3D = position.clone()
        this.position.copy(position)
        this.position.y = heightAt(position.x, position.z)

        this._buildGroundMarker()
        this._buildLabel()
        scene.add(this)
    }

    // ── Próximo estágio ───────────────────────────────────────────────────

    nextRecipe(): { wood: number; stone: number; leather: number } | null {
        const r = CABIN_RECIPES[this.stage + 1]
        return r ?? null
    }

    canBuild(res: CabinResources): boolean {
        const recipe = this.nextRecipe()
        if (!recipe) return false
        return res.wood >= recipe.wood && res.stone >= recipe.stone && res.leather >= recipe.leather
    }

    build(res: CabinResources): CabinResources | null {
        const recipe = this.nextRecipe()
        if (!recipe || !this.canBuild(res)) return null

        this.stage++
        this._rebuildMeshes()

        return {
            wood:    res.wood    - recipe.wood,
            stone:   res.stone   - recipe.stone,
            leather: res.leather - recipe.leather,
        }
    }

    isComplete(): boolean { return this.stage >= 3 }

    // ── Zona segura — checa se ponto está dentro ──────────────────────────

    isInsideSafeZone(pos: Vector3): boolean {
        if (this.stage < 3) return false
        return pos.distanceTo(this.position) < SAFE_ZONE_RADIUS
    }

    // ── Reconstrói meshes do estágio atual ────────────────────────────────

    private _rebuildMeshes() {
        // Remove meshes anteriores
        this._built.forEach(m => this.remove(m))
        this._built = []

        switch (this.stage) {
            case 1: this._buildFoundation(); break
            case 2: this._buildFoundation(); this._buildWalls(); break
            case 3: this._buildFoundation(); this._buildWalls(); this._buildRoof(); break
        }

        this._updateLabel()
        this._updateMarker()
    }

    // ── Fundação ──────────────────────────────────────────────────────────

    private _buildFoundation() {
        const stoneMat = new MeshLambertMaterial({ color: 0x8a7060 })
        const woodMat  = new MeshLambertMaterial({ color: 0x5a3a18 })

        // Plataforma de pedra
        const platform = new Mesh(new BoxGeometry(6, 0.25, 5), stoneMat)
        platform.position.y = 0.12
        platform.receiveShadow = true
        this.add(platform)
        this._built.push(platform)

        // 4 estacas de madeira nos cantos
        const postGeo = new CylinderGeometry(0.12, 0.15, 1.2, 6)
        const corners = [[-2.7, 0, -2], [2.7, 0, -2], [-2.7, 0, 2], [2.7, 0, 2]] as const
        corners.forEach(([x, , z]) => {
            const post = new Mesh(postGeo, woodMat)
            post.position.set(x, 0.85, z)
            post.castShadow = true
            this.add(post)
            this._built.push(post)
        })
    }

    // ── Paredes ───────────────────────────────────────────────────────────

    private _buildWalls() {
        const woodMat = new MeshLambertMaterial({ color: 0x6b4828 })

        // Parede traseira
        this._addWall(0, 1.4, -2.4, 6, 2.5, 0.2, woodMat)
        // Parede frente com abertura de porta
        this._addWall(-1.8, 1.4, 2.4, 2.2, 2.5, 0.2, woodMat)  // esq
        this._addWall( 1.8, 1.4, 2.4, 2.2, 2.5, 0.2, woodMat)  // dir
        this._addWall( 0,   2.5, 2.4, 1.2, 0.5, 0.2, woodMat)  // acima porta
        // Paredes laterais
        this._addWall(-2.9, 1.4, 0, 0.2, 2.5, 5, woodMat)
        this._addWall( 2.9, 1.4, 0, 0.2, 2.5, 5, woodMat)
    }

    private _addWall(x: number, y: number, z: number, w: number, h: number, d: number, mat: MeshLambertMaterial) {
        const wall = new Mesh(new BoxGeometry(w, h, d), mat)
        wall.position.set(x, y, z)
        wall.castShadow    = true
        wall.receiveShadow = true
        this.add(wall)
        this._built.push(wall)
    }

    // ── Telhado ───────────────────────────────────────────────────────────

    private _buildRoof() {
        const roofMat = new MeshLambertMaterial({ color: 0x3a2810 })
        const darkMat = new MeshLambertMaterial({ color: 0x2a1808 })

        // Duas metades do telhado inclinado
        const roofL = new Mesh(new BoxGeometry(3.6, 0.18, 5.6), roofMat)
        roofL.position.set(-1.5, 3.3, 0)
        roofL.rotation.z = 0.42
        roofL.castShadow = true
        this.add(roofL); this._built.push(roofL)

        const roofR = new Mesh(new BoxGeometry(3.6, 0.18, 5.6), roofMat)
        roofR.position.set(1.5, 3.3, 0)
        roofR.rotation.z = -0.42
        roofR.castShadow = true
        this.add(roofR); this._built.push(roofR)

        // Cumeeira
        const ridge = new Mesh(new BoxGeometry(0.25, 0.25, 5.6), darkMat)
        ridge.position.set(0, 4.0, 0)
        this.add(ridge); this._built.push(ridge)

        // Porta
        const doorMat = new MeshLambertMaterial({ color: 0x3a2208 })
        const door    = new Mesh(new BoxGeometry(1.1, 1.9, 0.1), doorMat)
        door.position.set(0, 1.2, 2.45)
        this.add(door); this._built.push(door)

        // Círculo de zona segura no chão
        this._buildSafeZoneRing()
    }

    // ── Ring de zona segura ───────────────────────────────────────────────

    private _buildSafeZoneRing() {
        const geo = new RingGeometry(SAFE_ZONE_RADIUS - 0.15, SAFE_ZONE_RADIUS, 48)
        geo.rotateX(-Math.PI / 2)
        const mat  = new MeshBasicMaterial({
            color:       0x88ff88,
            transparent: true,
            opacity:     0.18,
            depthWrite:  false,
        })
        const ring = new Mesh(geo, mat)
        ring.position.y = 0.02
        this.add(ring)
        this._built.push(ring)
    }

    // ── Marcador no chão ──────────────────────────────────────────────────

    private _buildGroundMarker() {
        const geo = new RingGeometry(1.8, 2.0, 32)
        geo.rotateX(-Math.PI / 2)
        const mat = new MeshBasicMaterial({
            color:       0xffcc44,
            transparent: true,
            opacity:     0.55,
            depthWrite:  false,
        })
        this._marker = new Mesh(geo, mat)
        this._marker.position.y = 0.05
        this._marker.renderOrder = 1
        this.add(this._marker)
    }

    private _updateMarker() {
        // Esconde marcador quando construção começar
        this._marker.visible = this.stage === 0
    }

    // ── Label HUD ─────────────────────────────────────────────────────────

    private _buildLabel() {
        this._label = document.createElement('div')
        Object.assign(this._label.style, {
            position:      'fixed',
            fontFamily:    "'Barlow Condensed', sans-serif",
            fontSize:      '12px',
            fontWeight:    '600',
            color:         'rgba(255,220,80,0.9)',
            textShadow:    '0 1px 4px rgba(0,0,0,0.9)',
            pointerEvents: 'none',
            zIndex:        '800',
            display:       'none',
            textAlign:     'center',
            letterSpacing: '1px',
        })
        document.body.appendChild(this._label)
        this._updateLabel()
    }

    private _updateLabel() {
        const stages = ['[ E ] Construir Cabana', 'Fundação', 'Paredes', '🏠 Zona Segura']
        this._label.textContent = stages[this.stage] ?? ''
    }

    // ── Update (projeção do label) ────────────────────────────────────────

    update(camera: import('three').Camera) {
        const worldPos = this.position.clone()
        worldPos.y += 3.5
        worldPos.project(camera)

        const inView = Math.abs(worldPos.x) < 1.0 && Math.abs(worldPos.y) < 1.0 && worldPos.z < 1
        if (inView) {
            const sx = ( worldPos.x + 1) / 2 * window.innerWidth
            const sy = (-worldPos.y + 1) / 2 * window.innerHeight
            this._label.style.display  = 'block'
            this._label.style.left     = `${sx - 60}px`
            this._label.style.top      = `${sy}px`
            this._label.style.width    = '120px'
        } else {
            this._label.style.display = 'none'
        }

        // Pulsa o marcador
        if (this.stage === 0 && this._marker) {
            const t = Date.now() * 0.002
            ;(this._marker.material as MeshBasicMaterial).opacity = 0.3 + Math.sin(t) * 0.2
        }
    }

    destroy() {
        this._label.remove()
        this._scene.remove(this)
    }
}

export default Cabin