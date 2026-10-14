import * as THREE from 'three';
import { Sculpt, sdCapsule, sdEllipsoid, sdRoundBox, sdRoundCone, sdSphere, transform } from '../render/sdf';
import { applySurfaceDetail } from '../render/surfaceDetail';

const SCALE = 1.5;
/** 走る音がこの距離まで届くと起きる */
const WAKE_SPRINT = 7.5;
/** これより近づくと、歩いていても起きる */
const WAKE_TOUCH = 1.7;
const AWAKE_TIME = 4.5;
const RADIUS = 1.05;
const STINK_COUNT = 70;

const WHITE = '#ecebe5';
const RED = '#c4262f';
const SOLE = '#9a958b';
const GREEN = '#4f9a3c';
const GREEN_DARK = '#2f6a26';

/** 上履きの胴体 + 背中のトゲ + しっぽ(原点 = 地面、つま先 = +z) */
function sculptShoeBody(): THREE.BufferGeometry {
  const s = new Sculpt().roughen(0.006, 8);
  s.add(sdRoundBox([0, 0.24, 0], [0.32, 0.2, 0.75], 0.17), WHITE);
  s.add(sdRoundBox([0, 0.22, 0.58], [0.335, 0.17, 0.24], 0.15), RED, 0.03);
  s.add(sdRoundBox([0, 0.035, 0], [0.34, 0.035, 0.78], 0.03), SOLE, 0.02);
  // 履き口(中は暗い)
  s.carve(sdEllipsoid([0, 0.46, -0.28], [0.22, 0.12, 0.36]), '#1c1714', 0.04);
  // 背中のトゲ(かかと側に3本)
  for (let i = 0; i < 3; i += 1) {
    const z = -0.45 - i * 0.12;
    s.add(sdRoundCone([0, 0.4, z], [0, 0.62 - i * 0.05, z - 0.06], 0.06, 0.008), GREEN, 0.03);
  }
  // 小さな羽
  for (const side of [-1, 1]) {
    s.add(transform(sdEllipsoid([0, 0, 0], [0.04, 0.16, 0.24]), { at: [side * 0.33, 0.42, -0.1], rotate: [0.4, 0, side * -0.7] }), GREEN_DARK, 0.03);
  }
  // しっぽ(かかとから伸びて丸まる)
  s.add(sdRoundCone([0, 0.2, -0.75], [0.35, 0.12, -1.15], 0.13, 0.07), GREEN, 0.06);
  s.add(sdRoundCone([0.35, 0.12, -1.15], [0.7, 0.08, -0.95], 0.07, 0.02), GREEN, 0.04);
  return s.mesh([-0.55, -0.05, -1.35], [0.95, 0.85, 1.0], 0.02);
}

/** 首と頭(原点 = 履き口の付け根)。眠っているときはつま先の上に頭を乗せる。 */
function sculptHead(): THREE.BufferGeometry {
  const s = new Sculpt().roughen(0.004, 10);
  s.add(sdCapsule([0, 0, 0], [0, 0.2, 0.25], 0.11), GREEN);
  s.add(sdRoundBox([0, 0.24, 0.42], [0.15, 0.12, 0.2], 0.09), GREEN, 0.07);
  s.add(sdRoundBox([0, 0.2, 0.66], [0.11, 0.07, 0.13], 0.06), GREEN, 0.05);
  for (const side of [-1, 1]) {
    s.add(sdRoundCone([side * 0.09, 0.32, 0.32], [side * 0.14, 0.5, 0.2], 0.035, 0.006), '#e8dcb0', 0.02);
    s.add(sdSphere([side * 0.05, 0.25, 0.79], 0.02), '#1c1714', 0.005);
  }
  return s.mesh([-0.3, -0.15, -0.15], [0.3, 0.6, 0.9], 0.016);
}

function zTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create Z texture.');
  context.fillStyle = '#cfe7ff';
  context.font = 'bold 52px "Hiragino Maru Gothic ProN", "Hiragino Sans", sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('Z', 32, 34);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * うわばき・ドラゴンチーノ。理科準備室の入口で眠っている竜。
 * 近くで走ったり、ぶつかるほど近づいたりすると目を覚まし、くさい息を吐いて吠える
 * (ガブガブーノが駆けつける)。そっと歩けば起きない。
 */
