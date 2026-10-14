import * as THREE from 'three';
import {
  Sculpt,
  sdCapsule,
  sdEllipsoid,
  sdRoundBox,
  sdRoundCone,
  sdSphere,
  transform,
  type Field,
} from '../render/sdf';
import { applySurfaceDetail, type SurfaceDetailHandle } from '../render/surfaceDetail';
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
const BAG_H = 1.7;
const BAG_D = 0.9;
/** ランドセル本体の中心の高さ */
const BAG_Y = HIP_HEIGHT + 0.25 + BAG_H / 2;
/** 口の高さ。ジャンプスケアでカメラの高さに合わせる。 */
export const MOUTH_HEIGHT = BAG_Y - 0.15;

const RED = '#b3141e';
const RED_DARK = '#8a0d16';
const FIN = '#6c7c93';
const FIN_BELLY = '#c9cfd8';
const MOUTH = '#3a0408';
const TOOTH = '#f3ecd9';
const GOLD = '#d8b04a';
const SKIN = '#e6c3a2';
const WHITE = '#f1efe8';
const NAVY = '#1f2a44';
const STRAP = '#2a0c0e';

/** 平べったいひれの形(根元 → 先端に向かって細くなる板)。 */
function finField(root: [number, number, number], tip: [number, number, number], r1: number, r2: number, flatten: [number, number, number]): Field {
  return transform(sdRoundCone([0, 0, 0], [tip[0] - root[0], tip[1] - root[1], tip[2] - root[2]], r1, r2), {
    at: root,
    scale: flatten,
  });
}

/** 本体: ランドセル + 背びれ + 尾びれ + エラ + 口の中 + 下の歯 + 背負いベルト */
function sculptBody(): THREE.BufferGeometry {
  // 使い込んだランドセルの革のシワ(FBM の凹凸)
  const s = new Sculpt().roughen(0.014, 4.5);
  s.add(sdRoundBox([0, 0, 0], [0.75, 0.85, 0.45], 0.22), RED);
  // ランドセルらしい、丸く盛り上がった天面
  s.add(sdEllipsoid([0, 0.7, -0.04], [0.72, 0.26, 0.43]), RED, 0.12);
  // 背びれ(体からなめらかに生える)
  s.add(finField([0, 0.82, -0.02], [0, 1.72, -0.42], 0.34, 0.02, [0.28, 1, 1]), FIN, 0.16);
  // 尾びれ(背中側の下)
  s.add(sdCapsule([0, -0.4, -0.38], [0, -0.42, -0.72], 0.13), FIN, 0.1);
  s.add(transform(sdEllipsoid([0, 0, 0], [0.05, 0.42, 0.13]), { at: [0, -0.1, -0.86], rotate: [-0.6, 0, 0] }), FIN, 0.06);
  s.add(transform(sdEllipsoid([0, 0, 0], [0.05, 0.28, 0.11]), { at: [0, -0.68, -0.8], rotate: [0.7, 0, 0] }), FIN, 0.06);
  // 背負いベルト
  for (const x of [-0.36, 0.36]) {
    s.add(sdCapsule([x, 0.55, -0.47], [x, 0.0, -0.56], 0.055), STRAP, 0.03);
    s.add(sdCapsule([x, 0.0, -0.56], [x, -0.55, -0.47], 0.055), STRAP, 0.03);
  }
  // 側面のエラ(3本ずつ削る)
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i += 1) {
      s.carve(
        transform(sdRoundBox([0, 0, 0], [0.06, 0.24, 0.014], 0.01), { at: [side * 0.76, 0.08, 0.16 - i * 0.15], rotate: [0.18, 0, 0] }),
        '#1a0606',
        0.015,
      );
    }
  }
  // 口(かぶせの下に隠れている大きな空洞)
  s.carve(sdRoundBox([0, -0.18, 0.47], [0.62, 0.42, 0.24], 0.1), MOUTH, 0.04);
  // 下の歯: 口の下縁から上向きに生える
  for (let i = 0; i < 9; i += 1) {
    const x = -0.56 + i * 0.14;
    s.add(sdRoundCone([x, -0.56, 0.36], [x, -0.33, 0.38], 0.06, 0.006), TOOTH, 0.02);
  }
  return s.mesh([-0.95, -1.15, -1.05], [0.95, 1.8, 0.75], 0.03);
}

