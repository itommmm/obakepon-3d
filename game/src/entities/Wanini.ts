import * as THREE from 'three';
import { Sculpt, sdCapsule, sdRoundBox, sdRoundCone, sdSphere } from '../render/sdf';
import { applySurfaceDetail } from '../render/surfaceDetail';
import type { Level } from '../world/Level';
import type { Cell } from '../world/levelData';

const SPEED = 1.4;
const SIGHT_LIT = 11;
const NOTICE_NEAR = 2.6;
const FOV_COS = Math.cos(THREE.MathUtils.degToRad(60));
const COOLDOWN = 10;
const SCALE = 1.25;

/** 1階廊下の巡回ルート(ぐるっと一周) */
const ROUTE: Cell[] = [
  { col: 2, row: 16 },
  { col: 23, row: 16 },
  { col: 23, row: 18 },
  { col: 2, row: 18 },
];

/** チョークの体を持つワニ(SDF スカルプト)。原点 = 足元、前 = +z。 */
function sculptWanini(): THREE.BufferGeometry {
  const chalk = '#e9e7df';
  const green = '#3f8a4c';
  const tooth = '#f6f3e8';
  const s = new Sculpt().roughen(0.006, 9);
  // チョークの胴体(少し削れた円柱)
  s.add(sdCapsule([0, 0.3, -0.6], [0, 0.3, 0.55], 0.2), chalk);
  // 頭とあご
  s.add(sdRoundBox([0, 0.33, 0.82], [0.19, 0.12, 0.22], 0.08), green, 0.1);
  s.add(sdRoundBox([0, 0.28, 1.12], [0.14, 0.065, 0.2], 0.05), green, 0.06);
  // 目の出っ張り
  for (const side of [-1, 1]) s.add(sdSphere([side * 0.11, 0.45, 0.78], 0.075), green, 0.05);
  // 歯(口の両側から下向き)
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i += 1) {
      const z = 0.94 + i * 0.075;
      s.add(sdRoundCone([side * 0.13, 0.25, z], [side * 0.135, 0.18, z], 0.022, 0.004), tooth, 0.008);
    }
  }
  // 4本の短い足
  for (const side of [-1, 1]) {
    for (const z of [-0.35, 0.4]) {
      s.add(sdCapsule([side * 0.17, 0.25, z], [side * 0.34, 0.03, z + 0.05], 0.055), green, 0.05);
    }
  }
  // しっぽ
  s.add(sdRoundCone([0, 0.3, -0.62], [0.05, 0.12, -1.35], 0.15, 0.03), green, 0.08);
  return s.mesh([-0.5, -0.05, -1.5], [0.5, 0.65, 1.4], 0.022);
}

/**
 * チョーク・ワニーニ。1階廊下を巡回する見張り。
 * 懐中電灯を点けたまま視界に入る(または近づきすぎる)と、黒板をひっかくような声で鳴き、
 * ガブガブーノを呼び寄せる。
 */
export class Wanini {
  readonly group = new THREE.Group();
  alarmed = 0;
  private readonly body = new THREE.Group();
  private readonly eyeMaterial: THREE.MeshStandardMaterial;
  private readonly disposables: { dispose(): void }[] = [];
  private target = 1;
  private cooldown = 0;
  private senseTimer = 0;
  private phase = 0;
  private yaw = 0;
  private readonly goal = new THREE.Vector3();
  private readonly head = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();

  constructor(
    private readonly level: Level,
    private readonly onAlarm: (at: THREE.Vector3) => void,
  ) {
    const geometry = sculptWanini();
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
    applySurfaceDetail(material, { scale: 45, strength: 0.2 }).setRim(0.05, '#d6ffd0');
    this.eyeMaterial = new THREE.MeshStandardMaterial({ color: '#fff3a0', emissive: '#ffd84a', emissiveIntensity: 0.8 });
    const eye = new THREE.SphereGeometry(0.035, 10, 8);
    this.disposables.push(geometry, material, this.eyeMaterial, eye);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.body.add(mesh);
    for (const side of [-1, 1]) {
      const glint = new THREE.Mesh(eye, this.eyeMaterial);
      glint.position.set(side * 0.13, 0.48, 0.84);
      this.body.add(glint);
    }
    this.body.scale.setScalar(SCALE);
    this.group.add(this.body);
    this.reset();
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }

