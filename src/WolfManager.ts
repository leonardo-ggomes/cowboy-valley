/**
 * WolfManager.ts
 *
 * Gerencia todos os lobos na cena:
 *  - Spawn em posições fixas ao redor do mapa
 *  - Update de todos a cada frame
 *  - Coleta de meshes para raycasting de bala
 *  - Callbacks de dano ao player e morte
 */

import { Camera, Mesh, Scene, Vector3 } from 'three'
import { Wolf } from './Wolf'

// Posições de spawn dos lobos no mapa
// Distribuídas para cobrir o deserto sem ficarem muito perto do player (origem)
const SPAWN_POSITIONS: [number, number, number][] = [
    [ 30,  0,  20],
    [-25,  0,  35],
    [ 45,  0, -15],
    [-40,  0, -30],
    [ 20,  0, -50],
    [-55,  0,  10],
    [ 60,  0,  40],
    [-30,  0, -60],
]

export class WolfManager {
    wolves: Wolf[] = []
    private _scene: Scene

    constructor(scene: Scene) {
        this._scene = scene
    }

    // ── Spawna todos os lobos ─────────────────────────────────────────────
    spawnAll(
        onDamagePlayer: (amount: number) => void,
        onWolfDeath:    (pos: Vector3, wolfIdx: number) => void
    ) {
        SPAWN_POSITIONS.forEach(([x, y, z], idx) => {
            const wolf = new Wolf(
                this._scene,
                new Vector3(x, y, z),
                {
                    onDamagePlayer,
                    onDeath: (pos) => onWolfDeath(pos, idx),
                }
            )
            this._scene.add(wolf)
            this.wolves.push(wolf)
        })
    }

    // ── Update de todos os lobos ──────────────────────────────────────────
    update(delta: number, playerPos: Vector3, onTreasurePickup: (wolfIdx: number) => void, camera?: Camera) {
        for (let i = this.wolves.length - 1; i >= 0; i--) {
            const wolf = this.wolves[i]
            wolf.update(delta, playerPos, () => onTreasurePickup(i), camera)
        }
    }

    // ── Coleta meshes para raycasting (balas do player) ───────────────────
    collectMeshes(): Mesh[] {
        const meshes: Mesh[] = []
        for (const wolf of this.wolves) {
            meshes.push(...wolf.meshes)
        }
        return meshes
    }

    // ── Quantidade de lobos vivos ─────────────────────────────────────────
    get aliveCount(): number {
        return this.wolves.filter(w => w.isAlive).length
    }
}

export default WolfManager