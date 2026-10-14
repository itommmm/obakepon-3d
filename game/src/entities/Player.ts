import * as THREE from 'three';
import type { InputController } from '../core/InputController';
import { FlashlightBeam } from '../render/FlashlightBeam';
import type { Level } from '../world/Level';

export type PlayerTuning = {
  walkSpeed: number;
  sprintSpeed: number;
  acceleration: number;
  mouseSensitivity: number;
  flashlightIntensity: number;
};

const EYE_HEIGHT = 1.65;
const RADIUS = 0.35;
const STAMINA_DRAIN = 24;
const STAMINA_REGEN = 14;
const EXHAUSTED_UNTIL = 30;
const BATTERY_DRAIN = 1.4;
const BATTERY_DRAIN_ON_MONSTER = 4.5;
const SAFE_REGEN = 12;
const NOISE_SPRINT = 12;
const NOISE_WALK = 4.5;

export class Player {
  /** 足元の位置 */
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly flashlight: THREE.SpotLight;
  /** 光の筋とチリ(見た目だけ) */
  readonly beam: FlashlightBeam;
  yaw = 0;
  pitch = 0;
  stamina = 100;
  battery = 100;
  lightOn = true;
  sprinting = false;
  exhausted = false;
  noiseRadius = 0;

  private readonly move = new THREE.Vector2();
  private readonly desired = new THREE.Vector3();
  private bobPhase = 0;
  private stepDistance = 0;
  private flickerTime = 0;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly events: { onStep(sprinting: boolean): void; onLightToggle(on: boolean): void },
  ) {
    this.flashlight = new THREE.SpotLight('#ffe6c0', 95, 34, 0.5, 0.6, 1.5);
    this.flashlight.castShadow = true;
    this.flashlight.shadow.mapSize.set(1024, 1024);
    this.flashlight.shadow.bias = -0.0004;
    this.flashlight.shadow.camera.near = 0.3;
    this.flashlight.shadow.camera.far = 34;
    this.flashlight.position.set(0.22, -0.28, 0.05);
    this.flashlight.target.position.set(0.05, -0.35, -10);
    camera.add(this.flashlight);
    camera.add(this.flashlight.target);
    this.beam = new FlashlightBeam(this.flashlight.angle);
    this.beam.cone.position.copy(this.flashlight.position);
    this.beam.cone.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, -1),
      this.flashlight.target.position.clone().sub(this.flashlight.position).normalize(),
    );
    camera.add(this.beam.cone);
  }

  get eyePosition(): THREE.Vector3 {
    return this.camera.position;
  }

  reset(position: THREE.Vector3, yaw: number): void {
    this.position.copy(position).setY(0);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.stamina = 100;
    this.battery = Math.max(this.battery, 60);
    this.exhausted = false;
    this.sprinting = false;
    this.noiseRadius = 0;
    this.setLight(true, false);
    this.syncCamera(0);
  }

  setLight(on: boolean, notify = true): void {
    const next = on && this.battery > 2;
    if (next === this.lightOn) return;
    this.lightOn = next;
    this.flashlight.visible = next;
    if (notify) this.events.onLightToggle(next);
  }

  /** カメラの向きを外部から決める(テスト用の状態設定やジャンプスケア) */
  lookAt(target: THREE.Vector3): void {
    const dx = target.x - this.camera.position.x;
    const dy = target.y - this.camera.position.y;
    const dz = target.z - this.camera.position.z;
    this.yaw = Math.atan2(-dx, -dz);
    this.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    this.syncCamera(0);
  }

  update(
    delta: number,
    input: InputController,
    level: Level,
    tuning: PlayerTuning,
    context: { safe: boolean; lightOnMonster: boolean },
  ): void {
    const look = input.consumeLook();
    this.yaw -= look.dx * tuning.mouseSensitivity + look.turn * 2.4 * delta;
    this.pitch -= look.dy * tuning.mouseSensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.35, 1.35);

    if (input.consumePress('KeyF', 'MouseRight')) this.setLight(!this.lightOn);

    input.readMovement(this.move);
    const moving = this.move.lengthSq() > 0.01;
    const wantsSprint = input.isSprintHeld() && moving && this.move.y > -0.2;
    if (this.exhausted && this.stamina >= EXHAUSTED_UNTIL) this.exhausted = false;
    this.sprinting = wantsSprint && !this.exhausted && this.stamina > 0;
    if (this.sprinting) {
      this.stamina = Math.max(0, this.stamina - STAMINA_DRAIN * delta);
      if (this.stamina <= 0) this.exhausted = true;
    } else {
      this.stamina = Math.min(100, this.stamina + (STAMINA_REGEN + (context.safe ? SAFE_REGEN : 0)) * delta);
    }

    const speed = this.sprinting ? tuning.sprintSpeed : tuning.walkSpeed * (this.exhausted ? 0.75 : 1);
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // 前方 = (-sin, -cos)、右 = (cos, -sin)
    this.desired.set(
      (-sin * this.move.y + cos * this.move.x) * speed,
      0,
      (-cos * this.move.y - sin * this.move.x) * speed,
    );
    const blend = 1 - Math.exp(-tuning.acceleration * delta);
    this.velocity.lerp(this.desired, blend);
    const before = this.position.clone();
    this.position.addScaledVector(this.velocity, delta);
    level.resolveCollision(this.position, RADIUS);
    const moved = Math.hypot(this.position.x - before.x, this.position.z - before.z);
    // 壁に当たった分は速度も殺す
    if (delta > 0) {
      const actual = moved / delta;
      if (actual < this.velocity.length() * 0.5) this.velocity.multiplyScalar(0.5);
    }

    const horizontalSpeed = moved / Math.max(delta, 1e-4);
    this.noiseRadius = horizontalSpeed < 0.3 ? 0 : this.sprinting ? NOISE_SPRINT : NOISE_WALK;
    this.stepDistance += moved;
    const strideLength = this.sprinting ? 2.1 : 1.5;
    if (this.stepDistance > strideLength) {
      this.stepDistance = 0;
      this.events.onStep(this.sprinting);
    }

    // 電池
    if (this.lightOn) {
      this.battery -= (BATTERY_DRAIN + (context.lightOnMonster ? BATTERY_DRAIN_ON_MONSTER : 0)) * delta;
      if (this.battery <= 0) {
        this.battery = 0;
        this.setLight(false);
      }
    }
    if (context.safe) this.battery = Math.min(100, this.battery + SAFE_REGEN * delta);

    this.bobPhase += horizontalSpeed * delta * 2.1;
    this.flickerTime += delta;
    this.updateFlashlight(tuning);
    this.syncCamera(Math.min(1, horizontalSpeed / tuning.walkSpeed));
  }

  /** 懐中電灯の円錐の中に point があり、遮るものがないか。 */
  illuminates(point: THREE.Vector3, level: Level): boolean {
    if (!this.lightOn) return false;
    const origin = this.camera.position;
    const toPoint = point.clone().sub(origin);
    const distance = toPoint.length();
    if (distance > 16) return false;
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    const cos = forward.dot(toPoint.normalize());
    if (cos < Math.cos(this.flashlight.angle * 0.85)) return false;
    return level.hasLineOfSight(origin, point);
  }

  private updateFlashlight(tuning: PlayerTuning): void {
    let intensity = tuning.flashlightIntensity;
    if (this.battery < 20) {
      // 電池切れ間近はちらつく
      const t = this.flickerTime;
      const flicker = Math.sin(t * 31) * Math.sin(t * 7.3) * Math.sin(t * 2.1);
      if (flicker > 0.35) intensity *= 0.15;
      intensity *= 0.55 + this.battery / 45;
    }
    this.flashlight.intensity = intensity;
  }

  private syncCamera(bobAmount: number): void {
    const bob = Math.sin(this.bobPhase * 2) * 0.045 * bobAmount;
    const sway = Math.sin(this.bobPhase) * 0.03 * bobAmount;
    this.camera.position.set(this.position.x, EYE_HEIGHT + bob, this.position.z);
    this.camera.rotation.set(this.pitch, this.yaw, sway * 0.4, 'YXZ');
  }
}