  reset(): void {
    this.level.center(ROUTE[0], this.group.position);
    this.target = 1;
    this.cooldown = 0;
    this.alarmed = 0;
    this.yaw = Math.PI / 2;
    this.group.rotation.y = this.yaw;
    this.body.rotation.set(0, 0, 0);
    this.setEyes(false);
  }

  /** テスト用: 指定位置に置いて、target の方を向かせる */
  place(position: THREE.Vector3, lookAt: THREE.Vector3): void {
    this.group.position.copy(position).setY(0);
    this.yaw = Math.atan2(lookAt.x - position.x, lookAt.z - position.z);
    this.group.rotation.y = this.yaw;
  }

  update(
    delta: number,
    elapsed: number,
    player: { position: THREE.Vector3; eye: THREE.Vector3; lightOn: boolean; safe: boolean },
  ): void {
    this.cooldown = Math.max(0, this.cooldown - delta);
    this.senseTimer -= delta;

    if (this.alarmed > 0) {
      // 鳴いている間は立ち止まり、プレイヤーを見て体を持ち上げる
      this.alarmed -= delta;
      this.turnToward(player.position, delta, 8);
      this.body.rotation.x = THREE.MathUtils.damp(this.body.rotation.x, -0.35, 10, delta);
      this.body.rotation.z = Math.sin(elapsed * 40) * 0.05;
      if (this.alarmed <= 0) this.setEyes(false);
      return;
    }
    this.body.rotation.x = THREE.MathUtils.damp(this.body.rotation.x, 0, 6, delta);

    // 巡回
    this.level.center(ROUTE[this.target], this.goal);
    const dx = this.goal.x - this.group.position.x;
    const dz = this.goal.z - this.group.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.3) {
      this.target = (this.target + 1) % ROUTE.length;
    } else {
      const step = Math.min(distance, SPEED * delta);
      this.group.position.x += (dx / distance) * step;
      this.group.position.z += (dz / distance) * step;
      this.turnToward(this.goal, delta, 5);
    }
    // ワニらしく体をくねらせる
    this.phase += delta * 9;
    this.body.rotation.y = Math.sin(this.phase) * 0.18;
    this.body.position.y = Math.abs(Math.sin(this.phase)) * 0.02;

    if (this.senseTimer <= 0) {
      this.senseTimer = 0.2;
      this.sense(player);
    }
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
  }

  private sense(player: { position: THREE.Vector3; eye: THREE.Vector3; lightOn: boolean; safe: boolean }): void {
    if (this.cooldown > 0 || player.safe) return;
    const distance = Math.hypot(player.position.x - this.group.position.x, player.position.z - this.group.position.z);
    if (distance > SIGHT_LIT) return;
    this.head.copy(this.group.position).setY(0.6);
    if (!this.level.hasLineOfSight(this.head, player.eye)) return;
    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const facing =
      (this.forward.x * (player.position.x - this.group.position.x) + this.forward.z * (player.position.z - this.group.position.z)) /
      Math.max(distance, 1e-3);
    const spotted = (player.lightOn && facing > FOV_COS) || distance < NOTICE_NEAR;
    if (!spotted) return;
    this.alarmed = 1.6;
    this.cooldown = COOLDOWN;
    this.setEyes(true);
    this.onAlarm(player.position);
  }

  private turnToward(goal: THREE.Vector3, delta: number, rate: number): void {
    const desired = Math.atan2(goal.x - this.group.position.x, goal.z - this.group.position.z);
    let diff = desired - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.yaw += diff * Math.min(1, rate * delta);
    this.group.rotation.y = this.yaw;
  }

  private setEyes(alarm: boolean): void {
    this.eyeMaterial.emissive.set(alarm ? '#ffb000' : '#ffd84a');
    this.eyeMaterial.emissiveIntensity = alarm ? 6 : 0.8;
  }
}
