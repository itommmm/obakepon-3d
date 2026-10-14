import * as THREE from 'three';

/**
 * 組み込みマテリアル(MeshStandard / MeshPhysical)を onBeforeCompile で拡張する
 * (threejs-shaders スキルの「Extending Built-in Materials」パターン)。
 *
 * - 手続きバンプ: オブジェクト空間の FBM を高さとして、画面空間の微分で法線を揺らす
 *   (テクスチャ不要。革のシボや布目を表現する)
 * - リムライト: 輪郭だけをうっすら光らせて、暗闇でもシルエットを読ませる
 */
export type SurfaceDetailOptions = {
  /** ノイズの細かさ(1m あたりの周波数) */
  scale: number;
  /** 凹凸の強さ */
  strength: number;
  rimColor?: THREE.ColorRepresentation;
  rimPower?: number;
};

export type SurfaceDetailHandle = {
  setRim(intensity: number, color?: THREE.ColorRepresentation): void;
};

const NOISE_GLSL = /* glsl */ `
  varying vec3 vDetailPos;
  uniform float uDetailScale;
  uniform float uDetailStrength;
  uniform vec3 uRimColor;
  uniform float uRimIntensity;
  uniform float uRimPower;

  float detailHash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float detailNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(detailHash(i + vec3(0, 0, 0)), detailHash(i + vec3(1, 0, 0)), f.x),
          mix(detailHash(i + vec3(0, 1, 0)), detailHash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(detailHash(i + vec3(0, 0, 1)), detailHash(i + vec3(1, 0, 1)), f.x),
          mix(detailHash(i + vec3(0, 1, 1)), detailHash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }

  float detailFbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * detailNoise(p);
      p = p * 2.03 + vec3(1.7, 9.2, 4.1);
      a *= 0.5;
    }
    return v;
  }

  vec3 detailPerturbNormal(vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir) {
    vec3 sigmaX = normalize(dFdx(surfPos));
    vec3 sigmaY = normalize(dFdy(surfPos));
    vec3 r1 = cross(sigmaY, surfNorm);
    vec3 r2 = cross(surfNorm, sigmaX);
    float det = dot(sigmaX, r1) * faceDir;
    vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
    return normalize(abs(det) * surfNorm - grad);
  }
`;

export function applySurfaceDetail(
  material: THREE.MeshStandardMaterial,
  options: SurfaceDetailOptions,
): SurfaceDetailHandle {
  const uniforms = {
    uDetailScale: { value: options.scale },
    uDetailStrength: { value: options.strength },
    uRimColor: { value: new THREE.Color(options.rimColor ?? '#ff2a2a') },
    uRimIntensity: { value: 0 },
    uRimPower: { value: options.rimPower ?? 3 },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDetailPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDetailPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE_GLSL}`)
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
        {
          float h = detailFbm(vDetailPos * uDetailScale);
          vec2 dHdxy = vec2(dFdx(h), dFdy(h)) * uDetailStrength;
          normal = detailPerturbNormal(-vViewPosition, normal, dHdxy, faceDirection);
        }`,
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `{
          float rim = 1.0 - saturate(dot(normal, normalize(vViewPosition)));
          outgoingLight += uRimColor * uRimIntensity * pow(rim, uRimPower);
        }
        #include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => `surface-detail-${options.scale}-${options.strength}`;
  return {
    setRim(intensity, color) {
      uniforms.uRimIntensity.value = intensity;
      if (color !== undefined) uniforms.uRimColor.value.set(color);
    },
  };
}
