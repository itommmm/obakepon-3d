import * as THREE from 'three';

type Rng = () => number;

function makeCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create 2D canvas context.');
  return [canvas, context];
}

function toTexture(canvas: HTMLCanvasElement, repeat = true): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  if (repeat) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
  }
  return texture;
}

function stains(context: CanvasRenderingContext2D, rng: Rng, width: number, height: number, count: number, color: string): void {
  for (let i = 0; i < count; i += 1) {
    const x = rng() * width;
    const y = rng() * height;
    const r = 10 + rng() * 60;
    const gradient = context.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient;
    context.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

/** 色あせたパステル壁紙と、下半分の腰板。上下で縦方向に1枚(1マスの壁面)。 */
export function createWallTexture(rng: Rng): THREE.CanvasTexture {
  const [canvas, context] = makeCanvas(512, 512);
  // 壁紙: くすんだピンクに、クリーム色のストライプ
  context.fillStyle = '#8f6b74';
  context.fillRect(0, 0, 512, 512);
  for (let x = 0; x < 512; x += 64) {
    context.fillStyle = 'rgba(232, 214, 190, 0.32)';
    context.fillRect(x + 8, 0, 18, 512);
    context.fillStyle = 'rgba(120, 180, 190, 0.16)';
    context.fillRect(x + 36, 0, 6, 512);
  }
  // 小さなおばけ柄
  context.fillStyle = 'rgba(245, 236, 222, 0.22)';
  for (let y = 24; y < 300; y += 72) {
    for (let x = 32; x < 512; x += 128) {
      const ox = x + ((y / 72) % 2) * 64;
      context.beginPath();
      context.arc(ox, y, 9, Math.PI, 0);
      context.lineTo(ox + 9, y + 12);
      context.lineTo(ox + 4, y + 9);
      context.lineTo(ox, y + 13);
      context.lineTo(ox - 4, y + 9);
      context.lineTo(ox - 9, y + 12);
      context.closePath();
      context.fill();
    }
  }
  // 腰板
  context.fillStyle = '#2c3d3f';
  context.fillRect(0, 330, 512, 182);
  context.fillStyle = '#1d2a2b';
  for (let x = 0; x < 512; x += 128) context.fillRect(x + 6, 350, 116, 140);
  context.fillStyle = '#c9b48f';
  context.fillRect(0, 322, 512, 10);
  // 汚れ、水の垂れ跡、剥がれ
  stains(context, rng, 512, 512, 26, 'rgba(30, 22, 18, 0.35)');
  for (let i = 0; i < 18; i += 1) {
    const x = rng() * 512;
    const length = 60 + rng() * 220;
    const gradient = context.createLinearGradient(0, 0, 0, length);
    gradient.addColorStop(0, 'rgba(40, 30, 20, 0.42)');
    gradient.addColorStop(1, 'rgba(40, 30, 20, 0)');
    context.fillStyle = gradient;
    context.fillRect(x, 0, 2 + rng() * 4, length);
  }
  for (let i = 0; i < 6; i += 1) {
    context.fillStyle = 'rgba(70, 64, 58, 0.85)';
    const x = rng() * 480;
    const y = rng() * 280;
    context.beginPath();
    context.moveTo(x, y);
    for (let k = 0; k < 7; k += 1) context.lineTo(x + rng() * 40, y + rng() * 34);
    context.fill();
  }
  // 床際の黒ずみ
  const base = context.createLinearGradient(0, 440, 0, 512);
  base.addColorStop(0, 'rgba(0,0,0,0)');
  base.addColorStop(1, 'rgba(0,0,0,0.7)');
  context.fillStyle = base;
  context.fillRect(0, 440, 512, 72);
  return toTexture(canvas);
}

/** 汚れたコンクリートタイル。1枚 = 1マス。 */
export function createFloorTexture(rng: Rng): THREE.CanvasTexture {
  const [canvas, context] = makeCanvas(512, 512);
  context.fillStyle = '#4a4744';
  context.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 4000; i += 1) {
    const v = 50 + rng() * 40;
    context.fillStyle = `rgba(${v},${v - 2},${v - 5},0.5)`;
    context.fillRect(rng() * 512, rng() * 512, 2, 2);
  }
  context.strokeStyle = 'rgba(20, 18, 16, 0.8)';
  context.lineWidth = 3;
  for (let i = 0; i <= 512; i += 256) {
    context.beginPath();
    context.moveTo(i, 0);
    context.lineTo(i, 512);
    context.moveTo(0, i);
    context.lineTo(512, i);
    context.stroke();
  }
  stains(context, rng, 512, 512, 14, 'rgba(20, 16, 12, 0.5)');
  // ひび
  context.strokeStyle = 'rgba(18, 16, 14, 0.7)';
  context.lineWidth = 1.2;
  for (let i = 0; i < 5; i += 1) {
    let x = rng() * 512;
    let y = rng() * 512;
    context.beginPath();
    context.moveTo(x, y);
    for (let k = 0; k < 8; k += 1) {
      x += (rng() - 0.5) * 50;
      y += (rng() - 0.5) * 50;
      context.lineTo(x, y);
    }
    context.stroke();
  }
  return toTexture(canvas);
}

export function createCeilingTexture(rng: Rng): THREE.CanvasTexture {
  const [canvas, context] = makeCanvas(256, 256);
  context.fillStyle = '#26282a';
  context.fillRect(0, 0, 256, 256);
  context.strokeStyle = '#151617';
  context.lineWidth = 4;
  for (let i = 0; i <= 256; i += 128) {
    context.beginPath();
    context.moveTo(i, 0);
    context.lineTo(i, 256);
    context.moveTo(0, i);
    context.lineTo(256, i);
    context.stroke();
  }
  stains(context, rng, 256, 256, 8, 'rgba(60, 46, 30, 0.45)');
  return toTexture(canvas);
}

/** 色あせた「おばけポン」の広告ポスター。 */
export function createPosterTexture(rng: Rng, variant: number): THREE.CanvasTexture {
  const [canvas, context] = makeCanvas(384, 512);
  const backgrounds = ['#e8a3b8', '#9fd3d6', '#f1d38a'];
  context.fillStyle = backgrounds[variant % backgrounds.length];
  context.fillRect(0, 0, 384, 512);
  // 放射状の背景
  context.save();
  context.translate(192, 230);
  for (let i = 0; i < 16; i += 1) {
    context.rotate(Math.PI / 8);
    context.fillStyle = 'rgba(255,255,255,0.18)';
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(-30, -400);
    context.lineTo(30, -400);
    context.fill();
  }
  context.restore();
  // ポンちゃん
  context.fillStyle = '#fbf6ef';
  context.beginPath();
  context.arc(192, 210, 100, Math.PI, 0);
  context.lineTo(292, 330);
  for (let i = 0; i < 6; i += 1) {
    const x = 292 - (i + 1) * (200 / 6);
    context.quadraticCurveTo(x + 200 / 12, 300 + (i % 2) * 6, x, 330);
  }
  context.closePath();
  context.fill();
  context.fillStyle = '#1b1416';
  context.beginPath();
  context.ellipse(155, 200, 14, 20, 0, 0, Math.PI * 2);
  context.ellipse(229, 200, 14, 20, 0, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = '#c23a4f';
  context.lineWidth = 6;
  context.beginPath();
  context.arc(192, 228, 46, 0.15 * Math.PI, 0.85 * Math.PI);
  context.stroke();
  context.lineWidth = 3;
  for (let i = 0; i < 7; i += 1) {
    const a = (0.2 + i * 0.1) * Math.PI;
    const x = 192 + Math.cos(a) * 46;
    const y = 228 + Math.sin(a) * 46;
    context.beginPath();
    context.moveTo(x, y - 8);
    context.lineTo(x, y + 8);
    context.stroke();
  }
  // コピー
  context.fillStyle = '#c23a4f';
  context.font = 'bold 54px "Hiragino Maru Gothic ProN", "Hiragino Sans", "Noto Sans JP", sans-serif';
  context.textAlign = 'center';
  context.fillText('おばけポン', 192, 400);
  context.fillStyle = '#3a2a2e';
  context.font = 'bold 24px "Hiragino Sans", "Noto Sans JP", sans-serif';
  context.fillText(['ずっといっしょだよ!', 'みんなのおともだち', 'ぎゅっとしてね'][variant % 3], 192, 446);
  context.font = '16px "Hiragino Sans", "Noto Sans JP", sans-serif';
  context.fillText('ポンポン玩具工場', 192, 486);
  // 経年劣化
  context.globalCompositeOperation = 'multiply';
  stains(context, rng, 384, 512, 20, 'rgba(110, 80, 50, 0.55)');
  context.globalCompositeOperation = 'source-over';
  context.fillStyle = 'rgba(40, 30, 25, 0.95)';
  context.beginPath();
  context.moveTo(384, 0);
  context.lineTo(384 - 40 - rng() * 60, 0);
  context.lineTo(384, 50 + rng() * 80);
  context.fill();
  const texture = toTexture(canvas, false);
  return texture;
}

export function createSignTexture(text: string, color: string, background: string): THREE.CanvasTexture {
  const [canvas, context] = makeCanvas(256, 96);
  context.fillStyle = background;
  context.fillRect(0, 0, 256, 96);
  context.strokeStyle = color;
  context.lineWidth = 6;
  context.strokeRect(6, 6, 244, 84);
  context.fillStyle = color;
  context.font = 'bold 52px "Hiragino Sans", "Noto Sans JP", sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, 128, 50);
  return toTexture(canvas, false);
}

/** 床や壁の落書き・血痕風デカール(透過)。 */
export function createScrawlTexture(text: string): THREE.CanvasTexture {
  const [canvas, context] = makeCanvas(512, 256);
  context.clearRect(0, 0, 512, 256);
  context.fillStyle = 'rgba(150, 20, 28, 0.85)';
  context.font = 'bold 76px "Hiragino Maru Gothic ProN", "Hiragino Sans", "Noto Sans JP", sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, 256, 120);
  for (let i = 0; i < 14; i += 1) {
    const x = 40 + i * 32;
    const length = 20 + ((i * 37) % 60);
    context.fillRect(x, 150, 4, length);
  }
  return toTexture(canvas, false);
}