/** かぶせ(アゴ): 蝶番 = 原点。少し反った板 + 上の歯 + 留め金 + 目のくぼみ */
function sculptJaw(): THREE.BufferGeometry {
  const s = new Sculpt().roughen(0.01, 5);
  const flap = sdRoundBox([0, -0.63, 0.06], [0.78, 0.66, 0.05], 0.04);
  // 下にいくほど前に反らせる
  s.add((x, y, z) => flap(x, y, z + 0.1 * ((y + 0.63) / 0.66) ** 2), RED_DARK);
  s.add(sdRoundBox([0, 0.02, -0.24], [0.78, 0.055, 0.28], 0.04), RED_DARK, 0.04);
  // ふちのステッチ風の盛り上がり
  s.add((x, y, z) => {
    const outer = Math.max(Math.abs(x) - 0.74, Math.abs(y + 0.63) - 0.62);
    return Math.max(Math.abs(outer) - 0.015, Math.abs(z - 0.115 - 0.1 * ((y + 0.63) / 0.66) ** 2) - 0.012);
  }, '#5c0a10', 0.01);
  s.add(sdRoundBox([0, -1.18, 0.21], [0.12, 0.075, 0.035], 0.02), GOLD, 0.01);
  // 上の歯(かぶせの下縁から下向き)
  for (let i = 0; i < 10; i += 1) {
    const x = -0.63 + i * 0.14;
    s.add(sdRoundCone([x, -1.22, 0.12], [x, -1.47, 0.1], 0.062, 0.006), TOOTH, 0.02);
  }
  // 目のくぼみ
  for (const side of [-1, 1]) s.carve(sdSphere([side * 0.46, -0.32, 0.2], 0.17), '#0b0909', 0.03);
  return s.mesh([-0.9, -1.55, -0.6], [0.9, 0.15, 0.32], 0.025);
}

/** 胸びれ(原点 = 付け根)。下向きに垂れる。 */
function sculptPectoral(): THREE.BufferGeometry {
  const s = new Sculpt();
  s.add(finField([0, 0, 0], [0.62, -0.62, 0.1], 0.28, 0.035, [1, 1, 0.24]), FIN);
  s.add(finField([0.02, -0.04, 0.03], [0.5, -0.55, 0.12], 0.2, 0.02, [1, 1, 0.16]), FIN_BELLY, 0.02);
  return s.mesh([-0.32, -0.95, -0.25], [0.95, 0.35, 0.3], 0.02);
}

/** 半ズボン(原点 = 腰) */
function sculptShorts(): THREE.BufferGeometry {
  const s = new Sculpt();
  s.add(sdRoundBox([0, 0.08, 0], [0.48, 0.22, 0.3], 0.12), NAVY);
  for (const x of [-0.3, 0.3]) s.add(sdRoundCone([x, 0.0, 0], [x, -0.22, 0], 0.17, 0.15), NAVY, 0.06);
  return s.mesh([-0.65, -0.45, -0.45], [0.65, 0.4, 0.45], 0.025);
}

/** 太もも(原点 = 股関節) */
function sculptThigh(): THREE.BufferGeometry {
  const s = new Sculpt();
  s.add(sdRoundCone([0, 0, 0], [0, -1.0, 0], 0.095, 0.072), SKIN);
  s.add(sdSphere([0, -1.0, 0.01], 0.085), SKIN, 0.04);
  return s.mesh([-0.15, -1.15, -0.15], [0.15, 0.12, 0.15], 0.018);
}

/** すね + 白い靴下 + 上履き(原点 = 膝) */
function sculptShin(toe: string): THREE.BufferGeometry {
  const s = new Sculpt();
  s.add(sdRoundCone([0, 0, 0], [0, -0.82, 0], 0.075, 0.058), SKIN);
  s.add(sdRoundCone([0, -0.5, 0], [0, -0.86, 0], 0.083, 0.07), WHITE, 0.02);
  s.add(sdRoundBox([0, -0.94, 0.08], [0.1, 0.065, 0.19], 0.055), WHITE, 0.04);
  s.add(sdRoundBox([0, -0.95, 0.22], [0.106, 0.05, 0.075], 0.04), toe, 0.01);
  s.add(sdRoundBox([0, -0.995, 0.08], [0.108, 0.018, 0.205], 0.015), '#9a958b', 0.005);
  return s.mesh([-0.16, -1.05, -0.2], [0.16, 0.1, 0.36], 0.016);
}

/**
 * ランドセルザメ・ガブガブーノ(SDF スカルプトで生成するモデル)。
 * 赤いランドセルの「かぶせ」がサメのアゴ。白い靴下と上履きの、細長い人間の足で歩く。
 */
