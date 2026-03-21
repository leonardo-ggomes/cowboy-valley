# 🤠 Dust & Iron — Open World Western Survival

> Um jogo de sobrevivência em mundo aberto no velho oeste, construído inteiramente com Three.js e TypeScript no browser.

---

## Sobre o jogo

Você acorda sozinho num deserto implacável. Lobos cercam o território. A fome não perdoa. Sua única saída é caçar, coletar e construir uma cabana que se torne sua zona segura antes que o deserto te consuma.

**Dust & Iron** é um jogo de sobrevivência 3D no browser — sem instalação, sem servidor, rodando direto no WebGL via Three.js.

---

## Stack técnica

| Tecnologia | Uso |
|---|---|
| [Three.js](https://threejs.org/) | Engine 3D, renderização WebGL |
| TypeScript | Linguagem principal |
| Vite | Build tool e dev server |
| DRACOLoader | Compressão de geometria GLB |
| three-mesh-bvh | Raycasting otimizado (BVH) |
| GLTFLoader | Carregamento de modelos animados |

---

## Instalação e execução

```bash
# Clone o repositório
git clone https://github.com/seu-usuario/dust-and-iron.git
cd dust-and-iron

# Instale as dependências
npm install

# Inicie o servidor de desenvolvimento
npm run dev
```

> O jogo abre em `http://localhost:5173`. Clique na tela para ativar o Pointer Lock e começar.

### Build de produção

```bash
npm run build
npm run preview
```

---

## Como jogar

### Controles

| Tecla / Ação | Função |
|---|---|
| `W A S D` | Movimentar |
| `Shift + W` | Correr |
| `Mouse` | Girar câmera / mover mira |
| `Mouse Direito (segurar)` | Modo mira — zoom de ombro |
| `Clique Esquerdo` | Atirar |
| `P` | Equipar / guardar arma |
| `Tab` | Radial de armas |
| `E` | Construir cabana (quando próximo) |
| `Scroll` | Zoom da câmera |
| `ESC` | Pausar / retomar |

> **Dica:** O jogo usa Pointer Lock — o cursor some e o mouse controla a câmera. Pressione `ESC` para abrir o menu de pausa e devolver o cursor.

---

## Mecânicas de jogo

### 🍖 Fome

A fome drena continuamente. Quando chegar a zero, você começa a perder vida.

| Situação | Drenagem |
|---|---|
| Parado / andando | 1.2 / s |
| Correndo | 3.5 / s |
| Atirando | 2.5 / s |
| Fome zerada | −5 HP / s |

**Como se alimentar:** cada lobo abatido restaura **+35** de fome.

---

### 🐺 Lobos

Os lobos patrulham o deserto e atacam ao detectar o player.

| Parâmetro | Valor |
|---|---|
| Vida | 80 HP |
| Detecção | 22 unidades |
| Velocidade de patrulha | 2.2 u/s |
| Velocidade de perseguição | 6.5 u/s |
| Dano por ataque | 15 HP |
| Drop ao morrer | +35 comida · +1 couro |

**Spawn dinâmico:** o mapa começa com 8 lobos. Quando restarem menos de 3 vivos, reforços surgem ao longe até atingir 6 lobos ativos.

**Estados da IA:**
- `idle` → `patrol` → `chase` → `attack`
- Recebe dano → `hit` → volta ao `chase`
- Vida zerada → `death` → **tesouro** aparece no local

---

### 🏠 Cabana — Zona Segura

A cabana fica em posição fixa no mapa, perto do spawn. Construa-a em 3 estágios para criar sua zona segura.

#### Receitas

| Estágio | Madeira 🪵 | Pedra 🪨 | Couro 🐺 | Resultado |
|---|---|---|---|---|
| 1 — Fundação | 5 | 3 | — | Plataforma de pedra + estacas |
| 2 — Paredes | 10 | 5 | — | 4 paredes com abertura de porta |
| 3 — Telhado | 8 | 4 | 3 | Cabana completa + zona segura |

**Como construir:** aproxime-se da cabana e pressione `E`. O indicador na tela mostra o que falta.

**Zona segura:** quando a cabana estiver completa (estágio 3), lobos param a **12 unidades** da cabana e não entram. Um anel verde no chão indica a fronteira.

---

### 🪵 Recursos

Madeira e pedra estão espalhados pelo mapa como objetos 3D. Passe por cima para coletar automaticamente.

| Recurso | Qtd no mapa | Respawn |
|---|---|---|
| Madeira (troncos) | 18 | 60 s |
| Pedra (rochas) | 14 | 60 s |
| Couro | Drop dos lobos | — |

> Os recursos não têm indicador — faz parte da exploração encontrá-los.

---

### 🔫 Combate

O cowboy carrega uma **shotgun** como arma principal.

| Parâmetro | Valor |
|---|---|
| Pellets por tiro | 5 |
| Velocidade da bala | 220 u/s |
| Cadência | 0.85 s entre tiros |
| Alcance máximo | 150 u |
| Dano por pellet em NPCs | 30 HP |

**Mira:** a mira se move com o mouse dentro de um raio livre. Quando chega na borda do raio, a câmera começa a girar. Segurar o botão direito ativa o modo mira com shoulder offset.

**Efeitos visuais:** tracer de bala (shader GLSL), muzzle flash, smoke trail e efeito de impacto.

---

## Mundo

- **Terreno:** deserto procedural 400×400 unidades com dunas via vertex displacement
- **Limite do mapa:** ±180 u do centro — ao ultrapassar, o player é teleportado de volta com fade
- **Neblina:** `FogExp2` âmbar para criar horizonte de deserto
- **Props:** cactos GLB (3 variantes), pedras irregulares, cruzes de madeira, ruínas de adobe, crânios de boi
- **Areia:** shader de partículas animado via `uTime` no GPU — zero CPU por frame
- **Iluminação:** `HemisphereLight` (céu laranja / chão terra) + `DirectionalLight` solar com shadow map 1024

---

## HUD

| Elemento | Posição | Descrição |
|---|---|---|
| HP + Armadura | Inferior esquerdo | Barras de vida e colete |
| Stamina | Inferior esquerdo | Barra de resistência para corrida |
| Dinheiro | Superior direito | Saldo acumulado |
| Fome | Inferior direito | Barra de sobrevivência |
| Recursos | Inferior direito | Contadores de madeira, pedra, couro |
| Minimap | Inferior esquerdo | Radar com posição dos lobos |
| Mira | Centro | Crosshair dinâmico com ring de recarga |
| Notificações | Inferior esquerdo | Banner deslizante com badge de valor |

---

## Arquitetura do projeto

```
src/
├── Experience.ts       # Loop principal, física, input, integração
├── Camera.ts           # Câmera third-person com shoulder offset e aim mode
├── Player.ts           # Modelo cowboy, animações, pool de balas, shaders
├── Crosshair.ts        # Mira SVG com movimento suave e ring de recarga
├── MainScene.ts        # Cena procedural: terreno, props, areia, luzes
├── Wolf.ts             # NPC lobo com FSM (idle/patrol/chase/attack/hit/death)
├── WolfManager.ts      # Spawn dinâmico, update, zone safe check
├── SurvivalSystem.ts   # Fome, recursos, construção da cabana
├── Cabin.ts            # Modelo 3D da cabana por estágio, zona segura
├── ResourceNode.ts     # Nós de coleta de madeira e pedra
├── HUD.ts              # Interface GTA-style com minimap, radial, notificações
├── Loader.ts           # LoadingManager unificado com tela de loading
├── LoadingScreen.ts    # Tela de carregamento + tela de comandos
├── PauseMenu.ts        # Menu de pausa com ESC / Pointer Lock
└── Renderer.ts         # WebGLRenderer configurado
```

---

## Desenvolvimento

### Ajuste de dificuldade

Os principais parâmetros estão declarados como constantes no topo de cada arquivo:

**`Wolf.ts`**
```typescript
const WOLF_HEALTH     = 80
const DETECT_RANGE    = 22
const ATTACK_DAMAGE   = 15
const ATTACK_COOLDOWN = 1.4
```

**`WolfManager.ts`**
```typescript
const INITIAL_COUNT  = 8    // lobos iniciais
const MIN_ALIVE      = 3    // mínimo antes de spawnar reforços
const TARGET_COUNT   = 6    // alvo após reforço
const SPAWN_COOLDOWN = 5.0  // intervalo de verificação (s)
```

**`SurvivalSystem.ts`**
```typescript
const HUNGER_DRAIN_IDLE  = 1.2   // por segundo parado
const HUNGER_DRAIN_RUN   = 3.5   // por segundo correndo
const HUNGER_DAMAGE_RATE = 5     // dano/s com fome zerada
const FOOD_PER_WOLF      = 35    // comida por lobo
```

**`Cabin.ts`**
```typescript
export const SAFE_ZONE_RADIUS = 12  // raio da zona segura (u)
```

---

## Licença

MIT — sinta-se livre para usar, modificar e distribuir.

---

*Feito com Three.js, TypeScript e muita poeira.*