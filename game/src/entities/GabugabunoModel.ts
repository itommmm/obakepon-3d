import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createNameTagTexture } from '../world/textures';

export type EyeMode = 'patrol' | 'alert' | 'chase' | 'stunned';

export type ModelPose = {
  speed: number;
  chasing: boolean;
  alert: boolean;
  stunned: boolean;
  lit: boolean;
};

const HIP_HEIGHT = 1.95;
const BAG_W = 1.5;
const BAG_H = 1.7;
const BAG_D = 0.9;
/** ランドセル本体の中心の高さ */
const BAG_Y = HIP_HEIGHT + 0.25 + BAG_H / 2;
/** 口(かぶせの下端)の高さ。ジャンプスケアでカメラの高さに合わせる。 */
export const MOUTH_HEIGHT = BAG_Y - 0.15;

/**
 * ランドセルザメ・ガブガブーノ(手続き生成モデル)。
 * 赤いランドセルの「かぶせ」がサメのアゴ。白い靴下と上履きの、細長い人間の足で歩く。
 */
export class GabugabunoModel {
  readonly root = new THREE.Group();
  private readonly bag = new THREE.Group();
  private readonly jaw = new THREE.Group();
  private readonly legs: { hip: THREE.Group; knee: THREE.Group }[] = [];
  private readonly fins: THREE.Group[] = [];
  private readonly tail = new THREE.Group();
  private readonly eyeMaterial: THREE.MeshStandardMaterial;
  private readonly glow: THREE.PointLight;
  private readonly disposables: { dispose(): void }[] = [];
  private walkPhase = 0;
  private chompPhase = 0;
  private lastChompSign = 1;