export class GabugabunoModel {
  readonly root = new THREE.Group();
  private readonly bag = new THREE.Group();
  private readonly jaw = new THREE.Group();
  private readonly legs: { hip: THREE.Group; knee: THREE.Group }[] = [];
  private readonly fins: THREE.Group[] = [];
  private readonly eyeMaterial: THREE.MeshStandardMaterial;
  private readonly glow: THREE.PointLight;
  private readonly rims: SurfaceDetailHandle[] = [];
  private readonly disposables: { dispose(): void }[] = [];
  private walkPhase = 0;
  private chompPhase = 0;
  private lastChompSign = 1;

  constructor(private readonly onChomp: () => void) {
    // 革のつや(クリアコート)と、肌や布のマットさを頂点カラー1枚で兼ねる
    const leather = this.track(
      new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.48, clearcoat: 0.55, clearcoatRoughness: 0.35 }),
    );
    const matte = this.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78 }));
    // 革のシボ / 布目の細かい凹凸と、輪郭のリムライト(threejs-shaders の onBeforeCompile 拡張)
    this.rims.push(applySurfaceDetail(leather, { scale: 22, strength: 0.35, rimPower: 2.5 }));
    this.rims.push(applySurfaceDetail(matte, { scale: 55, strength: 0.18, rimPower: 2.5 }));
    const add = (parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material) => {
      const mesh = new THREE.Mesh(this.track(geometry), material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };

    // ---- 足 ----
    const shorts = new THREE.Group();
    shorts.position.y = HIP_HEIGHT;
    add(shorts, sculptShorts(), matte);
    this.root.add(shorts);
    const thigh = sculptThigh();
    const toeColors = ['#c4262f', '#2f6fd1'];
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.3, HIP_HEIGHT, 0);
      add(hip, side < 0 ? thigh : thigh.clone(), matte);
      const knee = new THREE.Group();
      knee.position.y = -1.0;
      add(knee, sculptShin(toeColors[side < 0 ? 0 : 1]), matte);
      hip.add(knee);
      this.root.add(hip);
      this.legs.push({ hip, knee });
    }

    // ---- ランドセル本体 ----
    this.bag.position.y = BAG_Y;
    add(this.bag, sculptBody(), leather);
    const tag = new THREE.Mesh(
      this.track(new THREE.PlaneGeometry(0.46, 0.23)),
      this.track(new THREE.MeshStandardMaterial({ map: this.track(createNameTagTexture()), roughness: 0.7 })),
    );
    tag.rotation.y = Math.PI / 2;
    tag.position.set(0.776, -0.5, -0.12);
    this.bag.add(tag);

    const pectoral = sculptPectoral();
    for (const side of [-1, 1]) {
      const fin = new THREE.Group();
      fin.position.set(side * 0.72, -0.22, 0.12);
      const mesh = add(fin, side < 0 ? pectoral : pectoral.clone(), matte);
      mesh.scale.x = side;
      this.bag.add(fin);
      this.fins.push(fin);
    }

    // ---- かぶせ(アゴ) ----
    this.jaw.position.set(0, BAG_H / 2 - 0.02, BAG_D / 2 - 0.08);
    add(this.jaw, sculptJaw(), leather);
    this.eyeMaterial = this.track(
      new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#dfe8ff', emissiveIntensity: 1.6, roughness: 0.2 }),
    );
    const eyeball = this.track(new THREE.SphereGeometry(0.13, 20, 14));
    const pupil = this.track(new THREE.SphereGeometry(0.05, 12, 10));
    const glossy = this.track(new THREE.MeshPhysicalMaterial({ color: '#050404', roughness: 0.1, clearcoat: 1 }));
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(eyeball, glossy);
      eye.position.set(side * 0.46, -0.32, 0.13);
      this.jaw.add(eye);
      const glint = new THREE.Mesh(pupil, this.eyeMaterial);
      glint.position.set(side * 0.43, -0.29, 0.24);
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
      alert: ['#ffe9a8', '#ffc23a', 3, 1.5],
      chase: ['#ff6a6a', '#ff1414', 6, 5],
      stunned: ['#555', '#222', 0.2, 0],
    } as const;
    const [color, emissive, intensity, glow] = colors[mode];
    this.eyeMaterial.color.set(color);
    this.eyeMaterial.emissive.set(emissive);
    this.eyeMaterial.emissiveIntensity = intensity;
    this.glow.intensity = glow;
    // 追跡中は輪郭が赤く浮かび、徘徊中はうっすら青白く
    const rim = { patrol: [0.05, '#9fb6ff'], alert: [0.12, '#ffc23a'], chase: [0.35, '#ff2020'], stunned: [0, '#000000'] } as const;
    for (const handle of this.rims) handle.setRim(rim[mode][0], rim[mode][1]);
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
    this.eyeMaterial.emissiveIntensity = 9;
    this.glow.intensity = 3.5;
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
      fin.rotation.z = side * flap;
    });

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
