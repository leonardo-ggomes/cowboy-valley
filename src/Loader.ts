import { AnimationClip, LoadingManager } from 'three'
import { DRACOLoader, GLTFLoader } from 'three/examples/jsm/Addons.js'
import { LoadingScreen } from './LoadingScreen'

class Loader {
    manager:          LoadingManager
    dracoLoader:      DRACOLoader
    loader:           GLTFLoader
    globalAnimations: { [key: string]: AnimationClip } = {}

    private _screen: LoadingScreen

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

    start(callback: () => void) {
        // Registra o callback que será chamado ao clicar em "Iniciar"
        this._screen.onStart(callback)

        // Conecta o LoadingManager à barra de progresso
        this.manager.onProgress = (_url, loaded, total) => {
            const pct = (loaded / total) * 100
            this._screen.setProgress(pct)
        }

        // Quando todos os assets carregarem, passa para 100%
        // (a transição para a tela de comandos é gerenciada por LoadingScreen)
        this.manager.onLoad = () => {
            this._screen.setProgress(100)
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