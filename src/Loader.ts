import { AnimationClip, LoadingManager } from 'three'
import { DRACOLoader, GLTFLoader } from 'three/examples/jsm/Addons.js'
import { LoadingScreen } from './LoadingScreen'

class Loader {
    manager:          LoadingManager
    dracoLoader:      DRACOLoader
    loader:           GLTFLoader
    globalAnimations: { [key: string]: AnimationClip } = {}

    private _screen: LoadingScreen
    private _allReady = false   // true quando manager.onLoad disparar
    private _readyCallbacks: (() => void)[] = []

    constructor() {
        this.manager    = new LoadingManager()
        this.dracoLoader = new DRACOLoader()
        this.dracoLoader.setDecoderPath('/draco')
        this.loader = new GLTFLoader(this.manager)
        this.loader.setDRACOLoader(this.dracoLoader)

        // Cria a tela de loading imediatamente (bloqueia a tela)
        this._screen = new LoadingScreen()
        this._screen.startMessages()

        this.loadGlobalAnimations()
    }

    // Cria um GLTFLoader vinculado ao mesmo LoadingManager.
    // Usar em vez de 'new GLTFLoader()' para que os assets sejam
    // contabilizados na barra de progresso e no onLoad global.
    createGLTFLoader(): GLTFLoader {
        const l = new GLTFLoader(this.manager)
        l.setDRACOLoader(this.dracoLoader)
        return l
    }

    // Registra um callback para quando TODOS os assets estiverem prontos.
    // Se já estiver pronto, chama imediatamente.
    onAllReady(cb: () => void) {
        if (this._allReady) { cb(); return }
        this._readyCallbacks.push(cb)
    }

    start(callback: () => void) {
        // O botão Iniciar só chama o callback quando todos os assets
        // estiverem prontos — evita T-pose e cena em branco
        this._screen.onStart(() => {
            this.onAllReady(callback)
        })

        // Conecta o LoadingManager à barra de progresso
        this.manager.onProgress = (_url, loaded, total) => {
            const pct = (loaded / total) * 100
            this._screen.setProgress(pct)
        }

        // Quando TODOS os assets carregarem (incluindo cactos, wolves, player)
        // seta progresso 100% e habilita o botão Iniciar
        this.manager.onLoad = () => {
            this._screen.setProgress(100)
            this._allReady = true
            this._readyCallbacks.forEach(cb => cb())
            this._readyCallbacks = []
        }

        // Erro de asset — mostra na mensagem mas não bloqueia
        this.manager.onError = (url) => {
            console.warn('Loader: erro ao carregar', url)
            this._screen.setMessage(`Erro: ${url.split('/').pop()}`)
        }
    }

    async loadGlobalAnimations() {
        const anims = await Promise.all([
            this.loader.loadAsync('/models/cowboy@walking_forward.glb'),
            this.loader.loadAsync('/models/cowboy@walking_backward.glb'),
            this.loader.loadAsync('/models/cowboy@idle_rifle.glb'),
            this.loader.loadAsync('/models/cowboy@walking_right.glb'),
            this.loader.loadAsync('/models/cowboy@walking_left.glb'),
            this.loader.loadAsync('/models/cowboy@running.glb'),
            this.loader.loadAsync('/models/cowboy@fire_rifle.glb'),
        ])

        this.globalAnimations = {
            'Walk':      anims[0].animations[1],
            'Backward':  anims[1].animations[4],
            'IdleRifle': anims[2].animations[0],
            'WalkRight': anims[3].animations[2],
            'WalkLeft':  anims[4].animations[1],
            'Running':   anims[5].animations[5],
            'FireRifle': anims[6].animations[1],
        }
    }
}

export default Loader