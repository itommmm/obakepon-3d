import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL, LEVEL_MAP, WALL_HEIGHT, type Cell } from './levelData';
import {
  createCeilingTexture,
  createFloorTexture,
  createPosterTexture,
  createScrawlTexture,
  createSignTexture,
  createWallTexture,
} from './textures';

type Rng = () => number;
type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };
type Facing = 'px' | 'nx' | 'pz' | 'nz';

const FACING_ROTATION: Record<Facing, number> = {
  pz: 0,
  px: Math.PI / 2,
  nz: Math.PI,
  nx: -Math.PI / 2,
};
const FACING_VECTOR: Record<Facing, [number, number]> = {
  pz: [0, 1],
  px: [1, 0],
  nz: [0, -1],
  nx: [-1, 0],
};

const SAFE_RADIUS = 2.6;
const TOY_COLORS = ['#c98b9c', '#86b7bb', '#d9bf7a', '#9fa6cf', '#b7cf9b', '#d79e7a', '#e9e2d6'];

/** 色付きの箱ジオメトリ(頂点カラー付き、マージ用)。 */
function coloredBox(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  color: THREE.ColorRepresentation,
): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(w, h, d);
  geometry.translate(x, y, z);
  return paint(geometry, color);
}

function paint(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    // 下側の頂点を少し暗くして、接地感(疑似AO)を出す
    const y = geometry.getAttribute('position').getY(i);
    const shade = 0.82 + Math.min(0.18, Math.max(0, y) * 0.06);
    colors[i * 3] = c.r * shade;
    colors[i * 3 + 1] = c.g * shade;
    colors[i * 3 + 2] = c.b * shade;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** 床に転がる小さなおばけのぬいぐるみ。 */
function plushGeometry(color: THREE.ColorRepresentation, scale = 1): THREE.BufferGeometry {
  const head = new THREE.SphereGeometry(0.22 * scale, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  head.translate(0, 0.26 * scale, 0);
  const body = new THREE.CylinderGeometry(0.22 * scale, 0.27 * scale, 0.26 * scale, 14, 1, true);
  body.translate(0, 0.13 * scale, 0);
  const eyeL = new THREE.SphereGeometry(0.035 * scale, 6, 4);
  eyeL.translate(-0.08 * scale, 0.3 * scale, 0.19 * scale);
  const eyeR = eyeL.clone();
  eyeR.translate(0.16 * scale, 0, 0);
  return mergeGeometries([
    paint(head.toNonIndexed(), color),
    paint(body.toNonIndexed(), color),
    paint(eyeL.toNonIndexed(), '#111'),
    paint(eyeR.toNonIndexed(), '#111'),
  ])!;
}

export class Level {
  readonly group = new THREE.Group();
  readonly width = LEVEL_MAP[0].length;
  readonly height = LEVEL_MAP.length;
  readonly playerStart: Cell;
  readonly monsterSpawn: Cell;
  readonly fuseCells: Cell[] = [];
  readonly lightCells: Cell[] = [];
  readonly breakerCell: Cell;
  readonly exitCell: Cell;
  /** 配電盤の前(ヒューズをはめる位置)と、プレイヤーの向き */
  readonly breakerFront = new THREE.Vector3();
  readonly exitFront = new THREE.Vector3();

  private readonly grid: string[];
  private readonly blockers = new Map<number, Rect>();
  private readonly breakerLamps: THREE.Mesh[] = [];
  private readonly emergencyLights: THREE.PointLight[] = [];
  private readonly ceilingLights: THREE.PointLight[] = [];
  private readonly ceilingTubes: THREE.MeshStandardMaterial[] = [];
  private exitSignMaterial!: THREE.MeshBasicMaterial;
  private exitDoor!: THREE.Mesh;
  private doorOpen = 0;
  private doorTarget = 0;
  private powered = false;
  private readonly disposables: { dispose(): void }[] = [];

  constructor(rng: Rng) {
    this.grid = [...LEVEL_MAP];
    let start: Cell | null = null;
    let spawn: Cell | null = null;
    let breaker: Cell | null = null;
    let exit: Cell | null = null;
    this.grid.forEach((line, row) => {
      [...line].forEach((ch, col) => {
        if (ch === 'P') start = { col, row };
        if (ch === 'M') spawn = { col, row };
        if (ch === 'B') breaker = { col, row };
        if (ch === 'E') exit = { col, row };
        if (ch === 'F') this.fuseCells.push({ col, row });
        if (ch === 'L') this.lightCells.push({ col, row });
      });
    });
    if (!start || !spawn || !breaker || !exit) throw new Error('Level map is missing P/M/B/E markers.');
    this.playerStart = start;
    this.monsterSpawn = spawn;
    this.breakerCell = breaker;
    this.exitCell = exit;
    this.buildBlockers();
    this.build(rng);
  }

  // ---------- グリッド問い合わせ ----------

  charAt(col: number, row: number): string {
    if (row < 0 || row >= this.height || col < 0 || col >= this.width) return '#';
    return this.grid[row][col];
  }

  isBlocked(col: number, row: number): boolean {
    return '#S=BE'.includes(this.charAt(col, row));
  }

  isOpaque(col: number, row: number): boolean {
    const ch = this.charAt(col, row);
    return ch === '#' || ch === 'S' || (ch === 'E' && this.doorOpen < 0.6);
  }

  cellOf(x: number, z: number): Cell {
    return { col: Math.floor(x / CELL), row: Math.floor(z / CELL) };
  }

  center(cell: Cell, target = new THREE.Vector3(), y = 0): THREE.Vector3 {
    return target.set((cell.col + 0.5) * CELL, y, (cell.row + 0.5) * CELL);
  }

  isSafeZone(position: THREE.Vector3): boolean {
    for (const cell of this.lightCells) {
      const dx = (cell.col + 0.5) * CELL - position.x;
      const dz = (cell.row + 0.5) * CELL - position.z;
      if (dx * dx + dz * dz < SAFE_RADIUS * SAFE_RADIUS) return true;
    }
    return false;
  }

  /** 視線が壁や棚に遮られないか(高さは無視した2D判定)。 */
  hasLineOfSight(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const distance = Math.hypot(dx, dz);
    const steps = Math.ceil(distance / 0.35);
    for (let i = 1; i < steps; i += 1) {
      const t = i / steps;
      const col = Math.floor((a.x + dx * t) / CELL);
      const row = Math.floor((a.z + dz * t) / CELL);
      if (this.isOpaque(col, row)) return false;
    }
    return true;
  }

  /** 半径 radius の円が a→b を直進できるか(経路の直線化に使う)。 */
  isSegmentWalkable(a: THREE.Vector3, b: THREE.Vector3, radius: number): boolean {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const distance = Math.hypot(dx, dz);
    const steps = Math.ceil(distance / 0.4);
    const nx = distance > 0 ? -dz / distance : 0;
    const nz = distance > 0 ? dx / distance : 0;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      for (const side of [-1, 0, 1]) {
        const x = a.x + dx * t + nx * radius * side;
        const z = a.z + dz * t + nz * radius * side;
        if (this.pointBlocked(x, z)) return false;
      }
    }
    return true;
  }

  pointBlocked(x: number, z: number): boolean {
    const col = Math.floor(x / CELL);
    const row = Math.floor(z / CELL);
    const rect = this.blockers.get(row * this.width + col);
    if (!rect) return false;
    return x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;
  }

  /** 円(半径 radius)を障害物から押し出す。 */
  resolveCollision(position: THREE.Vector3, radius: number): void {
    const baseCol = Math.floor(position.x / CELL);
    const baseRow = Math.floor(position.z / CELL);
    for (let pass = 0; pass < 2; pass += 1) {
      for (let row = baseRow - 1; row <= baseRow + 1; row += 1) {
        for (let col = baseCol - 1; col <= baseCol + 1; col += 1) {
          const rect = this.blockers.get(row * this.width + col);
          if (!rect) continue;
          const cx = THREE.MathUtils.clamp(position.x, rect.minX, rect.maxX);
          const cz = THREE.MathUtils.clamp(position.z, rect.minZ, rect.maxZ);
          const dx = position.x - cx;
          const dz = position.z - cz;
          const distSq = dx * dx + dz * dz;
          if (distSq >= radius * radius) continue;
          if (distSq > 1e-8) {
            const dist = Math.sqrt(distSq);
            position.x = cx + (dx / dist) * radius;
            position.z = cz + (dz / dist) * radius;
          } else {
            // 中心が箱の内側: 最も近い辺から押し出す
            const pushes = [
              [rect.minX - radius - position.x, 0],
              [rect.maxX + radius - position.x, 0],
              [0, rect.minZ - radius - position.z],
              [0, rect.maxZ + radius - position.z],
            ];
            pushes.sort((p, q) => Math.abs(p[0] + p[1]) - Math.abs(q[0] + q[1]));
            position.x += pushes[0][0];
            position.z += pushes[0][1];
          }
        }
      }
    }
  }

  /** 8方向A*(角抜けなし)。start/goal が塞がっている場合は空配列。 */
  findPath(start: Cell, goal: Cell): Cell[] {
    if (this.isBlocked(goal.col, goal.row) || this.isBlocked(start.col, start.row)) return [];
    const w = this.width;
    const size = w * this.height;
    const g = new Float32Array(size).fill(Infinity);
    const f = new Float32Array(size).fill(Infinity);
    const came = new Int32Array(size).fill(-1);
    const closed = new Uint8Array(size);
    const open: number[] = [];
    const startIndex = start.row * w + start.col;
    const goalIndex = goal.row * w + goal.col;
    const heuristic = (index: number) => {
      const dx = Math.abs((index % w) - goal.col);
      const dz = Math.abs(Math.floor(index / w) - goal.row);
      return Math.max(dx, dz) + 0.414 * Math.min(dx, dz);
    };
    g[startIndex] = 0;
    f[startIndex] = heuristic(startIndex);
    open.push(startIndex);
    while (open.length > 0) {
      let best = 0;
      for (let i = 1; i < open.length; i += 1) if (f[open[i]] < f[open[best]]) best = i;
      const current = open[best];
      open.splice(best, 1);
      if (current === goalIndex) break;
      if (closed[current]) continue;
      closed[current] = 1;
      const col = current % w;
      const row = Math.floor(current / w);
      for (let dz = -1; dz <= 1; dz += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dz === 0) continue;
          const nc = col + dx;
          const nr = row + dz;
          if (this.isBlocked(nc, nr)) continue;
          if (dx !== 0 && dz !== 0 && (this.isBlocked(col + dx, row) || this.isBlocked(col, row + dz))) continue;
          const next = nr * w + nc;
          if (closed[next]) continue;
          const cost = g[current] + (dx !== 0 && dz !== 0 ? 1.414 : 1);
          if (cost < g[next]) {
            g[next] = cost;
            f[next] = cost + heuristic(next);
            came[next] = current;
            open.push(next);
          }
        }
      }
    }
    if (came[goalIndex] === -1 && goalIndex !== startIndex) return [];
    const path: Cell[] = [];
    let cursor = goalIndex;
    while (cursor !== -1 && cursor !== startIndex) {
      path.push({ col: cursor % w, row: Math.floor(cursor / w) });
      cursor = came[cursor];
    }
    path.reverse();
    return path;
  }

  randomFloorCell(rng: Rng, accept: (cell: Cell) => boolean = () => true): Cell {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const cell = { col: Math.floor(rng() * this.width), row: Math.floor(rng() * this.height) };
      if (!this.isBlocked(cell.col, cell.row) && accept(cell)) return cell;
    }
    return this.monsterSpawn;
  }

  // ---------- 状態 ----------

  setFuseLamps(inserted: number): void {
    this.breakerLamps.forEach((lamp, index) => {
      const material = lamp.material as THREE.MeshStandardMaterial;
      const on = index < inserted;
      material.color.set(on ? '#7dff9a' : '#5a1010');
      material.emissive.set(on ? '#3dff6a' : '#ff2020');
      material.emissiveIntensity = on ? 2.4 : 0.6;
    });
  }

  setPower(on: boolean): void {
    this.powered = on;
    this.doorTarget = on ? 1 : 0;
    for (const light of this.ceilingLights) light.intensity = on ? 26 : 0;
    for (const tube of this.ceilingTubes) {
      tube.emissive.set(on ? '#fff3d6' : '#000000');
      tube.emissiveIntensity = on ? 2.2 : 0;
    }
    this.exitSignMaterial.color.set(on ? '#39ff7a' : '#173a22');
  }

  resetDoor(): void {
    this.doorOpen = this.doorTarget;
    this.exitDoor.position.y = 1.6 + this.doorOpen * 3.1;
  }

  isExitOpen(): boolean {
    return this.doorOpen > 0.85;
  }

  update(delta: number, elapsed: number): void {
    this.doorOpen = THREE.MathUtils.damp(this.doorOpen, this.doorTarget, 0.9, delta);
    this.exitDoor.position.y = 1.6 + this.doorOpen * 3.1;
    // 非常灯のちらつき(停電中のみ)
    this.emergencyLights.forEach((light, index) => {
      const flicker = Math.sin(elapsed * (7 + index * 1.7)) * Math.sin(elapsed * (2.3 + index));
      const base = this.powered ? 6 : 16;
      light.intensity = base + (flicker > 0.93 ? -base * 0.8 : flicker * 1.5);
    });
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
  }

  // ---------- 構築 ----------

  private buildBlockers(): void {
    for (let row = 0; row < this.height; row += 1) {
      for (let col = 0; col < this.width; col += 1) {
        const ch = this.charAt(col, row);
        const x0 = col * CELL;
        const z0 = row * CELL;
        if (ch === '#' || ch === 'E') {
          this.blockers.set(row * this.width + col, { minX: x0, maxX: x0 + CELL, minZ: z0, maxZ: z0 + CELL });
        } else if (ch === 'S') {
          this.blockers.set(row * this.width + col, { minX: x0 + 0.3, maxX: x0 + CELL - 0.3, minZ: z0, maxZ: z0 + CELL });
        } else if (ch === '=') {
          this.blockers.set(row * this.width + col, { minX: x0, maxX: x0 + CELL, minZ: z0 + 0.6, maxZ: z0 + CELL - 0.6 });
        } else if (ch === 'B') {
          this.blockers.set(row * this.width + col, { minX: x0 + 0.6, maxX: x0 + CELL - 0.6, minZ: z0 + 0.5, maxZ: z0 + CELL - 0.5 });
        }
      }
    }
  }

  private track<T extends { dispose(): void }>(item: T): T {
    this.disposables.push(item);
    return item;
  }

  private build(rng: Rng): void {
    const worldW = this.width * CELL;
    const worldD = this.height * CELL;

    // 床と天井
    const floorTexture = this.track(createFloorTexture(rng));
    floorTexture.repeat.set(this.width, this.height);
    const floor = new THREE.Mesh(
      this.track(new THREE.PlaneGeometry(worldW, worldD)),
      this.track(new THREE.MeshStandardMaterial({ map: floorTexture, roughness: 0.86, metalness: 0.04 })),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(worldW / 2, 0, worldD / 2);
    floor.receiveShadow = true;
    this.group.add(floor);

    const ceilingTexture = this.track(createCeilingTexture(rng));
    ceilingTexture.repeat.set(this.width, this.height);
    const ceiling = new THREE.Mesh(
      this.track(new THREE.PlaneGeometry(worldW, worldD)),
      this.track(new THREE.MeshStandardMaterial({ map: ceilingTexture, roughness: 0.95 })),
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(worldW / 2, WALL_HEIGHT, worldD / 2);
    this.group.add(ceiling);

    this.buildWalls(rng);
    this.buildShelves(rng);
    this.buildConveyors(rng);
    this.buildPlushes(rng);
    this.buildEmergencyLights();
    this.buildCeilingLights();
    this.buildBreaker();
    this.buildExit();
    this.buildDecor(rng);
  }

  private cellsOf(ch: string): Cell[] {
    const cells: Cell[] = [];
    this.grid.forEach((line, row) => {
      [...line].forEach((c, col) => {
        if (c === ch) cells.push({ col, row });
      });
    });
    return cells;
  }

  private buildWalls(rng: Rng): void {
    const wallCells = this.cellsOf('#').filter(({ col, row }) => {
      // 床に面していない壁は描かない
      return [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([dx, dz]) => !'#'.includes(this.charAt(col + dx, row + dz)));
    });
    const texture = this.track(createWallTexture(rng));
    const material = this.track(new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9, metalness: 0 }));
    const geometry = this.track(new THREE.BoxGeometry(CELL, WALL_HEIGHT, CELL));
    const mesh = new THREE.InstancedMesh(geometry, material, wallCells.length);
    const matrix = new THREE.Matrix4();
    wallCells.forEach((cell, index) => {
      matrix.makeTranslation((cell.col + 0.5) * CELL, WALL_HEIGHT / 2, (cell.row + 0.5) * CELL);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    this.group.add(mesh);

    // 壁の上端の梁(天井との境目の陰影)
    const beamGeometry = this.track(new THREE.BoxGeometry(CELL + 0.02, 0.35, CELL + 0.02));
    const beamMaterial = this.track(new THREE.MeshStandardMaterial({ color: '#1a1b1c', roughness: 0.7, metalness: 0.3 }));
    const beams = new THREE.InstancedMesh(beamGeometry, beamMaterial, wallCells.length);
    wallCells.forEach((cell, index) => {
      matrix.makeTranslation((cell.col + 0.5) * CELL, WALL_HEIGHT - 0.17, (cell.row + 0.5) * CELL);
      beams.setMatrixAt(index, matrix);
    });
    this.group.add(beams);
  }

  private buildShelves(rng: Rng): void {
    const cells = this.cellsOf('S');
    const variants = [0, 1, 2].map(() => this.shelfGeometry(rng));
    const material = this.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.08 }));
    variants.forEach((geometry, variant) => {
      const mine = cells.filter((_, index) => index % 3 === variant);
      const mesh = new THREE.InstancedMesh(this.track(geometry), material, mine.length);
      const matrix = new THREE.Matrix4();
      const rotation = new THREE.Matrix4();
      mine.forEach((cell, index) => {
        rotation.makeRotationY(rng() > 0.5 ? Math.PI : 0);
        matrix.makeTranslation((cell.col + 0.5) * CELL, 0, (cell.row + 0.5) * CELL).multiply(rotation);
        mesh.setMatrixAt(index, matrix);
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    });
  }

  private shelfGeometry(rng: Rng): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    const w = CELL - 0.6;
    const d = CELL - 0.04;
    const h = 3.7;
    const metal = '#3b4246';
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        parts.push(coloredBox(0.09, h, 0.09, (sx * (w - 0.09)) / 2, h / 2, (sz * (d - 0.09)) / 2, metal));
      }
    }
    const levels = [0.18, 1.12, 2.06, 3.0];
    for (const y of levels) {
      parts.push(coloredBox(w, 0.06, d, 0, y, 0, '#4a4f50'));
      parts.push(coloredBox(w, 0.12, 0.05, 0, y - 0.04, d / 2 - 0.03, '#a3462f'));
      parts.push(coloredBox(w, 0.12, 0.05, 0, y - 0.04, -d / 2 + 0.03, '#a3462f'));
      // おもちゃの箱とぬいぐるみ
      let z = -d / 2 + 0.15;
      while (z < d / 2 - 0.4) {
        const bd = 0.35 + rng() * 0.55;
        const bh = 0.3 + rng() * 0.5;
        const bw = 0.5 + rng() * (w - 0.8);
        if (rng() > 0.18) {
          const color = TOY_COLORS[Math.floor(rng() * TOY_COLORS.length)];
          const tilt = rng() > 0.85;
          const box = new THREE.BoxGeometry(bw, bh, bd);
          if (tilt) box.rotateY((rng() - 0.5) * 0.6);
          box.translate((rng() - 0.5) * (w - bw) * 0.8, y + 0.03 + bh / 2, z + bd / 2);
          parts.push(paint(box, color));
        } else if (y < 3) {
          const plush = plushGeometry(rng() > 0.5 ? '#e9e2d6' : '#d8c3c8', 1.3);
          plush.translate((rng() - 0.5) * (w - 0.6), y + 0.03, z + 0.25);
          parts.push(plush);
        }
        z += bd + 0.08 + rng() * 0.12;
      }
    }
    return mergeGeometries(parts.map((part) => (part.index ? part.toNonIndexed() : part)))!;
  }

  private buildConveyors(rng: Rng): void {
    const cells = this.cellsOf('=');
    const parts: THREE.BufferGeometry[] = [];
    parts.push(coloredBox(CELL, 0.7, 1.6, 0, 0.45, 0, '#3a3d3f'));
    parts.push(coloredBox(CELL, 0.06, 1.5, 0, 0.83, 0, '#151515'));
    parts.push(coloredBox(CELL, 0.16, 0.1, 0, 0.9, 0.8, '#c9a32b'));
    parts.push(coloredBox(CELL, 0.16, 0.1, 0, 0.9, -0.8, '#c9a32b'));
    for (const x of [-1.2, 1.2]) {
      for (const z of [-0.7, 0.7]) parts.push(coloredBox(0.12, 0.3, 0.12, x, 0.1, z, '#2a2c2d'));
    }
    const geometry = this.track(mergeGeometries(parts.map((part) => part.toNonIndexed()))!);
    const material = this.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.35 }));
    const mesh = new THREE.InstancedMesh(geometry, material, cells.length);
    const matrix = new THREE.Matrix4();
    cells.forEach((cell, index) => {
      matrix.makeTranslation((cell.col + 0.5) * CELL, 0, (cell.row + 0.5) * CELL);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);

    // コンベアの上に置き去りのぬいぐるみ(首が取れたものも)
    const plush = this.track(plushGeometry('#e6ddd0', 1.4));
    const plushMaterial = this.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
    const onBelt = new THREE.InstancedMesh(plush, plushMaterial, cells.length);
    const rotation = new THREE.Matrix4();
    cells.forEach((cell, index) => {
      rotation.makeRotationY(rng() * Math.PI * 2);
      matrix
        .makeTranslation((cell.col + 0.5) * CELL + (rng() - 0.5) * 2, 0.86, (cell.row + 0.5) * CELL + (rng() - 0.5) * 0.6)
        .multiply(rotation);
      onBelt.setMatrixAt(index, matrix);
    });
    onBelt.castShadow = true;
    this.group.add(onBelt);
  }

  private buildPlushes(rng: Rng): void {
    const count = 16;
    const geometry = this.track(plushGeometry('#d9d0c4', 1.6));
    const material = this.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Matrix4();
    const fallen = new THREE.Matrix4();
    for (let i = 0; i < count; i += 1) {
      const cell = this.randomFloorCell(rng, (c) => this.charAt(c.col, c.row) === '.');
      rotation.makeRotationY(rng() * Math.PI * 2);
      fallen.makeRotationX(rng() > 0.5 ? Math.PI / 2 : 0);
      matrix
        .makeTranslation((cell.col + 0.5) * CELL + (rng() - 0.5) * 2.2, 0.02, (cell.row + 0.5) * CELL + (rng() - 0.5) * 2.2)
        .multiply(rotation)
        .multiply(fallen);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.castShadow = true;
    this.group.add(mesh);
  }

  private buildEmergencyLights(): void {
    const cageGeometry = this.track(new THREE.CylinderGeometry(0.18, 0.22, 0.28, 10));
    const bulbMaterial = this.track(
      new THREE.MeshStandardMaterial({ color: '#ff3a2a', emissive: '#ff2a1a', emissiveIntensity: 3 }),
    );
    const ringGeometry = this.track(new THREE.RingGeometry(SAFE_RADIUS - 0.18, SAFE_RADIUS, 48));
    const ringMaterial = this.track(
      new THREE.MeshBasicMaterial({ color: '#d8b13a', transparent: true, opacity: 0.32, depthWrite: false }),
    );
    for (const cell of this.lightCells) {
      const position = this.center(cell);
      const bulb = new THREE.Mesh(cageGeometry, bulbMaterial);
      bulb.position.set(position.x, WALL_HEIGHT - 0.3, position.z);
      this.group.add(bulb);
      const light = new THREE.PointLight('#ff3322', 16, 11, 1.6);
      light.position.set(position.x, WALL_HEIGHT - 0.6, position.z);
      this.group.add(light);
      this.emergencyLights.push(light);
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(position.x, 0.02, position.z);
      this.group.add(ring);
    }
  }

  private buildCeilingLights(): void {
    const spots: Cell[] = [
      { col: 12, row: 9 },
      { col: 12, row: 14 },
      { col: 3, row: 11 },
      { col: 10, row: 4 },
      { col: 20, row: 4 },
      { col: 21, row: 12 },
      { col: 6, row: 16 },
      { col: 19, row: 16 },
    ];
    const fixture = this.track(new THREE.BoxGeometry(1.8, 0.1, 0.32));
    for (const cell of spots) {
      const position = this.center(cell);
      const material = this.track(new THREE.MeshStandardMaterial({ color: '#9a9a96', roughness: 0.4, emissive: '#000000' }));
      this.ceilingTubes.push(material);
      const tube = new THREE.Mesh(fixture, material);
      tube.position.set(position.x, WALL_HEIGHT - 0.4, position.z);
      this.group.add(tube);
      const light = new THREE.PointLight('#ffe8c4', 0, 20, 1.4);
      light.position.set(position.x, WALL_HEIGHT - 0.7, position.z);
      this.group.add(light);
      this.ceilingLights.push(light);
    }
  }

  private buildBreaker(): void {
    const position = this.center(this.breakerCell);
    const cabinet = new THREE.Group();
    cabinet.position.copy(position);
    const metal = this.track(new THREE.MeshStandardMaterial({ color: '#4d5a52', roughness: 0.5, metalness: 0.55 }));
    const body = new THREE.Mesh(this.track(new THREE.BoxGeometry(1.0, 2.2, 1.6)), metal);
    body.position.y = 1.1;
    body.castShadow = true;
    body.receiveShadow = true;
    cabinet.add(body);
    const front = new THREE.Mesh(
      this.track(new THREE.BoxGeometry(0.05, 1.5, 1.2)),
      this.track(new THREE.MeshStandardMaterial({ color: '#28302b', roughness: 0.6, metalness: 0.4 })),
    );
    front.position.set(0.52, 1.25, 0);
    cabinet.add(front);
    const slotGeometry = this.track(new THREE.CylinderGeometry(0.1, 0.1, 0.36, 12));
    const lampGeometry = this.track(new THREE.SphereGeometry(0.07, 12, 8));
    for (let i = 0; i < 3; i += 1) {
      const z = (i - 1) * 0.36;
      const slot = new THREE.Mesh(slotGeometry, this.track(new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.4 })));
      slot.position.set(0.56, 1.25, z);
      cabinet.add(slot);
      const lamp = new THREE.Mesh(lampGeometry, this.track(new THREE.MeshStandardMaterial({ color: '#5a1010' })));
      lamp.position.set(0.56, 1.66, z);
      cabinet.add(lamp);
      this.breakerLamps.push(lamp);
    }
    // ケーブルと警告ラベル
    const cable = new THREE.Mesh(
      this.track(new THREE.CylinderGeometry(0.08, 0.08, WALL_HEIGHT - 2.2, 8)),
      this.track(new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.7 })),
    );
    cable.position.set(-0.2, 2.2 + (WALL_HEIGHT - 2.2) / 2, 0.4);
    cabinet.add(cable);
    const label = new THREE.Mesh(
      this.track(new THREE.PlaneGeometry(1.0, 0.38)),
      this.track(new THREE.MeshStandardMaterial({ map: this.track(createSignTexture('配電盤', '#1a1a1a', '#e3c13b')), roughness: 0.6 })),
    );
    label.rotation.y = Math.PI / 2;
    label.position.set(0.53, 2.0, 0);
    cabinet.add(label);
    this.group.add(cabinet);
    this.setFuseLamps(0);
    this.breakerFront.set(position.x + 1.6, 0, position.z);
  }

  private buildExit(): void {
    const position = this.center(this.exitCell);
    const faceX = this.exitCell.col * CELL;
    const doorMaterial = this.track(new THREE.MeshStandardMaterial({ color: '#5b3a32', roughness: 0.55, metalness: 0.5 }));
    this.exitDoor = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.25, 3.2, 2.6)), doorMaterial);
    this.exitDoor.position.set(faceX + 0.1, 1.6, position.z);
    this.exitDoor.castShadow = true;
    this.group.add(this.exitDoor);
    // ハザード柄の枠
    const frameMaterial = this.track(new THREE.MeshStandardMaterial({ color: '#c9a32b', roughness: 0.5, metalness: 0.3 }));
    for (const dz of [-1.4, 1.4]) {
      const post = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.3, 3.4, 0.2)), frameMaterial);
      post.position.set(faceX - 0.05, 1.7, position.z + dz);
      this.group.add(post);
    }
    this.exitSignMaterial = this.track(
      new THREE.MeshBasicMaterial({ map: this.track(createSignTexture('出口', '#ffffff', '#0f7a35')), color: '#173a22' }),
    );
    const sign = new THREE.Mesh(this.track(new THREE.PlaneGeometry(1.4, 0.52)), this.exitSignMaterial);
    sign.rotation.y = -Math.PI / 2;
    sign.position.set(faceX - 0.02, 3.8, position.z);
    this.group.add(sign);
    // 扉の向こう(外の月明かり)
    const outside = new THREE.Mesh(
      this.track(new THREE.PlaneGeometry(2.6, 3.2)),
      this.track(new THREE.MeshBasicMaterial({ color: '#4d6a8a' })),
    );
    outside.rotation.y = -Math.PI / 2;
    outside.position.set(faceX + 0.4, 1.6, position.z);
    this.group.add(outside);
    this.exitFront.set(faceX - 1.2, 0, position.z);
  }

  private wallFace(col: number, row: number, facing: Facing, y: number): { position: THREE.Vector3; rotation: number } {
    const [fx, fz] = FACING_VECTOR[facing];
    const position = new THREE.Vector3(
      (col + 0.5) * CELL + fx * (CELL / 2 + 0.015),
      y,
      (row + 0.5) * CELL + fz * (CELL / 2 + 0.015),
    );
    return { position, rotation: FACING_ROTATION[facing] };
  }

  private buildDecor(rng: Rng): void {
    const posters: [number, number, Facing][] = [
      [5, 2, 'px'],
      [15, 2, 'nx'],
      [17, 10, 'nx'],
      [6, 15, 'nz'],
      [0, 11, 'px'],
      [19, 15, 'nz'],
    ];
    const posterGeometry = this.track(new THREE.PlaneGeometry(1.2, 1.6));
    posters.forEach(([col, row, facing], index) => {
      const { position, rotation } = this.wallFace(col, row, facing, 2.1);
      const material = this.track(
        new THREE.MeshStandardMaterial({ map: this.track(createPosterTexture(rng, index)), roughness: 0.8 }),
      );
      const poster = new THREE.Mesh(posterGeometry, material);
      poster.position.copy(position);
      poster.rotation.y = rotation + (rng() - 0.5) * 0.02;
      poster.rotation.z = (rng() - 0.5) * 0.08;
      this.group.add(poster);
    });

    // ホールの巨大看板
    {
      const { position, rotation } = this.wallFace(12, 8, 'pz', 3.0);
      const billboard = new THREE.Mesh(
        this.track(new THREE.PlaneGeometry(2.7, 3.6)),
        this.track(new THREE.MeshStandardMaterial({ map: this.track(createPosterTexture(rng, 0)), roughness: 0.7 })),
      );
      billboard.position.copy(position);
      billboard.rotation.y = rotation;
      this.group.add(billboard);
    }

    const scrawls: [string, number, number, Facing][] = [
      ['まってたよ', 5, 9, 'px'],
      ['にげないで', 24, 15, 'nz'],
      ['ぎゅっ', 23, 19, 'nz'],
    ];
    const scrawlGeometry = this.track(new THREE.PlaneGeometry(2.6, 1.3));
    for (const [text, col, row, facing] of scrawls) {
      const { position, rotation } = this.wallFace(col, row, facing, 1.6);
      const scrawl = new THREE.Mesh(
        scrawlGeometry,
        this.track(
          new THREE.MeshStandardMaterial({
            map: this.track(createScrawlTexture(text)),
            transparent: true,
            roughness: 0.6,
            depthWrite: false,
          }),
        ),
      );
      scrawl.position.copy(position);
      scrawl.rotation.y = rotation;
      this.group.add(scrawl);
    }
  }
}
