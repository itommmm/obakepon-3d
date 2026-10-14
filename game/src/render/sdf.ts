import * as THREE from 'three';

/**
 * SDF(符号付き距離関数)で形を「彫って」、Surface Nets でメッシュにする小さなスカルプト系。
 * 外部の3Dモデルを使わずに、なめらかで有機的なキャラクターをコードだけで作るためのもの。
 */

export type Vec3 = [number, number, number];
export type Field = (x: number, y: number, z: number) => number;

// ---------- 距離関数(Inigo Quilez の定番式を移植) ----------

export const sdSphere =
  (c: Vec3, r: number): Field =>
  (x, y, z) =>
    Math.hypot(x - c[0], y - c[1], z - c[2]) - r;

export const sdEllipsoid =
  (c: Vec3, r: Vec3): Field =>
  (x, y, z) => {
    const px = (x - c[0]) / r[0];
    const py = (y - c[1]) / r[1];
    const pz = (z - c[2]) / r[2];
    const k0 = Math.hypot(px, py, pz);
    const k1 = Math.hypot(px / r[0], py / r[1], pz / r[2]);
    return k1 === 0 ? -Math.min(r[0], r[1], r[2]) : (k0 * (k0 - 1)) / k1;
  };

export const sdRoundBox =
  (c: Vec3, half: Vec3, radius: number): Field =>
  (x, y, z) => {
    const qx = Math.abs(x - c[0]) - half[0] + radius;
    const qy = Math.abs(y - c[1]) - half[1] + radius;
    const qz = Math.abs(z - c[2]) - half[2] + radius;
    const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
    return outside + Math.min(Math.max(qx, qy, qz), 0) - radius;
  };

/** 半径が r1 → r2 に変わるカプセル(角の丸い円錐)。 */
export const sdRoundCone =
  (a: Vec3, b: Vec3, r1: number, r2: number): Field =>
  (x, y, z) => {
    const bax = b[0] - a[0];
    const bay = b[1] - a[1];
    const baz = b[2] - a[2];
    const pax = x - a[0];
    const pay = y - a[1];
    const paz = z - a[2];
    const l2 = bax * bax + bay * bay + baz * baz;
    const t = Math.min(1, Math.max(0, (pax * bax + pay * bay + paz * baz) / l2));
    const dx = pax - bax * t;
    const dy = pay - bay * t;
    const dz = paz - baz * t;
    return Math.hypot(dx, dy, dz) - (r1 + (r2 - r1) * t);
  };

export const sdCapsule = (a: Vec3, b: Vec3, r: number): Field => sdRoundCone(a, b, r, r);

/** 局所座標に変換してから評価する(回転・平行移動・非一様スケール)。 */
export function transform(field: Field, options: { at?: Vec3; rotate?: Vec3; scale?: Vec3 }): Field {
  const [ox, oy, oz] = options.at ?? [0, 0, 0];
  const [rx, ry, rz] = options.rotate ?? [0, 0, 0];
  const [sx, sy, sz] = options.scale ?? [1, 1, 1];
  const inverse = new THREE.Matrix4()
    .compose(new THREE.Vector3(ox, oy, oz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1))
    .invert()
    .elements;
  const minScale = Math.min(sx, sy, sz);
  return (x, y, z) => {
    const lx = (inverse[0] * x + inverse[4] * y + inverse[8] * z + inverse[12]) / sx;
    const ly = (inverse[1] * x + inverse[5] * y + inverse[9] * z + inverse[13]) / sy;
    const lz = (inverse[2] * x + inverse[6] * y + inverse[10] * z + inverse[14]) / sz;
    return field(lx, ly, lz) * minScale;
  };
}

export function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

export function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k);
}

// ---------- スカルプト ----------

type Op = { kind: 'add' | 'carve'; field: Field; k: number; color: THREE.Color };

export class Sculpt {
  private readonly ops: Op[] = [];

  /** なめらかに足す(k = なじませる幅、m) */
  add(field: Field, color: THREE.ColorRepresentation, k = 0): this {
    this.ops.push({ kind: 'add', field, k, color: new THREE.Color(color) });
    return this;
  }

  /** なめらかに削る。削った面は color で塗る。 */
  carve(field: Field, color: THREE.ColorRepresentation, k = 0): this {
    this.ops.push({ kind: 'carve', field, k, color: new THREE.Color(color) });
    return this;
  }

  distance(x: number, y: number, z: number): number {
    let d = Infinity;
    for (const op of this.ops) {
      const v = op.field(x, y, z);
      d = op.kind === 'add' ? (d === Infinity ? v : smin(d, v, op.k)) : smax(d, -v, op.k);
    }
    return d;
  }

  /** 表面の色: その点で一番「効いている」形の色。 */
  colorAt(x: number, y: number, z: number, out: THREE.Color): THREE.Color {
    let d = Infinity;
    let best = this.ops[0].color;
    for (const op of this.ops) {
      const v = op.field(x, y, z);
      if (op.kind === 'add') {
        if (v < d + op.k * 0.25 || d === Infinity) best = op.color;
        d = d === Infinity ? v : smin(d, v, op.k);
      } else {
        if (-v > d - op.k * 0.25) best = op.color;
        d = smax(d, -v, op.k);
      }
    }
    return out.copy(best);
  }