export class Dragontino {
  readonly group = new THREE.Group();
  awake = 0;
  private readonly neck = new THREE.Group();
  private readonly eyeMaterial: THREE.MeshStandardMaterial;
  private readonly snoreZ: THREE.Sprite[] = [];
  private readonly stink: THREE.Points;
  private readonly stinkVelocity = new Float32Array(STINK_COUNT * 3);
  private stinkAge = 99;
  private readonly disposables: { dispose(): void }[] = [];
  private cooldown = 0;
  private snoreTimer = 0;
  private breath = 0;

  constructor(
    position: THREE.Vector3,
    yaw: number,
    private readonly events: { onWake(at: THREE.Vector3): void; onSnore(at: THREE.Vector3): void },
  ) {
    const bodyGeometry = sculptShoeBody();
    const headGeometry = sculptHead();
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
    applySurfaceDetail(material, { scale: 40, strength: 0.18 }).setRim(0.05, '#d9ffcf');
    this.eyeMaterial = new THREE.MeshStandardMaterial({ color: '#1c1714', emissive: '#7dff4a', emissiveIntensity: 0 });
    const eyeGeometry = new THREE.SphereGeometry(0.045, 12, 8);
    this.disposables.push(bodyGeometry, headGeometry, material, this.eyeMaterial, eyeGeometry);

    const root = new THREE.Group();
    root.scale.setScalar(SCALE);
    const body = new THREE.Mesh(bodyGeometry, material);
    body.castShadow = true;
    body.receiveShadow = true;
    root.add(body);
    this.neck.position.set(0, 0.42, -0.2);
    const head = new THREE.Mesh(headGeometry, material);
    head.castShadow = true;
    this.neck.add(head);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeometry, this.eyeMaterial);
      eye.scale.set(1, 0.35, 1);
      eye.position.set(side * 0.12, 0.3, 0.52);
      this.neck.add(eye);
    }
    root.add(this.neck);
    this.group.add(root);

    // いびきの「Z」
    const zMap = zTexture();
    this.disposables.push(zMap);
    for (let i = 0; i < 3; i += 1) {
      const material = new THREE.SpriteMaterial({ map: zMap, transparent: true, depthWrite: false });
      this.disposables.push(material);
      const sprite = new THREE.Sprite(material);
      sprite.scale.setScalar(0.35);
      this.snoreZ.push(sprite);
      this.group.add(sprite);
    }

    // くさい息(緑の煙)
    const stinkGeometry = new THREE.BufferGeometry();
    stinkGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(STINK_COUNT * 3), 3));
    // 加算合成だと重なって白飛びするので、丸いぼかしの粒を普通の半透明で薄く重ねる
    const puff = document.createElement('canvas');
    puff.width = 64;
    puff.height = 64;
    const puffContext = puff.getContext('2d');
    if (!puffContext) throw new Error('Could not create puff texture.');
    const gradient = puffContext.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    puffContext.fillStyle = gradient;
    puffContext.fillRect(0, 0, 64, 64);
    const puffTexture = new THREE.CanvasTexture(puff);
    this.disposables.push(puffTexture);
    const stinkMaterial = new THREE.PointsMaterial({
      color: '#7fbf3a',
      map: puffTexture,
      size: 0.35,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.disposables.push(stinkGeometry, stinkMaterial);
    this.stink = new THREE.Points(stinkGeometry, stinkMaterial);
    this.stink.frustumCulled = false;
    this.group.add(this.stink);

    this.group.position.copy(position);
    this.group.rotation.y = yaw;
    this.reset();
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }

  reset(): void {
    this.awake = 0;
    this.cooldown = 0;
    this.stinkAge = 99;
    this.setAwake(false);
  }

  /** プレイヤーを竜の体から押し出す(上履きは通り抜けられない) */
  pushOut(position: THREE.Vector3): void {
    const dx = position.x - this.group.position.x;
    const dz = position.z - this.group.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance >= RADIUS || distance < 1e-4) return;
    position.x = this.group.position.x + (dx / distance) * RADIUS;
    position.z = this.group.position.z + (dz / distance) * RADIUS;
  }

  update(delta: number, elapsed: number, player: { position: THREE.Vector3; sprinting: boolean; moving: boolean; safe: boolean }): void {
    this.cooldown = Math.max(0, this.cooldown - delta);
    const distance = Math.hypot(player.position.x - this.group.position.x, player.position.z - this.group.position.z);

    if (this.awake > 0) {
      this.awake -= delta;
      // 首を持ち上げて吠える
      this.neck.rotation.x = THREE.MathUtils.damp(this.neck.rotation.x, -0.55 + Math.sin(elapsed * 25) * 0.05, 8, delta);
      if (this.awake <= 0) {
        this.setAwake(false);
        this.cooldown = 3;
      }
    } else {
      // 寝息: 頭がゆっくり上下し、Z が浮かぶ
      this.breath += delta;
      this.neck.rotation.x = THREE.MathUtils.damp(this.neck.rotation.x, 0.55 + Math.sin(this.breath * 1.3) * 0.04, 3, delta);
      this.snoreZ.forEach((sprite, i) => {
        const t = (this.breath * 0.35 + i / 3) % 1;
        sprite.visible = true;
        sprite.position.set(0.25 + t * 0.4, 1.2 + t * 1.1, 0.7 + Math.sin(t * 6 + i) * 0.1);
        sprite.material.opacity = Math.sin(t * Math.PI) * 0.8;
        sprite.scale.setScalar(0.25 + t * 0.3);
      });
      this.snoreTimer -= delta;
      if (this.snoreTimer <= 0 && distance < 16) {
        this.snoreTimer = 3.2;
        this.events.onSnore(this.group.position);
      }
      const loud = player.sprinting && player.moving && distance < WAKE_SPRINT;
      if (this.cooldown <= 0 && !player.safe && (loud || distance < WAKE_TOUCH)) {
        this.awake = AWAKE_TIME;
        this.setAwake(true);
        this.breatheStink();
        this.events.onWake(player.position);
      }
    }
    this.updateStink(delta);
  }

  /** テスト用: 起きている姿を見せる */
  forceAwake(): void {
    this.awake = AWAKE_TIME;
    this.setAwake(true);
    this.neck.rotation.x = -0.55;
    this.breatheStink();
    this.updateStink(0.6);
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
  }

  private setAwake(awake: boolean): void {
    this.eyeMaterial.emissiveIntensity = awake ? 5 : 0;
    for (const eye of this.neck.children.slice(1)) eye.scale.set(1, awake ? 1 : 0.35, 1);
    for (const sprite of this.snoreZ) sprite.visible = !awake;
  }

  private breatheStink(): void {
    this.stinkAge = 0;
    const positions = this.stink.geometry.getAttribute('position') as THREE.BufferAttribute;
    // 竜の口の位置(ローカル)から前方へ扇状に広がる。乱数は決定的に。
    let seed = 99;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    // 口(首ローカルの鼻先)の位置を、このグループのローカル座標に直して吹き出し口にする
    this.group.updateMatrixWorld(true);
    const mouth = this.neck.localToWorld(new THREE.Vector3(0, 0.2, 0.78));
    this.group.worldToLocal(mouth);
    for (let i = 0; i < STINK_COUNT; i += 1) {
      positions.setXYZ(i, mouth.x, mouth.y, mouth.z);
      this.stinkVelocity[i * 3] = (random() - 0.5) * 1.6;
      this.stinkVelocity[i * 3 + 1] = random() * 0.6;
      this.stinkVelocity[i * 3 + 2] = 1.0 + random() * 1.8;
    }
    positions.needsUpdate = true;
  }

  private updateStink(delta: number): void {
    const material = this.stink.material as THREE.PointsMaterial;
    this.stinkAge += delta;
    if (this.stinkAge > 3) {
      material.opacity = 0;
      return;
    }
    const positions = this.stink.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < STINK_COUNT; i += 1) {
      positions.setXYZ(
        i,
        positions.getX(i) + this.stinkVelocity[i * 3] * delta,
        positions.getY(i) + this.stinkVelocity[i * 3 + 1] * delta,
        positions.getZ(i) + this.stinkVelocity[i * 3 + 2] * delta,
      );
    }
    positions.needsUpdate = true;
    material.opacity = 0.22 * (1 - this.stinkAge / 3);
    material.size = 0.3 + this.stinkAge * 0.35;
  }
}