  constructor(private readonly onChomp: () => void) {
    const leather = this.track(
      new THREE.MeshStandardMaterial({ color: '#b3141e', roughness: 0.38, metalness: 0.05 }),
    );
    const leatherDark = this.track(
      new THREE.MeshStandardMaterial({ color: '#8f0e17', roughness: 0.42, metalness: 0.05 }),
    );
    const gold = this.track(new THREE.MeshStandardMaterial({ color: '#d8b04a', roughness: 0.3, metalness: 0.9 }));
    const skin = this.track(new THREE.MeshStandardMaterial({ color: '#e6c3a2', roughness: 0.75 }));
    const white = this.track(new THREE.MeshStandardMaterial({ color: '#f1efe8', roughness: 0.8 }));
    const navy = this.track(new THREE.MeshStandardMaterial({ color: '#1f2a44', roughness: 0.85 }));
    const finMaterial = this.track(
      new THREE.MeshStandardMaterial({ color: '#6c7c93', roughness: 0.55, side: THREE.DoubleSide }),
    );
    const mouthMaterial = this.track(new THREE.MeshStandardMaterial({ color: '#3a0408', roughness: 0.6 }));
    const toothMaterial = this.track(new THREE.MeshStandardMaterial({ color: '#f3ecd9', roughness: 0.35 }));
    const black = this.track(new THREE.MeshStandardMaterial({ color: '#0b0909', roughness: 0.3 }));
    const strap = this.track(new THREE.MeshStandardMaterial({ color: '#2a0c0e', roughness: 0.6 }));

    // ---- 足(半ズボン + 細長い脚 + 白い靴下 + 上履き) ----
    const shorts = new THREE.Mesh(this.track(new RoundedBoxGeometry(0.95, 0.42, 0.6, 3, 0.1)), navy);
    shorts.position.y = HIP_HEIGHT + 0.08;
    shorts.castShadow = true;
    this.root.add(shorts);
    const thighGeometry = this.track(new THREE.CylinderGeometry(0.09, 0.075, 1.0, 10));
    thighGeometry.translate(0, -0.5, 0);
    const shinGeometry = this.track(new THREE.CylinderGeometry(0.075, 0.06, 0.95, 10));
    shinGeometry.translate(0, -0.475, 0);
    const sockGeometry = this.track(new THREE.CylinderGeometry(0.085, 0.08, 0.4, 10));
    sockGeometry.translate(0, -0.75, 0);
    const shoeGeometry = this.track(new RoundedBoxGeometry(0.2, 0.12, 0.38, 2, 0.05));
    const toeGeometry = this.track(new RoundedBoxGeometry(0.205, 0.08, 0.12, 2, 0.035));
    const toeColors = ['#c4262f', '#2f6fd1'];
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.3, HIP_HEIGHT, 0);
      const thigh = new THREE.Mesh(thighGeometry, skin);
      thigh.castShadow = true;
      hip.add(thigh);
      const knee = new THREE.Group();
      knee.position.y = -1.0;
      const shin = new THREE.Mesh(shinGeometry, skin);
      shin.castShadow = true;
      knee.add(shin);
      const sock = new THREE.Mesh(sockGeometry, white);
      knee.add(sock);
      const shoe = new THREE.Mesh(shoeGeometry, white);
      shoe.position.set(0, -0.92, 0.08);
      shoe.castShadow = true;
      knee.add(shoe);
      const toe = new THREE.Mesh(toeGeometry, this.track(new THREE.MeshStandardMaterial({ color: toeColors[side > 0 ? 1 : 0], roughness: 0.6 })));
      toe.position.set(0, -0.9, 0.24);
      knee.add(toe);
      hip.add(knee);
      this.root.add(hip);
      this.legs.push({ hip, knee });
    }

    // ---- ランドセル本体 ----
    this.bag.position.y = BAG_Y;
    const body = new THREE.Mesh(this.track(new RoundedBoxGeometry(BAG_W, BAG_H, BAG_D, 4, 0.2)), leather);
    body.castShadow = true;
    body.receiveShadow = true;
    this.bag.add(body);
    // 口の中(アゴを開けると見える)
    const mouth = new THREE.Mesh(this.track(new THREE.PlaneGeometry(BAG_W - 0.25, 1.0)), mouthMaterial);
    mouth.position.set(0, -0.1, BAG_D / 2 + 0.005);
    this.bag.add(mouth);
    // 下の歯(本体の前面下側、上向き)
    const toothGeometry = this.track(new THREE.ConeGeometry(0.055, 0.2, 6));
    for (let i = 0; i < 9; i += 1) {
      const tooth = new THREE.Mesh(toothGeometry, toothMaterial);
      tooth.position.set(-0.58 + i * 0.145, -0.52, BAG_D / 2 + 0.06);
      this.bag.add(tooth);
    }
    // 背負いベルト(背中)
    const strapGeometry = this.track(new THREE.TorusGeometry(0.45, 0.05, 6, 20, Math.PI));
    for (const side of [-1, 1]) {
      const loop = new THREE.Mesh(strapGeometry, strap);
      loop.rotation.set(0, Math.PI / 2, Math.PI / 2);
      loop.position.set(side * 0.38, 0.05, -BAG_D / 2 - 0.02);
      this.bag.add(loop);
    }
    // 側面のエラ
    const gill = this.track(new THREE.BoxGeometry(0.02, 0.45, 0.05));
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i += 1) {
        const slit = new THREE.Mesh(gill, black);
        slit.position.set(side * (BAG_W / 2 + 0.005), 0.05, 0.15 - i * 0.14);
        slit.rotation.x = 0.15;
        this.bag.add(slit);
      }
    }
    // 名札
    const tag = new THREE.Mesh(
      this.track(new THREE.PlaneGeometry(0.5, 0.25)),
      this.track(new THREE.MeshStandardMaterial({ map: this.track(createNameTagTexture()), roughness: 0.7 })),
    );
    tag.rotation.y = Math.PI / 2;
    tag.position.set(BAG_W / 2 + 0.01, -0.45, -0.1);
    this.bag.add(tag);

    // 背びれ
    const dorsalShape = new THREE.Shape();
    dorsalShape.moveTo(-0.45, 0);
    dorsalShape.quadraticCurveTo(-0.1, 0.25, 0.25, 0.95);
    dorsalShape.quadraticCurveTo(0.2, 0.35, 0.45, 0);
    dorsalShape.closePath();
    const dorsal = new THREE.Mesh(
      this.track(new THREE.ExtrudeGeometry(dorsalShape, { depth: 0.08, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 1 })),
      finMaterial,
    );
    dorsal.rotation.y = Math.PI / 2;
    dorsal.position.set(-0.04, BAG_H / 2 - 0.05, 0);
    dorsal.castShadow = true;
    this.bag.add(dorsal);

    // 胸びれ(腕の代わり)
    const pectoralShape = new THREE.Shape();
    pectoralShape.moveTo(0, 0.18);
    pectoralShape.quadraticCurveTo(0.5, 0.05, 0.85, -0.55);
    pectoralShape.quadraticCurveTo(0.35, -0.2, 0, -0.18);
    pectoralShape.closePath();
    const pectoralGeometry = this.track(new THREE.ShapeGeometry(pectoralShape));
    for (const side of [-1, 1]) {
      const fin = new THREE.Group();
      fin.position.set(side * (BAG_W / 2), -0.2, 0.15);
      const mesh = new THREE.Mesh(pectoralGeometry, finMaterial);
      mesh.scale.x = side;
      mesh.rotation.y = side * 0.3;
      mesh.castShadow = true;
      fin.add(mesh);
      this.bag.add(fin);
      this.fins.push(fin);
    }

    // 尾びれ(背中側)
    const tailShape = new THREE.Shape();
    tailShape.moveTo(0, 0);
    tailShape.quadraticCurveTo(0.35, 0.3, 0.55, 0.75);
    tailShape.quadraticCurveTo(0.3, 0.15, 0.3, 0);
    tailShape.quadraticCurveTo(0.3, -0.15, 0.5, -0.5);
    tailShape.quadraticCurveTo(0.3, -0.25, 0, 0);
    const tailMesh = new THREE.Mesh(this.track(new THREE.ShapeGeometry(tailShape)), finMaterial);
    tailMesh.rotation.y = Math.PI / 2;
    this.tail.add(tailMesh);
    this.tail.position.set(0, -0.4, -BAG_D / 2 - 0.05);
    this.bag.add(this.tail);

    // ---- かぶせ(アゴ)。上端の蝶番で開く ----
    this.jaw.position.set(0, BAG_H / 2 - 0.02, BAG_D / 2 - 0.02);
    const flap = new THREE.Mesh(this.track(new RoundedBoxGeometry(BAG_W + 0.04, 1.3, 0.1, 3, 0.045)), leatherDark);
    flap.position.set(0, -0.62, 0.05);
    flap.castShadow = true;
    this.jaw.add(flap);
    const flapTop = new THREE.Mesh(this.track(new RoundedBoxGeometry(BAG_W + 0.04, 0.1, 0.55, 3, 0.045)), leatherDark);
    flapTop.position.set(0, 0.02, -0.22);
    this.jaw.add(flapTop);
    const clasp = new THREE.Mesh(this.track(new RoundedBoxGeometry(0.22, 0.14, 0.06, 2, 0.02)), gold);
    clasp.position.set(0, -1.18, 0.11);
    this.jaw.add(clasp);
    // 上の歯(かぶせの裏側の下端、下向き)。閉じていても少しはみ出す。
    for (let i = 0; i < 10; i += 1) {
      const tooth = new THREE.Mesh(toothGeometry, toothMaterial);
      tooth.rotation.x = Math.PI;
      tooth.position.set(-0.65 + i * 0.145, -1.28, 0.0);
      this.jaw.add(tooth);
    }
    // サメの目(かぶせの上の方)
    this.eyeMaterial = this.track(
      new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#dfe8ff', emissiveIntensity: 1.6 }),
    );
    const eyeball = this.track(new THREE.SphereGeometry(0.16, 16, 12));
    const pupil = this.track(new THREE.SphereGeometry(0.055, 10, 8));
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(eyeball, black);
      eye.scale.set(1, 1, 0.45);
      eye.position.set(side * 0.46, -0.32, 0.1);
      this.jaw.add(eye);
      const glint = new THREE.Mesh(pupil, this.eyeMaterial);
      glint.position.set(side * 0.43, -0.3, 0.17);
      this.jaw.add(glint);
    }
    this.bag.add(this.jaw);
    this.root.add(this.bag);

    this.glow = new THREE.PointLight('#ff2a2a', 0, 6, 1.5);
    this.glow.position.set(0, MOUTH_HEIGHT + 0.3, 1.3);
    this.root.add(this.glow);
    this.setEyes('patrol');
  }

  reset(): void {
    this.root.position.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);
    this.bag.rotation.set(0, 0, 0);
    this.jaw.rotation.set(0, 0, 0);
    for (const fin of this.fins) fin.rotation.set(0, 0, 0);
    for (const leg of this.legs) {
      leg.hip.rotation.set(0, 0, 0);
      leg.knee.rotation.set(0, 0, 0);
    }
    this.setEyes('patrol');
  }

  setEyes(mode: EyeMode): void {
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

  /** ジャンプスケア: 口をカメラの高さまで下げ、大きく開く。 */
  poseScare(amount: number, eyeHeight: number): void {
    this.root.position.y = eyeHeight - MOUTH_HEIGHT;
    this.root.position.z = -0.2;
    this.bag.rotation.x = -0.15 * amount;
    this.jaw.rotation.x = -(0.1 + amount * 0.7);
    for (const [index, fin] of this.fins.entries()) {
      const side = index === 0 ? -1 : 1;
      fin.rotation.set(-0.9 * amount, 0, side * 0.7 * amount);
    }
    this.setEyes('chase');
    this.eyeMaterial.emissiveIntensity = 6;
    this.glow.intensity = 8;
  }

  update(delta: number, elapsed: number, pose: ModelPose): void {
    const moving = Math.min(1, pose.speed / 2);
    this.walkPhase += delta * (2.2 + pose.speed * 1.5);
    const stride = Math.sin(this.walkPhase);
    // 細長い脚の歩行(股関節の振り + 膝の曲げ)
    this.legs.forEach((leg, index) => {
      const phase = index === 0 ? stride : -stride;
      leg.hip.rotation.x = THREE.MathUtils.damp(leg.hip.rotation.x, phase * 0.55 * moving, 12, delta);
      const bend = Math.max(0, -phase) * 0.9 * moving + (pose.stunned ? 0.5 : 0);
      leg.knee.rotation.x = THREE.MathUtils.damp(leg.knee.rotation.x, bend, 12, delta);
    });
    this.root.position.y = Math.abs(Math.cos(this.walkPhase)) * 0.12 * moving - (pose.stunned ? 0.25 : 0);
    this.bag.rotation.z = Math.sin(this.walkPhase) * 0.07 * moving;
    this.bag.rotation.x = THREE.MathUtils.damp(this.bag.rotation.x, pose.chasing ? 0.2 : pose.stunned ? 0.35 : 0, 4, delta);

    // アゴ: 追跡中は「ガブガブ」と噛み鳴らす。徘徊中はゆっくり呼吸。
    let jawTarget: number;
    if (pose.chasing || pose.alert) {
      this.chompPhase += delta * 7.5;
      const s = Math.sin(this.chompPhase);
      jawTarget = -(0.12 + Math.max(0, s) * 0.55);
      const sign = s >= 0 ? 1 : -1;
      if (sign < 0 && this.lastChompSign > 0) this.onChomp();
      this.lastChompSign = sign;
    } else if (pose.stunned) {
      jawTarget = -0.6;
    } else {
      jawTarget = -(0.04 + Math.max(0, Math.sin(elapsed * 0.9)) * 0.08);
    }
    this.jaw.rotation.x = THREE.MathUtils.damp(this.jaw.rotation.x, jawTarget, 18, delta);

    // ひれ: 歩くとパタパタ、追跡中は前に構える
    const reach = pose.chasing ? -0.9 : pose.alert ? -0.4 : 0;
    this.fins.forEach((fin, index) => {
      const side = index === 0 ? -1 : 1;
      const flap = Math.sin(elapsed * (pose.chasing ? 14 : 5) + index) * (pose.chasing ? 0.35 : 0.15);
      fin.rotation.x = THREE.MathUtils.damp(fin.rotation.x, reach, 6, delta);
      fin.rotation.z = side * (0.25 + flap);
    });
    this.tail.rotation.y = Math.sin(elapsed * 3 + this.walkPhase) * 0.4;

    // 光に怯んで震える
    this.bag.position.x = pose.lit && (pose.chasing || pose.alert) ? Math.sin(elapsed * 55) * 0.05 : 0;
    if (pose.stunned) this.bag.rotation.z = Math.sin(elapsed * 30) * 0.04;
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
  }

  private track<T extends { dispose(): void }>(item: T): T {
    this.disposables.push(item);
    return item;
  }
}
