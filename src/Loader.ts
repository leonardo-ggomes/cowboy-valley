import { AnimationClip, LoadingManager } from 'three'
import { DRACOLoader, GLTFLoader } from 'three/examples/jsm/Addons.js'
import { LoadingScreen } from './LoadingScreen'

class Loader {
    manager:          LoadingManager
    dracoLoader:      DRACOLoader
    loader:           GLTFLoader
    globalAnimations: { [key: string]: AnimationClip } = {}

    private _screen: LoadingScreen
    private _allReady = false
    private _readyCallbacks: (() => void)[] = []

    constructor() {
        this.manager    = new LoadingManager()
        this.dracoLoader = new DRACOLoader()
        this.dracoLoader.setDecoderPath('/draco')
        this.loader = new GLTFLoader(this.manager)
        this.loader.setDRACOLoader(this.dracoLoader)

        this._screen = new LoadingScreen()
        this._screen.startMessages()

        this.loadGlobalAnimations()
    }

    createGLTFLoader(): GLTFLoader {
        const l = new GLTFLoader(this.manager)
        l.setDRACOLoader(this.dracoLoader)
        return l
    }

    onAllReady(cb: () => void) {
        if (this._allReady) { cb(); return }
        this._readyCallbacks.push(cb)
    }

    start(callback: () => void) {
        this._screen.onStart(() => {
            this.onAllReady(callback)
        })

        this.manager.onProgress = (_url, loaded, total) => {
            const pct = (loaded / total) * 100
            this._screen.setProgress(pct)
        }

        this.manager.onLoad = () => {
            this._screen.setProgress(100)
            this._allReady = true
            this._readyCallbacks.forEach(cb => cb())
            this._readyCallbacks = []
        }

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
            this.loader.loadAsync('/models/cowboy@hit.glb'),
        ])

        this.globalAnimations = {
            'Walk':      anims[0].animations[1],
            'Backward':  anims[1].animations[4],
            'IdleRifle': anims[2].animations[0],
            'WalkRight': anims[3].animations[2],
            'WalkLeft':  anims[4].animations[1],
            'Running':   anims[5].animations[5],
            'FireRifle': anims[6].animations[1],
            'Hit':       anims[7].animations[0],
        }
    }
}

export default Loader