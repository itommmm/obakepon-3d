import * as THREE from 'three';

const BEAM_LENGTH = 11;
const DUST_COUNT = 420;
const DUST_BOX = 9;

/**
 * 懐中電灯の「光の筋」(加算合成の円錐)と、光の中だけに浮かぶチリ。
 * どちらもシェーダだけで描く(テクスチャ不要)。
 */
export class FlashlightBeam {
  readonly cone: THREE.Mesh;
  readonly dust: THREE.Points;
  private readonly coneMaterial: THREE.ShaderMaterial;
  private readonly dustMaterial: THREE.ShaderMaterial;
  private readonly lightPos = new THREE.Vector3();
  private readonly lightDir = new THREE.Vector3();

  constructor(angle: number) {
    const radius = Math.tan(angle * 0.92) * BEAM_LENGTH;
    const geometry = new THREE.ConeGeometry(radius, BEAM_LENGTH, 40, 1, true);
    // 頂点(光源)を原点に、-z 方向へ伸ばす
    geometry.translate(0, -BEAM_LENGTH / 2, 0);
    geometry.rotateX(Math.PI / 2);
    this.coneMaterial = new THREE.ShaderMaterial({
      uniforms: { uIntensity: { value: 1 }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying float vDepth;
        varying vec3 vNormalV;
        varying vec3 vViewDir;
        varying vec3 vLocal;
        void main() {
          vDepth = clamp(-position.z / ${BEAM_LENGTH.toFixed(1)}, 0.0, 1.0);
          vLocal = position;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vNormalV = normalize(normalMatrix * normal);
          vViewDir = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uIntensity;
        uniform float uTime;
        varying float vDepth;
        varying vec3 vNormalV;
        varying vec3 vViewDir;
        varying vec3 vLocal;
        void main() {
          float facing = abs(dot(normalize(vNormalV), normalize(vViewDir)));
          float falloff = pow(1.0 - vDepth, 1.8) * smoothstep(0.0, 0.08, vDepth);
          float swirl = 0.75 + 0.25 * sin(vLocal.z * 1.7 + uTime * 0.6) * sin(vLocal.x * 3.1 - uTime * 0.4);
          float a = facing * facing * falloff * swirl * 0.085 * uIntensity;
          gl_FragColor = vec4(vec3(1.0, 0.86, 0.62) * a, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.cone = new THREE.Mesh(geometry, this.coneMaterial);
    this.cone.frustumCulled = false;
    this.cone.renderOrder = 10;

    // チリ: カメラの周りの箱の中を漂い、光の円錐の中にあるときだけ光る
    const positions = new Float32Array(DUST_COUNT * 3);
    const seeds = new Float32Array(DUST_COUNT);
    let state = 1234567;
    const random = () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
    for (let i = 0; i < DUST_COUNT; i += 1) {
      positions[i * 3] = random() * DUST_BOX;
      positions[i * 3 + 1] = random() * DUST_BOX;
      positions[i * 3 + 2] = random() * DUST_BOX;
      seeds[i] = random();
    }
    const dustGeometry = new THREE.BufferGeometry();
    dustGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    dustGeometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
    this.dustMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uCamera: { value: new THREE.Vector3() },
        uLightPos: { value: this.lightPos },
        uLightDir: { value: this.lightDir },
        uCos: { value: Math.cos(angle) },
        uTime: { value: 0 },
        uIntensity: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute float seed;
        uniform vec3 uCamera;
        uniform vec3 uLightPos;
        uniform vec3 uLightDir;
        uniform float uCos;
        uniform float uTime;
        varying float vBright;
        void main() {
          float box = ${DUST_BOX.toFixed(1)};
          vec3 drift = vec3(sin(uTime * 0.13 + seed * 40.0), -0.05 * uTime, cos(uTime * 0.11 + seed * 30.0)) * 0.6;
          vec3 world = mod(position + drift - uCamera + box * 0.5, box) - box * 0.5 + uCamera;
          vec3 toP = world - uLightPos;
          float along = dot(toP, uLightDir);
          float cosA = along / max(length(toP), 1e-4);
          float inBeam = smoothstep(uCos, uCos + 0.04, cosA) * step(0.3, along) * (1.0 - smoothstep(4.0, 9.0, along));
          vBright = inBeam * (0.5 + 0.5 * sin(uTime * 2.0 + seed * 20.0));
          vec4 mv = viewMatrix * vec4(world, 1.0);
          gl_PointSize = clamp(2.2 * (5.0 / -mv.z), 1.0, 5.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uIntensity;
        varying float vBright;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = 1.0 - smoothstep(0.1, 0.5, length(c));
          float a = d * vBright * 0.7 * uIntensity;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vec3(1.0, 0.9, 0.7) * a, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.dust = new THREE.Points(dustGeometry, this.dustMaterial);
    this.dust.frustumCulled = false;
  }

  /** 毎フレーム: 光源のワールド位置と向き、明るさ(0..1)を渡す */
  update(camera: THREE.Camera, light: THREE.SpotLight, intensity01: number, time: number): void {
    light.getWorldPosition(this.lightPos);
    light.target.getWorldPosition(this.lightDir).sub(this.lightPos).normalize();
    this.cone.visible = intensity01 > 0.01 && light.visible;
    this.dust.visible = this.cone.visible;
    this.coneMaterial.uniforms.uIntensity.value = intensity01;
    this.coneMaterial.uniforms.uTime.value = time;
    this.dustMaterial.uniforms.uIntensity.value = intensity01;
    this.dustMaterial.uniforms.uTime.value = time;
    (this.dustMaterial.uniforms.uCamera.value as THREE.Vector3).copy(camera.position);
  }

  dispose(): void {
    this.cone.geometry.dispose();
    this.coneMaterial.dispose();
    this.dust.geometry.dispose();
    this.dustMaterial.dispose();
  }
}
