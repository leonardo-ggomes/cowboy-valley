import {
    CapsuleGeometry,
    Mesh,
    MeshBasicMaterial,
    Object3D,
    AnimationMixer,
    AnimationAction,
    Raycaster,
    Vector3,
    Scene,
    CylinderGeometry,
    LoopRepeat,
    Quaternion,
} from "three";
import Loader from "./Loader";
import NPC from "./NPC";


class Player extends Object3D {
    radius = 0.5;
    capSegments = 10;
    color = "#0000ff";
    height = 2;
    radialSegments = 30;
    loader: Loader;
    model?: Object3D;

    mixer!: AnimationMixer;
    clips: { [key: string]: AnimationAction } = {};
    currentAction: AnimationAction | null = null;
    currentState: string = "";

    collisionMeshes: Mesh[] = [];
    raycaster = new Raycaster();
    down = new Vector3(0, 0, -1);

   
    attackCooldown = 0.15;
    attackTimer = 0;
    isShooting = false;
    states = {
        isArmed: false,
        isAttacking : false
    }

    lastAction = "Idle";
    isLoadedModel: Promise<void>;
    handleObject: Object3D = new Object3D();
    sceneUpdateCallbacks: Set<(delta: number) => void> = new Set();

    // Balas
    activeBullets: { mesh: Mesh, direction: Vector3, distance: number }[] = [];
    bulletSpeed = 50; // unidades por segundo
    bulletMaxDistance = 100;

    constructor(loader: Loader) {
        super();
        this.loader = loader;
        this.isLoadedModel = this.loadModel();
        
        this.setWeapon().then(() => {
            this.placeWeaponAtSpine(true)
        })

        window.addEventListener("keypress", (e) => this.changeStateKeyboard(e))
    }

    async changeStateKeyboard(e: KeyboardEvent){
        const code = e.key.toUpperCase()
        
        if(code === "P"){
            const isArmed = this.states.isArmed
            this.states.isArmed = !isArmed

            if(!isArmed)
            {
                this.placeWeaponAtHand(true)
            }
            else{
                this.placeWeaponAtSpine(true)
            }
           
        }

    }

    async loadModel() {
        return await new Promise<void>((resolve) => {
            this.loader.loader.load("/models/cowboy@model.glb", async (gltf) => {
                const capsule = new Mesh(
                    new CapsuleGeometry(this.radius, this.height, this.capSegments, this.radialSegments),
                    new MeshBasicMaterial({ color: this.color, wireframe: true, visible: false })
                );
                capsule.scale.set(1, 1, 1);
                this.add(capsule);

                this.model = gltf.scene;
                this.model.scale.set(2, 2, 2);
                capsule.position.y = (this.height + 0.3 * this.radius) / 2;
                this.model.position.y = -(this.height * this.radius) / 2;

                this.model.traverse((child) => {
                    if (child instanceof Mesh && child.geometry) {
                        child.geometry.computeBoundsTree();
                        child.material.wireframe = false;
                        this.collisionMeshes.push(child);
                    }
                });

                this.add(this.model);

                // Mixer de animação
                this.mixer = new AnimationMixer(this.model);

                for (let animationKey in this.loader.globalAnimations) {
                    this.clips[animationKey] = this.mixer.clipAction(this.loader.globalAnimations[animationKey]);
                }

                if (gltf.animations.length > 0) {
                    this.clips["Idle"] = this.mixer.clipAction(gltf.animations[0]);
                }

                if (this.clips["Idle"]) {
                    this.setState("Idle", 1.0);
                }

                resolve();
            });
        });
    }

    attack(scene: Scene) {
        if (this.states.isAttacking) return;

        this.states.isAttacking = true;
        const action = this.setState("FireRifle", 1.0);
        if (!action) return;

        action.timeScale = 5.0;
        action.setLoop(LoopRepeat, Infinity);
        action.clampWhenFinished = true;
        action.play();

        if(action.isRunning())
        {
         this.shoot(scene);
        this.attackTimer = 0; // começa o cooldown
        }
     
    }

