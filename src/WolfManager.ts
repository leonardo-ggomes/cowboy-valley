/**
 * WolfManager.ts
 *
 * - Spawn inicial de INITIAL_COUNT lobos
 * - Quando vivos < MIN_ALIVE, spawna novos até atingir TARGET_COUNT
 * - Posições aleatórias longe do player (MIN_SPAWN_DIST)
 * - Lobos mortos são removidos do array para não acumular
 */

import { Camera, Mesh, Scene, Vector3 } from 'three'
import { Wolf } from './Wolf'
import type Loader from './Loader'
import { heightAt } from './MainScene'
import type { SurvivalSystem } from './SurvivalSystem'

// ── Config ────────────────────────────────────────────────────────────────
const INITIAL_COUNT  = 8     // lobos ao iniciar
const MIN_ALIVE      = 3     // abaixo desse número, spawna reforços
const TARGET_COUNT   = 6     // quantos spawnar quando MIN_ALIVE for atingido
const MIN_SPAWN_DIST = 25    // distância mínima do player para spawn
const MAX_SPAWN_DIST = 120   // distância máxima do player para spawn
const SPAWN_COOLDOWN = 5.0   // segundos entre verificações de respawn

export class WolfManager {
    wolves: Wolf[] = []
    private _scene:         Scene
    private _loader:        Loader | null = null
    private _onDamage!:     (amount: number) => void
    private _onDeath!:      (pos: Vector3, idx: number) => void
    private _onPickup!:     (idx: number) => void
    private _spawnTimer     = 0
    private _totalSpawned   = 0   // para índice único por lobo

    constructor(scene: Scene, loader?: Loader) {
        this._scene  = scene
        this._loader = loader ?? null
    }

    // ── Spawn inicial ─────────────────────────────────────────────────────
    spawnAll(
        onDamagePlayer: (amount: number) => void,
        onWolfDeath:    (pos: Vector3, wolfIdx: number) => void
    ) {
        this._onDamage = onDamagePlayer
        this._onDeath  = onWolfDeath

        // Posições iniciais distribuídas ao redor do mapa
        const positions: [number, number, number][] = [
            [ 30, 0,  20], [-25, 0,  35], [ 45, 0, -15], [-40, 0, -30],
            [ 20, 0, -50], [-55, 0,  10], [ 60, 0,  40], [-30, 0, -60],
        ]
        positions.forEach(([x, y, z]) => this._spawnWolf(new Vector3(x, y, z)))
    }

    // ── Spawna um lobo em uma posição ─────────────────────────────────────
    private _spawnWolf(pos: Vector3) {
        const idx  = this._totalSpawned++
        pos.y      = heightAt(pos.x, pos.z)

        const wolf = new Wolf(
            this._scene,
            pos,
            {
                onDamagePlayer: this._onDamage,
                onDeath: (p) => this._onDeath(p, idx),
            },
            this._loader ?? undefined
        )
        this._scene.add(wolf)
        this.wolves.push(wolf)
    }

    // ── Gera posição aleatória longe do player ────────────────────────────
    private _randomSpawnPos(playerPos: Vector3): Vector3 {
        let x: number, z: number
        let attempts = 0
        do {
            const angle = Math.random() * Math.PI * 2
            const dist  = MIN_SPAWN_DIST + Math.random() * (MAX_SPAWN_DIST - MIN_SPAWN_DIST)
            x = playerPos.x + Math.cos(angle) * dist
            z = playerPos.z + Math.sin(angle) * dist
            // Mantém dentro dos limites do terreno
            x = Math.max(-170, Math.min(170, x))
            z = Math.max(-170, Math.min(170, z))
            attempts++
        } while (attempts < 20 && Math.sqrt(x*x + z*z) < 10)  // evita origem

        return new Vector3(x, 0, z)
    }

    // ── Update ────────────────────────────────────────────────────────────
    update(delta: number, playerPos: Vector3, onTreasurePickup: (wolfIdx: number) => void, camera?: Camera, survival?: SurvivalSystem) {
        // Remove lobos totalmente finalizados
        this.wolves = this.wolves.filter(w => w.isAlive || w['_treasureAlive'] || w['_isDead'])

        // Atualiza cada lobo — bloqueia na borda da zona segura
        for (let i = this.wolves.length - 1; i >= 0; i--) {
            const wolf = this.wolves[i]
            // Se cabana completa e lobo dentro da zona, empurra para fora
            if (survival?.shouldWolfStop(wolf.position)) {
                wolf['_setState']?.('idle')
                continue
            }
            wolf.update(delta, playerPos, () => onTreasurePickup(i), camera)
        }

        // ── Verifica se precisa de reforços ───────────────────────────────
        this._spawnTimer -= delta
        if (this._spawnTimer > 0) return

        this._spawnTimer = SPAWN_COOLDOWN

        if (this.aliveCount < MIN_ALIVE) {
            const toSpawn = TARGET_COUNT - this.aliveCount
            for (let i = 0; i < toSpawn; i++) {
                const pos = this._randomSpawnPos(playerPos)
                this._spawnWolf(pos)
            }
        }
    }

    // ── Coleta meshes para raycasting ─────────────────────────────────────
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