import * as THREE from 'three';
import type { Level } from '../world/Level';
import { EARLY_PATROL, type Cell } from '../world/levelData';
import { GabugabunoModel, MOUTH_HEIGHT, type EyeMode } from './GabugabunoModel';

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
  /** 懐中電灯の光がガブガブーノに当たっているか */
  litByFlashlight: boolean;
  stage: number;
  enraged: boolean;
};

export type MonsterEvents = {
  onNotice(): void;
  onLost(): void;
  onFootstep(position: THREE.Vector3, loudness: number): void;
  onChomp(position: THREE.Vector3): void;
};

export class Monster {
  readonly group = new THREE.Group();
  state: MonsterState = 'patrol';
  readonly velocity = new THREE.Vector3();

  private readonly model: GabugabunoModel;

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
  private grace = 0;
  private currentSpeed = 0;
  private lit = false;
  private scare = 0;

  constructor(
    private readonly level: Level,
    private rng: Rng,
    private readonly events: MonsterEvents,
  ) {
    this.model = new GabugabunoModel(() => this.events.onChomp(this.group.position));
    this.group.add(this.model.root);
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
    return target.copy(this.group.position).setY(MOUTH_HEIGHT + 0.4);
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
    this.model.reset();
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
    const distance = 2.7 - amount * 0.5;
    this.group.position.set(
      camera.position.x + this.scratch.x * distance,
      0,
      camera.position.z + this.scratch.z * distance,
    );
    this.yaw = Math.atan2(-this.scratch.x, -this.scratch.z);
    this.group.rotation.y = this.yaw;
    this.model.poseScare(amount, camera.position.y);
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

    if (this.scare <= 0) {
      this.model.update(delta, elapsed, {
        speed: this.currentSpeed,
        chasing: this.state === 'chase',
        alert: this.state === 'alert',
        stunned: this.state === 'stunned',
        lit: this.lit,
      });
    }
  }

  dispose(): void {
    this.model.dispose();
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

  /** 向きを即座に合わせる(テスト用の状態設定) */
  snapFacing(goal: THREE.Vector3): void {
    this.yaw = Math.atan2(goal.x - this.group.position.x, goal.z - this.group.position.z);
    this.group.rotation.y = this.yaw;
  }

  private setEyes(mode: EyeMode): void {
    this.model.setEyes(mode);
  }
}
