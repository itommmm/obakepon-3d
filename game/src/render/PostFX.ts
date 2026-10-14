import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/**
 * ホラー用の仕上げシェーダ: 色収差(危険度で強まる)、わずかな樽型歪み、彩度落とし、
 * 周辺減光、危険時の赤い脈動、フィルムグレイン。トーンマッピング後の表示色に掛ける。
 */
const HorrorShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uDanger: { value: 0 },
    uGrain: { value: 0.07 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uDanger;
    uniform float uGrain;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 uv = 0.5 + c * (1.0 - 0.035 * r2);
      vec2 dir = c / (sqrt(r2) + 1e-5);
      float shift = (0.0012 + uDanger * 0.007) * r2 * 4.0;
      vec3 col = vec3(
        texture2D(tDiffuse, uv + dir * shift).r,
        texture2D(tDiffuse, uv).g,
        texture2D(tDiffuse, uv - dir * shift).b
      );
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(luma), 0.12);
      float edge = smoothstep(0.25, 0.85, length(c) * 1.3);
      float pulse = 0.55 + 0.45 * sin(uTime * 7.0);
      col = mix(col, col * vec3(1.35, 0.25, 0.22) + vec3(0.06, 0.0, 0.0), uDanger * edge * pulse);
      col *= 1.0 - edge * 0.7;
      float grain = hash(vUv * vec2(1931.0, 1087.0) + fract(uTime * 7.31) * 113.0) - 0.5;
      col += grain * uGrain;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class PostFX {
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly horror: ShaderPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    // 目、非常灯、ヒューズ、出口サインなど「強く光るもの」だけがにじむように閾値を高めに
    this.bloom = new UnrealBloomPass(size.clone().multiplyScalar(0.5), 0.6, 0.4, 1.5);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.horror = new ShaderPass(HorrorShader);
    this.composer.addPass(this.horror);
  }

  setSize(renderer: THREE.WebGLRenderer): void {
    const canvas = renderer.domElement;
    this.composer.setPixelRatio(renderer.getPixelRatio());
    this.composer.setSize(canvas.clientWidth, canvas.clientHeight);
  }

  update(time: number, danger: number): void {
    this.horror.uniforms.uTime.value = time;
    this.horror.uniforms.uDanger.value = danger;
  }

  render(): void {
    this.composer.render();
  }

  dispose(): void {
    this.bloom.dispose();
    this.composer.dispose();
  }
}
