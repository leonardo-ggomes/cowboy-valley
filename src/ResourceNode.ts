/**
 * ResourceNode.ts
 *
 * Objeto coletável no mapa: Madeira ou Pedra.
 * Aparece como mesh 3D simples. Player coleta ao se aproximar (tecla E).
 * Após coletado desaparece e respawna após RESPAWN_TIME segundos.
 */

import {
    BoxGeometry,
    CylinderGeometry,
    Mesh,
    MeshLambertMaterial,
    Object3D,
    Scene,
    SphereGeometry,
    Vector3,
} from 'three'
import { heightAt } from './MainScene'

export type ResourceType = 'wood' | 'stone'

const PICKUP_RANGE   = 2.5   // distância para coletar (px)
const RESPAWN_TIME   = 60    // segundos para reaparecer
const FLOAT_SPEED    = 1.2   // velocidade de flutuação do ícone
const FLOAT_AMP      = 0.12  // amplitude da flutuação

// Shaders de indicador são CSS — veja _buildIndicator

export class ResourceNode extends Object3D {
    type:      ResourceType
    collected  = false

    private _mesh:       Object3D
    private _timer      = 0
    private _baseY      = 0
    private _floatTime  = 0
    private _scene:     Scene

    constructor(scene: Scene, type: ResourceType, position: Vector3) {
        super()
        this._scene = scene
        this.type   = type

        this.position.copy(position)
        this._baseY = position.y

        this._mesh = type === 'wood' ? this._buildWood() : this._buildStone()
        this.add(this._mesh)
        scene.add(this)
    }

    // ── Meshes ────────────────────────────────────────────────────────────

    private _buildWood(): Object3D {
        const root = new Object3D()

        // Tronco deitado
        const trunkGeo = new CylinderGeometry(0.18, 0.22, 1.4, 7)
        trunkGeo.rotateZ(Math.PI / 2)
        const trunkMat = new MeshLambertMaterial({ color: 0x5a3a18 })
        const trunk    = new Mesh(trunkGeo, trunkMat)
        trunk.castShadow = true
        root.add(trunk)

        // Dois galhos
        const branchGeo = new CylinderGeometry(0.08, 0.1, 0.7, 5)
        const branch1   = new Mesh(branchGeo, trunkMat)
        branch1.position.set(-0.3, 0.3, 0.1)
        branch1.rotation.z = 0.6
        root.add(branch1)

        const branch2 = new Mesh(branchGeo, trunkMat)
        branch2.position.set(0.3, 0.25, -0.1)
        branch2.rotation.z = -0.5
        root.add(branch2)

        root.position.y = 0.15
        return root
    }

    private _buildStone(): Object3D {
        const root = new Object3D()
        const mat  = new MeshLambertMaterial({ color: 0x7a6850 })

        // Rocha principal
        const geo1 = new SphereGeometry(0.35, 5, 4)
        const pos  = geo1.attributes.position
        for (let i = 0; i < pos.count; i++) {
            pos.setX(i, pos.getX(i) + (Math.random() - 0.5) * 0.12)
            pos.setY(i, pos.getY(i) + (Math.random() - 0.5) * 0.08)
            pos.setZ(i, pos.getZ(i) + (Math.random() - 0.5) * 0.12)
        }
        geo1.computeVertexNormals()
        const rock1 = new Mesh(geo1, mat)
        rock1.scale.y = 0.65
        rock1.castShadow = true
        root.add(rock1)

        // Rocha menor ao lado
        const rock2 = new Mesh(new SphereGeometry(0.2, 5, 4), mat)
        rock2.position.set(0.4, -0.05, 0.1)
        rock2.scale.y = 0.6
        root.add(rock2)

        root.position.y = 0.22
        return root
    }

    // ── Update ────────────────────────────────────────────────────────────

    update(delta: number, playerPos: Vector3, onCollect: (type: ResourceType) => void) {
        if (this.collected) {
            this._timer += delta
            this._mesh.visible = false

            if (this._timer >= RESPAWN_TIME) {
                this.collected = false
                this._timer    = 0
                this._mesh.visible = true
            }
            return
        }

        // Flutuação vertical suave
        this._floatTime += delta * FLOAT_SPEED
        this._mesh.position.y = Math.sin(this._floatTime) * FLOAT_AMP

        // Rotação lenta
        this._mesh.rotation.y += delta * 0.4

        // Coleta ao se aproximar
        const dist = playerPos.distanceTo(this.position)
        if (dist < PICKUP_RANGE) {
            this.collected = true
            this._timer    = 0
            this._mesh.visible = false
            onCollect(this.type)
        }
    }

    destroy() {
        this._scene.remove(this)
    }
}

// ── Gera nós de recurso distribuídos pelo mapa ────────────────────────────

export function spawnResourceNodes(scene: Scene, woodCount = 18, stoneCount = 14): ResourceNode[] {
    const nodes: ResourceNode[] = []
    const SPREAD   = 160
    const MIN_DIST = 18   // longe do spawn do player

    const place = (type: ResourceType) => {
        let x: number, z: number, attempts = 0
        do {
            x = (Math.random() - 0.5) * SPREAD
            z = (Math.random() - 0.5) * SPREAD
            attempts++
        } while (Math.sqrt(x*x + z*z) < MIN_DIST && attempts < 30)

        const y = heightAt(x, z)
        nodes.push(new ResourceNode(scene, type, new Vector3(x, y, z)))
    }

    for (let i = 0; i < woodCount;  i++) place('wood')
    for (let i = 0; i < stoneCount; i++) place('stone')

    return nodes
}

export default ResourceNode