import * as THREE from 'three';
import type { Level } from '../world/Level';
import { EARLY_PATROL, type Cell } from '../world/levelData';

type Rng = () => number;

export type MonsterState = 'patrol' | 'investigate' | 'alert' | 'chase' | 'search' | 'stunned';

/** ステージ = 拾ったヒューズの本数(0..3)。3本目以降は同じ値。 */
const PATROL_SPEED = [1.7, 2.0, 2.3, 2.3];
const CHASE_SPEED = [3.5, 4.0, 4.5, 4.5];
const ENRAGED_SPEED = 4.3;
const LOSE_TIME = [3, 4, 6, 6];
const HEARING_MULT = [0.5, 1, 1.25, 1.4];
const SIGHT_LIT = 22;
const SIGHT_DARK = 8;
const FOV_COS = Math.cos(THREE.MathUtils.degToRad(65));
const RADIUS = 0.7;
const LIT_SLOW = 0.3;

export type MonsterSenses = {
  playerPosition: THREE.Vector3;
  playerSafe: boolean;
  /** プレイヤーが立てている音の届く半径(m)。0 なら無音。 */
  noiseRadius: number;
  /** 懐中電灯が点いているか(点いていると遠くから見つかる) */
  lightOn: boolean;
  /** 懐中電灯の光がポンちゃんに当たっているか */
  litByFlashlight: boolean;
  stage: number;
  enraged: boolean;
};

export type MonsterEvents = {
  onNotice(): void;
  onLost(): void;
  onFootstep(position: THREE.Vector3, loudness: number): void;
};

function fabricTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create fabric texture.');
  context.fillStyle = '#ebe5da';
  context.fillRect(0, 0, 512, 512);
  // 布目
  for (let y = 0; y < 512; y += 3) {
    context.fillStyle = `rgba(120, 110, 95, ${0.04 + ((y * 7) % 5) * 0.01})`;
    context.fillRect(0, y, 512, 1);
  }
  // 裾の汚れ(v=0 が裾)
  const hem = context.createLinearGradient(0, 512, 0, 300);
  hem.addColorStop(0, 'rgba(70, 45, 35, 0.85)');
  hem.addColorStop(1, 'rgba(70, 45, 35, 0)');
  context.fillStyle = hem;
  context.fillRect(0, 300, 512, 212);
  // 赤黒いシミ
  for (let i = 0; i < 9; i += 1) {
    const x = (i * 131) % 512;
    const y = 300 + ((i * 71) % 190);
    const g = context.createRadialGradient(x, y, 0, x, y, 30 + (i % 3) * 14);
    g.addColorStop(0, 'rgba(90, 18, 20, 0.6)');
    g.addColorStop(1, 'rgba(90, 18, 20, 0)');
    context.fillStyle = g;
    context.fillRect(x - 60, y - 60, 120, 120);
  }
  // つぎはぎの縫い目
  context.strokeStyle = 'rgba(60, 40, 40, 0.8)';
  context.lineWidth = 3;
  for (const [x, y, w, h] of [
    [60, 180, 90, 70],
    [330, 240, 70, 90],
  ]) {
    context.strokeRect(x, y, w, h);
    for (let k = 0; k < w; k += 10) {
      context.beginPath();
      context.moveTo(x + k, y - 5);
      context.lineTo(x + k + 4, y + 5);
      context.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

export class Monster {
  readonly group = new THREE.Group();
  state: MonsterState = 'patrol';
  readonly velocity = new THREE.Vector3();

  private readonly body = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly face = new THREE.Group();
  private readonly mouth = new THREE.Group();
  private readonly mouthOpen: THREE.Mesh;
  private readonly upperTeeth = new THREE.Group();
  private readonly lowerTeeth = new THREE.Group();
  private readonly eyeMaterial: THREE.MeshStandardMaterial;
  private readonly glow: THREE.PointLight;
  private readonly disposables: { dispose(): void }[] = [];

  private path: Cell[] = [];
  private readonly target = new THREE.Vector3();
  private readonly lastSeen = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();
  private readonly scratchB = new THREE.Vector3();
  private stateTimer = 0;
  private repathTimer = 0;
  private senseTimer = 0;
  private lostTimer = 0;
  private waitTimer = 0;
  private searchHops = 0;
  private patrolIndex = 0;
  private yaw = 0;
  private stride = 0;
  private walkPhase = 0;
  private grace = 0;
  private currentSpeed = 0;
  private lit = false;
  private scare = 0;

  constructor(
    private readonly level: Level,
    private rng: Rng,
    private readonly events: MonsterEvents,
  ) {
    const fabric = this.track(fabricTexture());
    const cloth = this.track(
      new THREE.MeshStandardMaterial({ map: fabric, roughness: 1, metalness: 0, side: THREE.DoubleSide }),
    );

    // 胴体: シーツおばけのシルエット(旋盤形状)+ 波打つ裾
    const profile = [
      [0.95, 0],
      [0.92, 0.25],
      [0.82, 0.9],
      [0.74, 1.7],
      [0.78, 2.4],
      [0.76, 2.9],
      [0.62, 3.4],
      [0.38, 3.78],
      [0.12, 3.95],
      [0, 3.98],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const lathe = this.track(new THREE.LatheGeometry(profile, 40));
    const positions = lathe.getAttribute('position');
    for (let i = 0; i < positions.count; i += 1) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);
      const angle = Math.atan2(z, x);
      // 布のしわ
      const wrinkle = 1 + Math.sin(angle * 9 + y * 2.3) * 0.025 * Math.min(1, y);
      positions.setXYZ(i, x * wrinkle, y < 0.3 ? y + Math.sin(angle * 7) * 0.14 : y, z * wrinkle);
    }
    lathe.computeVertexNormals();
    const torso = new THREE.Mesh(lathe, cloth);
    torso.castShadow = true;
    this.body.add(torso);

    // 顔
    this.face.position.set(0, 3.05, 0.7);
    const eyeSocket = this.track(new THREE.SphereGeometry(0.16, 16, 12));
    const socketMaterial = this.track(new THREE.MeshStandardMaterial({ color: '#0a0606', roughness: 0.3 }));
    this.eyeMaterial = this.track(
      new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#dfe8ff', emissiveIntensity: 1.6 }),
    );
    const pupil = this.track(new THREE.SphereGeometry(0.05, 10, 8));
    for (const side of [-1, 1]) {
      const socket = new THREE.Mesh(eyeSocket, socketMaterial);
      socket.scale.set(1, 1.35, 0.5);
      socket.position.set(side * 0.26, 0.12, 0.02);
      this.face.add(socket);
      const eye = new THREE.Mesh(pupil, this.eyeMaterial);
      eye.position.set(side * 0.26, 0.1, 0.1);
      this.face.add(eye);
    }
    // 縫い付けられた笑顔
    const smileCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.42, -0.12, 0.08),
      new THREE.Vector3(-0.22, -0.32, 0.12),
      new THREE.Vector3(0, -0.38, 0.13),
      new THREE.Vector3(0.22, -0.32, 0.12),
      new THREE.Vector3(0.42, -0.12, 0.08),
    ]);
    const lipMaterial = this.track(new THREE.MeshStandardMaterial({ color: '#7a1420', roughness: 0.6 }));
    const smile = new THREE.Mesh(this.track(new THREE.TubeGeometry(smileCurve, 40, 0.025, 6)), lipMaterial);
    this.face.add(smile);
    const stitch = this.track(new THREE.BoxGeometry(0.02, 0.14, 0.02));
    for (let i = 1; i < 10; i += 1) {
      const point = smileCurve.getPoint(i / 10);
      const tangent = smileCurve.getTangent(i / 10);
      const mark = new THREE.Mesh(stitch, lipMaterial);
      mark.position.copy(point);
      mark.rotation.z = Math.atan2(tangent.y, tangent.x) + Math.PI / 2;
      this.face.add(mark);
    }
    // ジャンプスケア用の口(普段は閉じている)と歯
    // 口の穴(単位球を拡大縮小)と、上下の歯列
    this.mouth.position.set(0, -0.3, 0.1);
    this.mouthOpen = new THREE.Mesh(
      this.track(new THREE.SphereGeometry(1, 24, 14)),
      this.track(new THREE.MeshStandardMaterial({ color: '#1a0204', roughness: 0.4 })),
    );
    this.mouth.add(this.mouthOpen);
    const teeth = this.track(new THREE.ConeGeometry(0.03, 0.12, 5));
    const toothMaterial = this.track(new THREE.MeshStandardMaterial({ color: '#efe6cf', roughness: 0.4 }));
    for (const [row, top] of [
      [this.upperTeeth, 1],
      [this.lowerTeeth, -1],
    ] as const) {
      for (let i = 0; i < 9; i += 1) {
        const x = (i / 8 - 0.5) * 0.62;
        const tooth = new THREE.Mesh(teeth, toothMaterial);
        tooth.position.set(x, -top * 0.05, 0.1 - x * x * 0.5);
        tooth.rotation.x = top > 0 ? Math.PI : 0;
        row.add(tooth);
      }
      this.mouth.add(row);
    }
    this.setMouth(0);
    this.face.add(this.mouth);
    this.body.add(this.face);

    // 長すぎる腕
    const upper = this.track(new THREE.CylinderGeometry(0.13, 0.11, 1.5, 10));
    upper.translate(0, -0.75, 0);
    const lower = this.track(new THREE.CylinderGeometry(0.11, 0.08, 1.4, 10));
    lower.translate(0, -0.7, 0);
    const palm = this.track(new THREE.SphereGeometry(0.17, 12, 8));
    const finger = this.track(new THREE.CapsuleGeometry(0.035, 0.32, 4, 6));
    for (const [arm, side] of [
      [this.armL, -1],
      [this.armR, 1],
    ] as const) {
      arm.position.set(side * 0.68, 2.65, 0.05);
      const upperMesh = new THREE.Mesh(upper, cloth);
      upperMesh.castShadow = true;
      arm.add(upperMesh);
      const elbow = new THREE.Group();
      elbow.position.y = -1.5;
      elbow.name = 'elbow';
      const lowerMesh = new THREE.Mesh(lower, cloth);
      lowerMesh.castShadow = true;
      elbow.add(lowerMesh);
      const hand = new THREE.Mesh(palm, cloth);
      hand.scale.set(1, 1.2, 0.55);
      hand.position.y = -1.48;
      elbow.add(hand);
      for (let f = 0; f < 3; f += 1) {
        const digit = new THREE.Mesh(finger, socketMaterial);
        digit.position.set((f - 1) * 0.08, -1.72, 0.02);
        digit.rotation.z = (f - 1) * 0.15;
        elbow.add(digit);
      }
      arm.add(elbow);
      arm.rotation.z = side * 0.12;
      this.body.add(arm);
    }

    this.glow = new THREE.PointLight('#ff2a2a', 0, 6, 1.5);
    this.glow.position.set(0, 3.0, 1.2);
    this.body.add(this.glow);

    this.group.add(this.body);
    this.reset(level.monsterSpawn);
  }

  setRng(rng: Rng): void {
    this.rng = rng;
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }

  get speed(): number {
    return this.currentSpeed;
  }

  get isLit(): boolean {
    return this.lit;
  }

  /** 目の高さの位置(ライトの当たり判定や視線計算用) */
  headPosition(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.group.position).setY(3.0);
  }

  reset(cell: Cell, graceSeconds = 0): void {
    this.level.center(cell, this.group.position);
    this.state = 'patrol';
    this.path = [];
    this.stateTimer = 0;
    this.lostTimer = 0;
    this.waitTimer = 0;
    this.grace = graceSeconds;
    this.scare = 0;
    this.currentSpeed = 0;
    this.patrolIndex = 0;
    this.setMouth(0);
    this.body.position.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);
    this.setEyes('patrol');
  }

  stun(seconds: number): void {
    this.state = 'stunned';
    this.stateTimer = seconds;
    this.path = [];
    this.setEyes('stunned');
  }

  /** プレイヤーの位置を知らされて追跡を始める(電源復旧後のラストチェイス)。 */
  forceChase(playerPosition: THREE.Vector3): void {
    this.lastSeen.copy(playerPosition);
    this.enterChase();
  }

  /** ジャンプスケア演出: カメラの正面に顔を突き出す。 */
  poseScare(camera: THREE.Camera, amount: number): void {
    this.scare = amount;
    camera.getWorldDirection(this.scratch);
    this.scratch.y = 0;
    this.scratch.normalize();
    const distance = 1.95 - amount * 0.55;
    this.group.position.set(
      camera.position.x + this.scratch.x * distance,
      0,
      camera.position.z + this.scratch.z * distance,
    );
    this.yaw = Math.atan2(-this.scratch.x, -this.scratch.z);
    this.group.rotation.y = this.yaw;
    // 体をかがめて、顔をプレイヤーの目線まで下げる
    this.body.position.y = camera.position.y - 3.05 - 0.05;
    this.body.position.z = -0.4;
    this.body.rotation.x = 0;
    this.setMouth(amount);
    this.face.rotation.z = Math.sin(amount * 40) * 0.08;
    // 腕は左右に広げて、視界を囲い込む
    this.armL.rotation.set(-0.8, 0, -1.1);
    this.armR.rotation.set(-0.8, 0, 1.1);
    this.setEyes('chase');
    this.eyeMaterial.emissiveIntensity = 6;
    this.glow.intensity = 8;
  }

  update(delta: number, elapsed: number, senses: MonsterSenses): void {
    this.grace = Math.max(0, this.grace - delta);
    this.stateTimer -= delta;
    this.repathTimer -= delta;
    this.senseTimer -= delta;
    this.lit = senses.litByFlashlight;

    if (this.senseTimer <= 0) {
      this.senseTimer = 0.15;
      this.sense(senses);
    }

    switch (this.state) {
      case 'stunned':
        this.currentSpeed = 0;
        if (this.stateTimer <= 0) {
          if (senses.enraged) this.forceChase(senses.playerPosition);
          else this.enterPatrol();
        }
        break;
      case 'alert':
        this.currentSpeed = 0;
        this.faceToward(senses.playerPosition, delta, 10);
        if (this.stateTimer <= 0) this.enterChase();
        break;
      case 'chase':
        this.updateChase(delta, senses);
        break;
      case 'search':
        this.followPath(delta, PATROL_SPEED[senses.stage] * 1.3, () => {
          this.searchHops -= 1;
          if (this.searchHops <= 0 || this.stateTimer <= 0) {
            this.enterPatrol();
            return;
          }
          const around = this.level.cellOf(this.lastSeen.x, this.lastSeen.z);
          const next = this.level.randomFloorCell(
            this.rng,
            (c) => Math.abs(c.col - around.col) <= 3 && Math.abs(c.row - around.row) <= 3,
          );
          this.pathTo(next);
          this.waitTimer = 0.8;
        });
        break;
      case 'investigate':
        this.followPath(delta, PATROL_SPEED[senses.stage] * 1.2, () => {
          this.waitTimer = 2.5;
          this.state = 'patrol';
          this.path = [];
        });
        break;
      case 'patrol':
      default:
        this.followPath(delta, PATROL_SPEED[senses.stage], () => {
          this.waitTimer = 1.2 + this.rng() * 1.6;
          this.pickPatrolTarget(senses);
        });
        if (this.path.length === 0 && this.waitTimer <= 0) this.pickPatrolTarget(senses);
        break;
    }

    this.animate(delta, elapsed);
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
  }

  // ---------- 知覚と状態遷移 ----------

  private sense(senses: MonsterSenses): void {
    if (this.state === 'stunned' || this.grace > 0) return;
    const head = this.headPosition(this.scratch);
    const toPlayer = this.scratchB.copy(senses.playerPosition).sub(this.group.position);
    toPlayer.y = 0;
    const distance = toPlayer.length();
    const forward = this.scratchB.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const dirX = (senses.playerPosition.x - this.group.position.x) / Math.max(distance, 0.001);
    const dirZ = (senses.playerPosition.z - this.group.position.z) / Math.max(distance, 0.001);
    const facing = forward.x * dirX + forward.z * dirZ;
    const range = senses.lightOn ? SIGHT_LIT : SIGHT_DARK;
    const lineOfSight = this.level.hasLineOfSight(head, senses.playerPosition);
    const inView = this.state === 'chase' || facing > FOV_COS || distance < 3 || senses.litByFlashlight;
    const seen =
      !senses.playerSafe && lineOfSight && inView && (distance < range || (senses.enraged && distance < 60));
    const heardRadius = senses.noiseRadius * HEARING_MULT[senses.stage] * (lineOfSight ? 1 : 0.6);
    const heard = !senses.playerSafe && heardRadius > distance;

    if (this.state === 'chase') {
      if (senses.playerSafe) {
        this.enterSearch();
        return;
      }
      if (seen || (senses.enraged && distance < 60)) {
        this.lastSeen.copy(senses.playerPosition);
        this.lostTimer = 0;
      } else {
        this.lostTimer += 0.15;
        if (heard) this.lastSeen.copy(senses.playerPosition);
        if (this.lostTimer > LOSE_TIME[senses.stage]) this.enterSearch();
      }
      return;
    }
    if (this.state === 'alert') return;

    if (seen || (senses.enraged && !senses.playerSafe)) {
      this.lastSeen.copy(senses.playerPosition);
      this.state = 'alert';
      this.stateTimer = senses.enraged ? 0.3 : 0.75;
      this.path = [];
      this.setEyes('chase');
      this.events.onNotice();
      return;
    }
    if (heard && senses.stage >= 1 && this.state !== 'search') {
      this.state = 'investigate';
      this.lastSeen.copy(senses.playerPosition);
      this.pathTo(this.level.cellOf(senses.playerPosition.x, senses.playerPosition.z));
      this.setEyes('alert');
    }
  }

  private enterChase(): void {
    this.state = 'chase';
    this.lostTimer = 0;
    this.repathTimer = 0;
    this.setEyes('chase');
  }

  private enterSearch(): void {
    this.state = 'search';
    this.stateTimer = 10;
    this.searchHops = 3;
    this.pathTo(this.level.cellOf(this.lastSeen.x, this.lastSeen.z));
    this.setEyes('alert');
    this.events.onLost();
  }

  private enterPatrol(): void {
    this.state = 'patrol';
    this.path = [];
    this.waitTimer = 0.5;
    this.setEyes('patrol');
  }

  private pickPatrolTarget(senses: MonsterSenses): void {
    let cell: Cell;
    if (senses.stage === 0) {
      this.patrolIndex = (this.patrolIndex + 1 + Math.floor(this.rng() * 2)) % EARLY_PATROL.length;
      cell = EARLY_PATROL[this.patrolIndex];
    } else if (senses.stage >= 2 && this.rng() < 0.5) {
      // 後半はプレイヤーのいる辺りを嗅ぎ回る
      const near = this.level.cellOf(senses.playerPosition.x, senses.playerPosition.z);
      cell = this.level.randomFloorCell(
        this.rng,
        (c) => Math.abs(c.col - near.col) <= 5 && Math.abs(c.row - near.row) <= 5,
      );
    } else {
      cell = this.level.randomFloorCell(this.rng);
    }
    this.pathTo(cell);
  }

  private updateChase(delta: number, senses: MonsterSenses): void {
    const speed = (senses.enraged ? ENRAGED_SPEED : CHASE_SPEED[senses.stage]) * (this.lit ? LIT_SLOW : 1);
    const distance = Math.hypot(
      senses.playerPosition.x - this.group.position.x,
      senses.playerPosition.z - this.group.position.z,
    );
    const goal = this.lostTimer > 0 ? this.lastSeen : senses.playerPosition;
    if (distance < 7 && this.lostTimer === 0 && this.level.isSegmentWalkable(this.group.position, goal, RADIUS * 0.8)) {
      this.path = [];
      this.moveToward(goal, speed, delta);
      return;
    }
    if (this.repathTimer <= 0 || this.path.length === 0) {
      this.repathTimer = 0.35;
      this.pathTo(this.level.cellOf(goal.x, goal.z));
    }
    this.followPath(delta, speed, () => {
      this.repathTimer = 0;
    });
  }

  // ---------- 移動 ----------

  private pathTo(cell: Cell): void {
    const from = this.level.cellOf(this.group.position.x, this.group.position.z);
    this.path = this.level.findPath(from, cell);
    this.smoothPath();
  }

  private smoothPath(): void {
    while (this.path.length > 1) {
      this.level.center(this.path[1], this.scratch);
      if (!this.level.isSegmentWalkable(this.group.position, this.scratch, RADIUS)) break;
      this.path.shift();
    }
  }

  private followPath(delta: number, speed: number, onArrive: () => void): void {
    if (this.waitTimer > 0) {
      this.waitTimer -= delta;
      this.currentSpeed = 0;
      return;
    }
    if (this.path.length === 0) {
      this.currentSpeed = 0;
      return;
    }
    this.level.center(this.path[0], this.target);
    const dx = this.target.x - this.group.position.x;
    const dz = this.target.z - this.group.position.z;
    if (dx * dx + dz * dz < 0.36) {
      this.path.shift();
      this.smoothPath();
      if (this.path.length === 0) onArrive();
      return;
    }
    this.moveToward(this.target, speed * (this.lit && this.state !== 'patrol' ? LIT_SLOW : 1), delta);
  }

  private moveToward(goal: THREE.Vector3, speed: number, delta: number): void {
    const dx = goal.x - this.group.position.x;
    const dz = goal.z - this.group.position.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.001) return;
    const step = Math.min(length, speed * delta);
    const before = this.scratch.copy(this.group.position);
    this.group.position.x += (dx / length) * step;
    this.group.position.z += (dz / length) * step;
    this.level.resolveCollision(this.group.position, RADIUS);
    const moved = Math.hypot(this.group.position.x - before.x, this.group.position.z - before.z);
    this.currentSpeed = moved / Math.max(delta, 1e-4);
    this.faceToward(goal, delta, 6);
    this.stride += moved;
    const strideLength = 1.7;
    if (this.stride > strideLength) {
      this.stride -= strideLength;
      this.events.onFootstep(this.group.position, this.state === 'chase' ? 1 : 0.6);
    }
  }

  private faceToward(goal: THREE.Vector3, delta: number, rate: number): void {
    const desired = Math.atan2(goal.x - this.group.position.x, goal.z - this.group.position.z);
    let diff = desired - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.yaw += diff * Math.min(1, rate * delta);
    this.group.rotation.y = this.yaw;
  }

  // ---------- 見た目 ----------

  /** 0 = 縫い閉じた口、1 = 大きく裂けた口 */
  private setMouth(amount: number): void {
    const open = 0.02 + amount * 0.26;
    this.mouthOpen.scale.set(0.36 + amount * 0.04, open, 0.1);
    this.upperTeeth.position.y = open * 0.85;
    this.lowerTeeth.position.y = -open * 0.85;
    this.upperTeeth.visible = amount > 0.05;
    this.lowerTeeth.visible = amount > 0.05;
  }

  /** 向きを即座に合わせる(テスト用の状態設定) */
  snapFacing(goal: THREE.Vector3): void {
    this.yaw = Math.atan2(goal.x - this.group.position.x, goal.z - this.group.position.z);
    this.group.rotation.y = this.yaw;
  }

  private setEyes(mode: 'patrol' | 'alert' | 'chase' | 'stunned'): void {
    const colors = {
      patrol: ['#f3f6ff', '#dfe8ff', 1.6, 0],
      alert: ['#ffe9a8', '#ffc23a', 2.4, 1.5],
      chase: ['#ff6a6a', '#ff1414', 4.5, 5],
      stunned: ['#555', '#222', 0.2, 0],
    } as const;
    const [color, emissive, intensity, glow] = colors[mode];
    this.eyeMaterial.color.set(color);
    this.eyeMaterial.emissive.set(emissive);
    this.eyeMaterial.emissiveIntensity = intensity;
    this.glow.intensity = glow;
  }

  private animate(delta: number, elapsed: number): void {
    if (this.scare > 0) return;
    const moving = Math.min(1, this.currentSpeed / 2);
    this.walkPhase += delta * (2 + this.currentSpeed * 1.4);
    const chasing = this.state === 'chase';
    this.body.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.14 * moving;
    this.body.rotation.z = Math.sin(this.walkPhase) * 0.06 * moving;
    this.body.rotation.x = THREE.MathUtils.damp(this.body.rotation.x, chasing ? 0.18 : 0, 4, delta);
    // 首をかしげる(待機中は不気味に大きく)
    const tilt = this.state === 'stunned' ? 0.5 : moving < 0.2 ? Math.sin(elapsed * 0.7) * 0.28 : 0.08;
    this.face.rotation.z = THREE.MathUtils.damp(this.face.rotation.z, tilt, 3, delta);
    const reach = chasing ? -1.15 : this.state === 'alert' ? -0.5 : 0;
    const swing = Math.sin(this.walkPhase) * 0.35 * moving;
    this.armL.rotation.x = THREE.MathUtils.damp(this.armL.rotation.x, reach + swing, 6, delta);
    this.armR.rotation.x = THREE.MathUtils.damp(this.armR.rotation.x, reach - swing, 6, delta);
    for (const arm of [this.armL, this.armR]) {
      const elbow = arm.getObjectByName('elbow');
      if (elbow) elbow.rotation.x = THREE.MathUtils.damp(elbow.rotation.x, chasing ? -0.5 : -0.1, 5, delta);
    }
    if (this.state === 'stunned') {
      this.body.rotation.z = Math.sin(elapsed * 30) * 0.03;
    }
    if (this.lit && (chasing || this.state === 'alert')) {
      // 光に怯んで震える
      this.body.position.x = Math.sin(elapsed * 55) * 0.04;
    } else {
      this.body.position.x = 0;
    }
  }

  private track<T extends { dispose(): void }>(item: T): T {
    this.disposables.push(item);
    return item;
  }
}