  /** Surface Nets でメッシュ化する。cell = 格子の間隔(m)。 */
  mesh(min: Vec3, max: Vec3, cell: number): THREE.BufferGeometry {
    const nx = Math.ceil((max[0] - min[0]) / cell) + 1;
    const ny = Math.ceil((max[1] - min[1]) / cell) + 1;
    const nz = Math.ceil((max[2] - min[2]) / cell) + 1;
    const values = new Float32Array(nx * ny * nz);
    const at = (i: number, j: number, k: number) => i + nx * (j + ny * k);
    for (let k = 0; k < nz; k += 1) {
      for (let j = 0; j < ny; j += 1) {
        for (let i = 0; i < nx; i += 1) {
          values[at(i, j, k)] = this.distance(min[0] + i * cell, min[1] + j * cell, min[2] + k * cell);
        }
      }
    }

    const positions: number[] = [];
    const vertexOf = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
    const cubeAt = (i: number, j: number, k: number) => i + (nx - 1) * (j + (ny - 1) * k);
    const corners = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
      [0, 0, 1],
      [1, 0, 1],
      [0, 1, 1],
      [1, 1, 1],
    ];
    const edges = [
      [0, 1],
      [2, 3],
      [4, 5],
      [6, 7],
      [0, 2],
      [1, 3],
      [4, 6],
      [5, 7],
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7],
    ];
    const v = new Float32Array(8);
    for (let k = 0; k < nz - 1; k += 1) {
      for (let j = 0; j < ny - 1; j += 1) {
        for (let i = 0; i < nx - 1; i += 1) {
          let inside = 0;
          for (let c = 0; c < 8; c += 1) {
            v[c] = values[at(i + corners[c][0], j + corners[c][1], k + corners[c][2])];
            if (v[c] < 0) inside += 1;
          }
          if (inside === 0 || inside === 8) continue;
          // 符号が変わる辺の交点の平均を頂点にする
          let sx = 0;
          let sy = 0;
          let sz = 0;
          let count = 0;
          for (const [a, b] of edges) {
            if (v[a] < 0 === v[b] < 0) continue;
            const t = v[a] / (v[a] - v[b]);
            sx += corners[a][0] + (corners[b][0] - corners[a][0]) * t;
            sy += corners[a][1] + (corners[b][1] - corners[a][1]) * t;
            sz += corners[a][2] + (corners[b][2] - corners[a][2]) * t;
            count += 1;
          }
          vertexOf[cubeAt(i, j, k)] = positions.length / 3;
          positions.push(min[0] + (i + sx / count) * cell, min[1] + (j + sy / count) * cell, min[2] + (k + sz / count) * cell);
        }
      }
    }

    // 符号が変わる格子辺ごとに、その辺を囲む4つのセルの頂点で四角形を張る
    const indices: number[] = [];
    const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
      if (a < 0 || b < 0 || c < 0 || d < 0) return;
      if (flip) indices.push(a, c, b, a, d, c);
      else indices.push(a, b, c, a, c, d);
    };
    for (let k = 1; k < nz - 1; k += 1) {
      for (let j = 1; j < ny - 1; j += 1) {
        for (let i = 1; i < nx - 1; i += 1) {
          const s = values[at(i, j, k)] < 0;
          if (s !== values[at(i + 1, j, k)] < 0 && i < nx - 1) {
            quad(vertexOf[cubeAt(i, j - 1, k - 1)], vertexOf[cubeAt(i, j, k - 1)], vertexOf[cubeAt(i, j, k)], vertexOf[cubeAt(i, j - 1, k)], s);
          }
          if (s !== values[at(i, j + 1, k)] < 0) {
            quad(vertexOf[cubeAt(i - 1, j, k - 1)], vertexOf[cubeAt(i - 1, j, k)], vertexOf[cubeAt(i, j, k)], vertexOf[cubeAt(i, j, k - 1)], s);
          }
          if (s !== values[at(i, j, k + 1)] < 0) {
            quad(vertexOf[cubeAt(i - 1, j - 1, k)], vertexOf[cubeAt(i, j - 1, k)], vertexOf[cubeAt(i, j, k)], vertexOf[cubeAt(i - 1, j, k)], s);
          }
        }
      }
    }

    // 法線は SDF の勾配から、色は colorAt から
    const count = positions.length / 3;
    const normals = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const color = new THREE.Color();
    const e = cell * 0.5;
    for (let n = 0; n < count; n += 1) {
      const x = positions[n * 3];
      const y = positions[n * 3 + 1];
      const z = positions[n * 3 + 2];
      const gx = this.distance(x + e, y, z) - this.distance(x - e, y, z);
      const gy = this.distance(x, y + e, z) - this.distance(x, y - e, z);
      const gz = this.distance(x, y, z + e) - this.distance(x, y, z - e);
      const length = Math.hypot(gx, gy, gz) || 1;
      normals[n * 3] = gx / length;
      normals[n * 3 + 1] = gy / length;
      normals[n * 3 + 2] = gz / length;
      this.colorAt(x, y, z, color);
      colors[n * 3] = color.r;
      colors[n * 3 + 1] = color.g;
      colors[n * 3 + 2] = color.b;
    }

    // 巻き方向を法線に合わせる(保険)
    for (let t = 0; t < indices.length; t += 3) {
      const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]];
      const abx = positions[b * 3] - positions[a * 3];
      const aby = positions[b * 3 + 1] - positions[a * 3 + 1];
      const abz = positions[b * 3 + 2] - positions[a * 3 + 2];
      const acx = positions[c * 3] - positions[a * 3];
      const acy = positions[c * 3 + 1] - positions[a * 3 + 1];
      const acz = positions[c * 3 + 2] - positions[a * 3 + 2];
      const fx = aby * acz - abz * acy;
      const fy = abz * acx - abx * acz;
      const fz = abx * acy - aby * acx;
      if (fx * normals[a * 3] + fy * normals[a * 3 + 1] + fz * normals[a * 3 + 2] < 0) {
        indices[t + 1] = c;
        indices[t + 2] = b;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    return geometry;
  }
}
