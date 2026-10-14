import * as THREE from 'three';

let haloTexture: THREE.CanvasTexture | null = null;

function getHaloTexture(): THREE.CanvasTexture {
  if (haloTexture) return haloTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create halo texture.');
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255, 220, 120, 0.9)');
  gradient.addColorStop(0.3, 'rgba(255, 180, 60, 0.35)');
  gradient.addColorStop(1, 'rgba(255, 160, 40, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  haloTexture = new THREE.CanvasTexture(canvas);
  haloTexture.colorSpace = THREE.SRGBColorSpace;
  return haloTexture;
}

/** 床に落ちている大きな工業用ヒューズ。暗闇でもぼんやり光って見える。 */
export class Fuse {
  readonly group = new THREE.Group();
  active = true;
  private readonly model = new THREE.Group();
  private readonly halo: THREE.Sprite;
  private readonly disposables: { dispose(): void }[] = [];

  constructor(
    readonly index: number,
    readonly home: THREE.Vector3,
  ) {
    const glass = new THREE.MeshStandardMaterial({
      color: '#ffd77a',
      emissive: '#ffae2a',
      emissiveIntensity: 1.8,
      roughness: 0.15,
      metalness: 0,
      transparent: true,
      opacity: 0.9,
    });
    const metal = new THREE.MeshStandardMaterial({ color: '#b8b2a6', roughness: 0.35, metalness: 0.85 });
    const tube = new THREE.CylinderGeometry(0.08, 0.08, 0.32, 16);
    const cap = new THREE.CylinderGeometry(0.1, 0.1, 0.08, 16);
    this.disposables.push(glass, metal, tube, cap);
    const core = new THREE.Mesh(tube, glass);
    this.model.add(core);
    for (const y of [-0.19, 0.19]) {
      const end = new THREE.Mesh(cap, metal);
      end.position.y = y;
      end.castShadow = true;
      this.model.add(end);
    }
    this.model.rotation.z = Math.PI / 2.4;
    this.group.add(this.model);

    const spriteMaterial = new THREE.SpriteMaterial({
      map: getHaloTexture(),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    this.disposables.push(spriteMaterial);
    this.halo = new THREE.Sprite(spriteMaterial);
    this.halo.scale.setScalar(1.3);
    this.group.add(this.halo);
    this.group.position.copy(home);
  }

  update(elapsed: number): void {
    if (!this.active) return;
    this.model.position.y = Math.sin(elapsed * 2 + this.index) * 0.05;
    this.model.rotation.y = elapsed * 0.8 + this.index;
    this.halo.material.opacity = 0.65 + Math.sin(elapsed * 3.1 + this.index) * 0.25;
  }

  stabilize(): void {
    this.model.position.y = 0;
    this.model.rotation.y = this.index;
    this.halo.material.opacity = 0.8;
  }

  collect(): void {
    this.active = false;
    this.group.visible = false;
  }

  reset(): void {
    this.active = true;
    this.group.visible = true;
    this.group.position.copy(this.home);
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
  }
}
