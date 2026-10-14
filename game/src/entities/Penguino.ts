import * as THREE from 'three';
import { applySurfaceDetail } from '../render/surfaceDetail';
import { Sculpt, sdCapsule, sdEllipsoid, sdRoundBox, sdRoundCone, sdSphere, smax, transform } from '../render/sdf';
import type { Level } from '../world/Level';

const SCALE = 1.55;
const SIGHT = 14;

function cartonLabel(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create carton label.');
  context.fillStyle = '#f7f7f4';
  context.fillRect(0, 0, 256, 256);
  context.fillStyle = '#2f6fd1';
  context.font = 'bold 44px "Hiragino Maru Gothic ProN", "Hiragino Sans", "Noto Sans JP", sans-serif';
  context.textAlign = 'center';
  context.fillText('ぎゅうにゅう', 128, 90);
  context.font = 'bold 30px "Hiragino Sans", "Noto Sans JP", sans-serif';
  context.fillText('200ml', 128, 140);
  context.fillStyle = '#c4262f';
  context.font = 'bold 26px "Hiragino Maru Gothic ProN", "Hiragino Sans", "Noto Sans JP", sans-serif';
  context.fillText('ペンギーノ', 128, 210);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 牛乳パックの体を持つペンギン(SDF スカルプト)。原点 = 足元。 */
function sculptPenguino(): THREE.BufferGeometry {
  // 少しよれた紙パック
  const s = new Sculpt().roughen(0.006, 7);
  const white = '#d9d7d0';
  const blue = '#2f6fd1';
  const orange = '#e59a2c';
  const dark = '#1b2130';
  // パック本体と、三角屋根(切妻)
  s.add(sdRoundBox([0, 0.55, 0], [0.26, 0.38, 0.26], 0.035), white);
  const roofBox = sdRoundBox([0, 1.02, 0], [0.26, 0.12, 0.26], 0.02);
  s.add((x, y, z) => smax(roofBox(x, y, z), Math.abs(x) * 0.62 + (y - 1.16) * 0.78, 0.02), white, 0.02);
  s.add(sdRoundBox([0, 1.17, 0], [0.025, 0.06, 0.25], 0.012), white, 0.015);
  // 青い帯
  s.add(sdRoundBox([0, 0.42, 0], [0.268, 0.07, 0.268], 0.03), blue);
  // 顔(+z)
  for (const side of [-1, 1]) s.add(sdSphere([side * 0.1, 0.8, 0.255], 0.045), dark, 0.01);
  s.add(sdRoundCone([0, 0.7, 0.24], [0, 0.66, 0.4], 0.06, 0.012), orange, 0.03);
  // 羽(フリッパー)
  for (const side of [-1, 1]) {
    s.add(transform(sdEllipsoid([0, 0, 0], [0.045, 0.24, 0.1]), { at: [side * 0.3, 0.5, 0.02], rotate: [0, 0, side * 0.35] }), dark, 0.03);
  }
  // 短い脚と足
  for (const side of [-1, 1]) {
    s.add(sdCapsule([side * 0.1, 0.17, 0], [side * 0.1, 0.06, 0.02], 0.045), orange, 0.02);
    s.add(sdEllipsoid([side * 0.11, 0.035, 0.09], [0.085, 0.035, 0.13]), orange, 0.03);
  }
  return s.mesh([-0.45, -0.05, -0.4], [0.45, 1.3, 0.5], 0.018);
}

/**
 * ぎゅうにゅうパック・ペンギーノ。図書室の奥に立っていて、
 * プレイヤーが目をそらしている間だけ、こちらへ向き直る(見ている間は動かない)。
 */
export class Penguino {
  readonly group = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly disposables: { dispose(): void }[] = [];
  private yaw: number;
  private squeaked = false;
  private readonly scratch = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();

  constructor(
    private readonly level: Level,
    position: THREE.Vector3,
    initialYaw: number,
    private readonly onSqueak: (position: THREE.Vector3) => void,
  ) {
    const geometry = sculptPenguino();
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82 });
    applySurfaceDetail(material, { scale: 30, strength: 0.12 }).setRim(0.06, '#cfe0ff');
    this.disposables.push(geometry, material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.body.add(mesh);
    const labelTexture = cartonLabel();
    const labelMaterial = new THREE.MeshStandardMaterial({ map: labelTexture, roughness: 0.6 });
    const labelGeometry = new THREE.PlaneGeometry(0.42, 0.42);
    this.disposables.push(labelTexture, labelMaterial, labelGeometry);
    for (const side of [-1, 1]) {
      const label = new THREE.Mesh(labelGeometry, labelMaterial);
      label.rotation.y = (side * Math.PI) / 2;
      label.position.set(side * 0.272, 0.66, 0);
      this.body.add(label);
    }
    this.body.scale.setScalar(SCALE);
    this.group.add(this.body);
    this.group.position.copy(position);
    this.yaw = initialYaw;
    this.group.rotation.y = initialYaw;
  }

  reset(yaw: number): void {
    this.yaw = yaw;
    this.group.rotation.y = yaw;
    this.body.rotation.set(0, 0, 0);
    this.squeaked = false;
  }

  /** 毎フレーム。camera はプレイヤーの目。 */
  update(delta: number, camera: THREE.Camera): void {
    const dx = camera.position.x - this.group.position.x;
    const dz = camera.position.z - this.group.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance > SIGHT) return;
    const head = this.scratch.copy(this.group.position).setY(1.2);
    if (!this.level.hasLineOfSight(head, camera.position)) return;
    // プレイヤーに見られているか(画面の中央付近に入っているか)
    camera.getWorldDirection(this.forward);
    const toMe = head.sub(camera.position).normalize();
    const watched = this.forward.dot(toMe) > Math.cos(THREE.MathUtils.degToRad(38));
    if (watched) {
      // 見られていると、ほんの少し首をかしげるだけ
      this.body.rotation.z = THREE.MathUtils.damp(this.body.rotation.z, 0.12, 2, delta);
      return;
    }
    this.body.rotation.z = THREE.MathUtils.damp(this.body.rotation.z, 0, 4, delta);
    const desired = Math.atan2(dx, dz);
    let diff = desired - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.yaw += diff * Math.min(1, 6 * delta);
    this.group.rotation.y = this.yaw;
    if (!this.squeaked && Math.abs(diff) > 1.2 && distance < 8) {
      this.squeaked = true;
      this.onSqueak(this.group.position);
    }
    if (Math.abs(diff) < 0.1) this.squeaked = false;
  }

  /** テスト用: すぐにプレイヤーの方を向く */
  face(target: THREE.Vector3): void {
    this.yaw = Math.atan2(target.x - this.group.position.x, target.z - this.group.position.z);
    this.group.rotation.y = this.yaw;
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
  }
}