    shoot(scene: Scene) {
        const bulletGeo = new CylinderGeometry(0.05, 0.05, 0.3, 8);
        const bulletMat = new MeshBasicMaterial({ color: 0xffd700 });
        const bulletMesh = new Mesh(bulletGeo, bulletMat);
        bulletMesh.rotation.x = Math.PI / 2;

        const rifle = this.model?.getObjectByName("rifle");
        if (!rifle) return;

        //  Posição inicial da bala (cano do rifle)
        const muzzleLocal = new Vector3(0, 0, 0.5);
        const muzzleWorld = muzzleLocal.clone();
        rifle.localToWorld(muzzleWorld);
        bulletMesh.position.copy(muzzleWorld);

        //  Direção fixa da bala (para onde o player está olhando no momento do tiro)
        const direction = new Vector3(0, 0, 1); // frente
        const playerQuat = new Quaternion();
        this.getWorldQuaternion(playerQuat); // rotação global do player
        direction.applyQuaternion(playerQuat);
        direction.normalize();

        // Adiciona à cena (independente do player)
        scene.add(bulletMesh);

        // Salva a bala com a direção fixa
        this.activeBullets.push({
            mesh: bulletMesh,
            direction: direction.clone(),
            distance: 0
        });
    }


    
    update(delta: number, npcs?: Mesh[]) {

        // Atualiza cooldown
        if (this.attackTimer > 0) {
            this.attackTimer -= delta;
        }

        // Se o player estiver segurando o tiro e cooldown zerou
        if (this.isShooting && this.attackTimer <= 0) {
            this.shoot(this.parent as Scene); // ou passe a cena como parâmetro do update
            this.attackTimer = this.attackCooldown; // reseta cooldown
        }

        // Atualiza animações
        if (this.mixer) this.mixer.update(delta);

        // Atualiza balas
        if (npcs) {
            for (let i = this.activeBullets.length - 1; i >= 0; i--) {
                const bullet = this.activeBullets[i];

                // Move a bala
                const moveStep = bullet.direction.clone().multiplyScalar(this.bulletSpeed * delta);
                bullet.mesh.position.add(moveStep);
                bullet.distance += moveStep.length();

                // Checa colisão
                this.raycaster.set(bullet.mesh.position, bullet.direction);
                const hits = this.raycaster.intersectObjects(npcs, true);

                if (hits.length > 0 && hits[0].distance < 0.5) {
                    const hit = hits[0];

                    if (hit.object.userData.type === "npc") {
                        const npc = hit.object.userData.parentNpc as NPC;
                        npc.takeDamage(30);
                    }

                    bullet.mesh.removeFromParent();
                    this.activeBullets.splice(i, 1);
                    continue;
                }

                // Remove bala se ultrapassou a distância máxima
                if (bullet.distance > this.bulletMaxDistance) {
                    bullet.mesh.removeFromParent();
                    this.activeBullets.splice(i, 1);
                }
            }
        }
    }

    async setWeapon() {
        return await new Promise<void>((resolve) => {
            this.isLoadedModel.then(async () => {
                let gltf = await this.loader.loader.loadAsync("models/shotgun.glb");
                this.handleObject = gltf.scene;
                this.handleObject.name = "rifle";

                resolve();
            });
        })       
    }

    moveWeaponTo(boneName: string, position: Vector3, rotation: Vector3, visible = true) {
        const bone = this.model?.getObjectByName(boneName);
        if (!bone) return;

        // Remove do parent anterior (se houver)
        if (this.handleObject.parent) {
            this.handleObject.parent.remove(this.handleObject);
        }

        this.handleObject.position.set(0, 0, 0);
        this.handleObject.rotation.set(0, 0, 0);
        this.handleObject.scale.set(0.3, 0.3, 0.3);

        // Adiciona ao novo osso
        bone.attach(this.handleObject);

        // Aplica transformações locais
        this.handleObject.position.copy(position);
        this.handleObject.rotation.set(rotation.x, rotation.y, rotation.z);
        this.handleObject.visible = visible;
    }

    placeWeaponAtHand(visible = true) {
        this.moveWeaponTo(
            "mixamorigRightHand",
            new Vector3(8.2, 0.3, -0.4),
            new Vector3(0.2827, -Math.PI, 1.521),
            visible
        );
    }

    placeWeaponAtSpine(visible = true) {
        this.moveWeaponTo(
            "mixamorigSpine1",
            new Vector3(14.4, -4.1, -21.3),
            new Vector3(0.2073, Math.PI, 0.8230),
            visible
        );
    }

    setState(name: string, speed: number): AnimationAction | null {
        if (this.currentState === name || !this.clips[name]) return null;

        const clip = this.clips[name];
        const newAction = clip;
        newAction.timeScale = speed;

        if (this.currentAction) {
            this.currentAction.fadeOut(0.3);
        }

        newAction.reset().fadeIn(0.3).play();

        this.currentAction = newAction;
        this.currentState = name;

        return newAction;
    }
}

export default Player;
