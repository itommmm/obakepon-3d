import * as THREE from 'three';

type Rng = () => number;

const KID_FONT = '"Hiragino Maru Gothic ProN", "Hiragino Sans", "Noto Sans JP", sans-serif';
const PLAIN_FONT = '"Hiragino Sans", "Noto Sans JP", sans-serif';

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

/** 子どもの落書き風の線(ゆらぎのある手描き線)。 */
function wobblyLine(context: CanvasRenderingContext2D, rng: Rng, points: [number, number][]): void {
  context.beginPath();
  points.forEach(([x, y], i) => {
    const jx = x + (rng() - 0.5) * 3;
    const jy = y + (rng() - 0.5) * 3;
    if (i === 0) context.moveTo(jx, jy);
    else context.lineTo(jx, jy);
  });
  context.stroke();
}

/** 校舎の壁: 上はクリーム色、下は薄緑の腰壁。1枚 = 1マスの壁面。 */
export function createWallTexture(rng: Rng): THREE.CanvasTexture {
  const [canvas, context] = makeCanvas(512, 512);
  context.fillStyle = '#b9b09a';
  context.fillRect(0, 0, 512, 512);
  // 塗り壁のムラ
  for (let i = 0; i < 2500; i += 1) {
    const v = 165 + rng() * 30;
    context.fillStyle = `rgba(${v},${v - 6},${v - 22},0.18)`;
    context.fillRect(rng() * 512, rng() * 330, 3, 3);
  }
  // 腰壁
  context.fillStyle = '#5f7f6c';
  context.fillRect(0, 330, 512, 182);
  context.fillStyle = 'rgba(0,0,0,0.12)';
  for (let x = 0; x < 512; x += 4) context.fillRect(x, 330, 1, 182);
  context.fillStyle = '#3f574a';
  context.fillRect(0, 324, 512, 10);
  context.fillStyle = '#2b3a31';
  context.fillRect(0, 492, 512, 20);
  // 画びょうの跡と、はがれかけの掲示物のテープ
  for (let i = 0; i < 30; i += 1) {
    context.fillStyle = 'rgba(60, 50, 40, 0.5)';
    context.fillRect(rng() * 512, 40 + rng() * 250, 3, 3);
  }
  for (let i = 0; i < 5; i += 1) {
    context.fillStyle = 'rgba(230, 220, 170, 0.55)';
    context.save();
    context.translate(rng() * 512, 50 + rng() * 220);
    context.rotate((rng() - 0.5) * 0.6);
    context.fillRect(-14, -5, 28, 10);
    context.restore();
  }
  // クレヨンの落書き(腰壁の高さ)
  const crayons = ['#d23b3b', '#2f6fd1', '#e0b52c', '#2c9b4a'];
  context.lineWidth = 3;
  for (let i = 0; i < 4; i += 1) {
    context.strokeStyle = crayons[Math.floor(rng() * crayons.length)];
    const x = rng() * 440;
    const y = 360 + rng() * 90;
    wobblyLine(context, rng, [
      [x, y],
      [x + 20, y - 15],
      [x + 40, y],
      [x + 60, y - 15],
      [x + 80, y],
    ]);
  }
  // 汚れと水の垂れ跡
  stains(context, rng, 512, 512, 20, 'rgba(40, 30, 20, 0.3)');
  for (let i = 0; i < 12; i += 1) {
    const x = rng() * 512;
    const length = 50 + rng() * 200;
    const gradient = context.createLinearGradient(0, 0, 0, length);
    gradient.addColorStop(0, 'rgba(60, 45, 25, 0.35)');
    gradient.addColorStop(1, 'rgba(60, 45, 25, 0)');
    context.fillStyle = gradient;
    context.fillRect(x, 0, 2 + rng() * 3, length);
  }
  const base = context.createLinearGradient(0, 440, 0, 512);
  base.addColorStop(0, 'rgba(0,0,0,0)');
  base.addColorStop(1, 'rgba(0,0,0,0.6)');
  context.fillStyle = base;
  context.fillRect(0, 440, 512, 72);
  return toTexture(canvas);
}

/** 教室の木の床(フローリング)。1枚 = 1マス。 */
export function createFloorTexture(rng: Rng): THREE.CanvasTexture {
  const [canvas, context] = makeCanvas(512, 512);
  const plank = 64;
  for (let y = 0; y < 512; y += plank) {
    let x = -Math.floor(rng() * 200);
    while (x < 512) {
      const length = 180 + rng() * 220;
      const tone = 95 + rng() * 30;
      context.fillStyle = `rgb(${tone + 40}, ${tone + 8}, ${tone - 30})`;
      context.fillRect(x, y, length, plank);
      // 木目
      context.strokeStyle = 'rgba(60, 35, 15, 0.22)';
      context.lineWidth = 1;
      for (let k = 0; k < 6; k += 1) {
        const gy = y + 6 + rng() * (plank - 12);
        context.beginPath();
        context.moveTo(x, gy);
        context.bezierCurveTo(x + length * 0.3, gy + (rng() - 0.5) * 8, x + length * 0.7, gy + (rng() - 0.5) * 8, x + length, gy);
        context.stroke();
      }
      context.fillStyle = 'rgba(30, 18, 8, 0.9)';
      context.fillRect(x, y, 2, plank);
      x += length;
    }
    context.fillStyle = 'rgba(30, 18, 8, 0.9)';
    context.fillRect(0, y, 512, 2);
  }
  // ワックスの剥げと上履きの黒い擦れ跡
  stains(context, rng, 512, 512, 10, 'rgba(25, 15, 8, 0.35)');
  context.strokeStyle = 'rgba(20, 20, 20, 0.35)';
  context.lineWidth = 2;
  for (let i = 0; i < 10; i += 1) {
    const x = rng() * 512;
    const y = rng() * 512;
    context.beginPath();
    context.arc(x, y, 8 + rng() * 18, rng() * 6, rng() * 6 + 1.2);
    context.stroke();
  }
  return toTexture(canvas);
}

/** 天井の吸音ボード(小さな穴のある白い板)。 */
export function createCeilingTexture(rng: Rng): THREE.CanvasTexture {
  const [canvas, context] = makeCanvas(256, 256);
  context.fillStyle = '#8d8a83';
  context.fillRect(0, 0, 256, 256);
  context.fillStyle = 'rgba(40, 38, 34, 0.5)';
  for (let i = 0; i < 900; i += 1) context.fillRect(rng() * 256, rng() * 256, 1.5, 1.5);
  context.strokeStyle = '#5c5a55';
  context.lineWidth = 3;
  for (let i = 0; i <= 256; i += 128) {
    context.beginPath();
    context.moveTo(i, 0);
    context.lineTo(i, 256);
    context.moveTo(0, i);
    context.lineTo(256, i);
    context.stroke();
  }
  stains(context, rng, 256, 256, 6, 'rgba(110, 80, 40, 0.45)');
  return toTexture(canvas);
}

/** ランドセルザメ・ガブガブーノを子どもの絵で描く。 */
function drawGabugabuno(context: CanvasRenderingContext2D, rng: Rng, cx: number, cy: number, scale: number): void {
  context.save();
  context.translate(cx, cy);
  context.scale(scale, scale);
  context.lineWidth = 4;
  context.lineJoin = 'round';
  // 足
  context.strokeStyle = '#2b2b2b';
  wobblyLine(context, rng, [[-22, 50], [-26, 110], [-30, 150]]);
  wobblyLine(context, rng, [[22, 50], [26, 110], [30, 150]]);
  context.fillStyle = '#ffffff';
  context.fillRect(-48, 148, 26, 12);
  context.fillRect(24, 148, 26, 12);
  // ランドセル本体
  context.fillStyle = '#d0262f';
  context.beginPath();
  context.moveTo(-55, 55);
  context.lineTo(-55, -35);
  context.quadraticCurveTo(-55, -70, 0, -72);
  context.quadraticCurveTo(55, -70, 55, -35);
  context.lineTo(55, 55);
  context.closePath();
  context.fill();
  context.stroke();
  // 背びれ
  context.fillStyle = '#7d8aa0';
  context.beginPath();
  context.moveTo(-10, -70);
  context.lineTo(18, -112);
  context.lineTo(22, -70);
  context.closePath();
  context.fill();
  context.stroke();
  // 口と歯
  context.fillStyle = '#2a0508';
  context.beginPath();
  context.ellipse(0, 12, 42, 20, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#ffffff';
  for (let i = 0; i < 7; i += 1) {
    const x = -36 + i * 12;
    context.beginPath();
    context.moveTo(x, -6);
    context.lineTo(x + 6, 6);
    context.lineTo(x + 12, -6);
    context.fill();
    context.beginPath();
    context.moveTo(x, 30);
    context.lineTo(x + 6, 18);
    context.lineTo(x + 12, 30);
    context.fill();
  }
  // 目
  context.fillStyle = '#111';
  context.beginPath();
  context.arc(-26, -30, 9, 0, Math.PI * 2);
  context.arc(26, -30, 9, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#fff';
  context.beginPath();
  context.arc(-23, -33, 3, 0, Math.PI * 2);
  context.arc(29, -33, 3, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

/** 学校の掲示物(手配書、時間割、子どもの絵)。 */
export function createPosterTexture(rng: Rng, variant: number): THREE.CanvasTexture {
  const [canvas, context] = makeCanvas(384, 512);
  const kind = variant % 3;
  if (kind === 0) {
    // 注意喚起ポスター
    context.fillStyle = '#f3e7b0';
    context.fillRect(0, 0, 384, 512);
    context.fillStyle = '#c4262f';
    context.fillRect(0, 0, 384, 86);
    context.fillStyle = '#fff';
    context.font = `bold 46px ${KID_FONT}`;
    context.textAlign = 'center';
    context.fillText('ちゅうい!', 192, 60);
    drawGabugabuno(context, rng, 192, 230, 1.05);
    context.fillStyle = '#2a1a10';
    context.font = `bold 30px ${KID_FONT}`;
    context.fillText('ガブガブーノを', 192, 432);
    context.fillText('みたら にげよう', 192, 472);
  } else if (kind === 1) {
    // 時間割(最後のコマだけ様子がおかしい)
    context.fillStyle = '#eef3f6';
    context.fillRect(0, 0, 384, 512);
    context.fillStyle = '#2f6fd1';
    context.font = `bold 38px ${KID_FONT}`;
    context.textAlign = 'center';
    context.fillText('じかんわり', 192, 56);
    const rows = ['こくご', 'さんすう', 'たいいく', 'きゅうしょく', 'おんがく', 'ガブガブ'];
    context.strokeStyle = '#6c7a86';
    context.lineWidth = 2;
    rows.forEach((label, i) => {
      const y = 86 + i * 68;
      context.strokeRect(30, y, 324, 60);
      context.fillStyle = '#1d2a35';
      context.font = `bold 24px ${PLAIN_FONT}`;
      context.textAlign = 'left';
      context.fillText(`${i + 1}`, 46, y + 39);
      context.fillStyle = i === 5 ? '#b3121c' : '#1d2a35';
      context.font = `bold 28px ${KID_FONT}`;
      context.fillText(label, 100, y + 40);
    });
  } else {
    // 子どもの絵「ぼくの ともだち」
    context.fillStyle = '#fbfaf4';
    context.fillRect(0, 0, 384, 512);
    context.fillStyle = '#7cc0e8';
    context.fillRect(0, 0, 384, 300);
    context.fillStyle = '#7bc46a';
    context.fillRect(0, 300, 384, 212);
    drawGabugabuno(context, rng, 230, 200, 1.1);
    // 小さな人(棒人間)
    context.strokeStyle = '#222';
    context.lineWidth = 4;
    wobblyLine(context, rng, [[70, 300], [70, 360]]);
    wobblyLine(context, rng, [[70, 320], [45, 340]]);
    wobblyLine(context, rng, [[70, 320], [95, 340]]);
    wobblyLine(context, rng, [[70, 360], [55, 400]]);
    wobblyLine(context, rng, [[70, 360], [85, 400]]);
    context.beginPath();
    context.arc(70, 285, 15, 0, Math.PI * 2);
    context.stroke();
    context.fillStyle = '#222';
    context.font = `bold 30px ${KID_FONT}`;
    context.textAlign = 'center';
    context.fillText('ぼくの ともだち', 192, 460);
    context.font = `20px ${KID_FONT}`;
    context.fillText('6ねん2くみ', 192, 494);
  }
  // 経年劣化
  context.globalCompositeOperation = 'multiply';
  stains(context, rng, 384, 512, 14, 'rgba(120, 95, 60, 0.45)');
  context.globalCompositeOperation = 'source-over';
  context.fillStyle = 'rgba(30, 25, 20, 0.95)';
  context.beginPath();
  context.moveTo(384, 0);
  context.lineTo(384 - 30 - rng() * 50, 0);
  context.lineTo(384, 40 + rng() * 60);
  context.fill();
  return toTexture(canvas, false);
}

/** 多目的ホールの「学校目標」の大看板。 */
export function createMottoTexture(): THREE.CanvasTexture {
  const [canvas, context] = makeCanvas(512, 384);
  context.fillStyle = '#f6efe0';
  context.fillRect(0, 0, 512, 384);
  context.strokeStyle = '#c4262f';
  context.lineWidth = 12;
  context.strokeRect(10, 10, 492, 364);
  context.fillStyle = '#c4262f';
  context.font = `bold 40px ${KID_FONT}`;
  context.textAlign = 'center';
  context.fillText('がっこうの めあて', 256, 80);
  context.fillStyle = '#1d2a35';
  context.font = `bold 58px ${KID_FONT}`;
  context.fillText('えがお', 256, 160);
  context.fillText('げんき', 256, 232);
  context.fillStyle = '#b3121c';
  context.fillText('ガブガブ', 256, 304);
  context.fillStyle = 'rgba(120, 90, 50, 0.3)';
  context.fillRect(0, 330, 512, 54);
  return toTexture(canvas, false);
}

/** 黒板(チョークで同じ言葉が何度も書かれている)。 */
export function createChalkboardTexture(rng: Rng, lines: string[]): THREE.CanvasTexture {
  const [canvas, context] = makeCanvas(1024, 384);
  context.fillStyle = '#20402f';
  context.fillRect(0, 0, 1024, 384);
  // 消し残し
  for (let i = 0; i < 30; i += 1) {
    context.fillStyle = `rgba(220, 230, 220, ${0.03 + rng() * 0.05})`;
    context.fillRect(rng() * 1024, rng() * 384, 80 + rng() * 200, 20 + rng() * 40);
  }
  context.fillStyle = 'rgba(235, 240, 230, 0.85)';
  context.textAlign = 'left';
  lines.forEach((line, i) => {
    context.font = `bold ${44 + (i % 2) * 6}px ${KID_FONT}`;
    context.save();
    context.translate(40 + (rng() - 0.5) * 30, 70 + i * 62);
    context.rotate((rng() - 0.5) * 0.06);
    context.fillText(line, 0, 0);
    context.restore();
  });
  // 木枠とチョーク受け
  context.strokeStyle = '#6a4a2c';
  context.lineWidth = 18;
  context.strokeRect(0, 0, 1024, 384);
  return toTexture(canvas, false);
}

/** 掲示板「6ねん2くみの なかまたち」(ブレインロット仲間の紹介カード)。 */
export function createClassmatesTexture(rng: Rng): THREE.CanvasTexture {
  const [canvas, context] = makeCanvas(768, 384);
  context.fillStyle = '#9a6b3f';
  context.fillRect(0, 0, 768, 384);
  for (let i = 0; i < 1500; i += 1) {
    context.fillStyle = 'rgba(60, 35, 15, 0.25)';
    context.fillRect(rng() * 768, rng() * 384, 2, 2);
  }
  context.fillStyle = '#fff6d6';
  context.font = `bold 34px ${KID_FONT}`;
  context.textAlign = 'center';
  context.fillText('6ねん2くみの なかまたち', 384, 46);
  const cards: { name: string; draw: (ctx: CanvasRenderingContext2D) => void }[] = [
    {
      name: 'チョーク・ワニーニ',
      draw: (ctx) => {
        ctx.fillStyle = '#f2f2ee';
        ctx.fillRect(-60, -12, 110, 26);
        ctx.fillStyle = '#3c8a4a';
        ctx.beginPath();
        ctx.moveTo(50, -12);
        ctx.lineTo(80, -4);
        ctx.lineTo(50, 14);
        ctx.fill();
        ctx.fillStyle = '#111';
        ctx.beginPath();
        ctx.arc(40, -4, 3, 0, Math.PI * 2);
        ctx.fill();
      },
    },
    {
      name: 'ぎゅうにゅうパック・ペンギーノ',
      draw: (ctx) => {
        ctx.fillStyle = '#f7f7f7';
        ctx.fillRect(-28, -30, 56, 70);
        ctx.fillStyle = '#2f6fd1';
        ctx.fillRect(-28, 0, 56, 18);
        ctx.fillStyle = '#e0a02c';
        ctx.beginPath();
        ctx.moveTo(-6, -12);
        ctx.lineTo(6, -12);
        ctx.lineTo(0, -2);
        ctx.fill();
        ctx.fillStyle = '#111';
        ctx.beginPath();
        ctx.arc(-10, -20, 3, 0, Math.PI * 2);
        ctx.arc(10, -20, 3, 0, Math.PI * 2);
        ctx.fill();
      },
    },
    {
      name: 'うわばき・ドラゴンチーノ',
      draw: (ctx) => {
        ctx.fillStyle = '#f7f7f7';
        ctx.beginPath();
        ctx.ellipse(0, 10, 58, 22, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#d0262f';
        ctx.beginPath();
        ctx.ellipse(40, 10, 20, 18, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#4caf50';
        ctx.beginPath();
        ctx.moveTo(-40, -8);
        ctx.lineTo(-30, -36);
        ctx.lineTo(-18, -8);
        ctx.moveTo(-10, -10);
        ctx.lineTo(0, -38);
        ctx.lineTo(10, -10);
        ctx.fill();
      },
    },
  ];
  cards.forEach((card, i) => {
    const x = 30 + i * 246;
    context.save();
    context.translate(x + 110, 210);
    context.rotate((rng() - 0.5) * 0.08);
    context.fillStyle = '#fbfaf4';
    context.fillRect(-110, -130, 220, 280);
    context.fillStyle = '#d0262f';
    context.beginPath();
    context.arc(0, -122, 7, 0, Math.PI * 2);
    context.fill();
    context.save();
    context.translate(0, -20);
    card.draw(context);
    context.restore();
    context.fillStyle = '#222';
    context.font = `bold ${card.name.length > 10 ? 15 : 19}px ${KID_FONT}`;
    context.textAlign = 'center';
    context.fillText(card.name, 0, 110);
    context.restore();
  });
  return toTexture(canvas, false);
}

export function createSignTexture(text: string, color: string, background: string): THREE.CanvasTexture {
  const [canvas, context] = makeCanvas(256, 96);
  context.fillStyle = background;
  context.fillRect(0, 0, 256, 96);
  context.strokeStyle = color;
  context.lineWidth = 6;
  context.strokeRect(6, 6, 244, 84);
  context.fillStyle = color;
  context.font = `bold ${text.length > 3 ? 40 : 52}px ${PLAIN_FONT}`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, 128, 50);
  return toTexture(canvas, false);
}

/** 壁の赤い落書き(透過)。 */
export function createScrawlTexture(text: string): THREE.CanvasTexture {
  const [canvas, context] = makeCanvas(512, 256);
  context.clearRect(0, 0, 512, 256);
  context.fillStyle = 'rgba(170, 22, 30, 0.85)';
  context.font = `bold 76px ${KID_FONT}`;
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

/** ランドセルの名札(モンスターの側面に貼る)。 */
export function createNameTagTexture(): THREE.CanvasTexture {
  const [canvas, context] = makeCanvas(256, 128);
  context.fillStyle = '#fbfaf4';
  context.fillRect(0, 0, 256, 128);
  context.strokeStyle = '#2f6fd1';
  context.lineWidth = 6;
  context.strokeRect(4, 4, 248, 120);
  context.fillStyle = '#222';
  context.font = `bold 24px ${KID_FONT}`;
  context.textAlign = 'center';
  context.fillText('6ねん2くみ', 128, 48);
  context.font = `bold 30px ${KID_FONT}`;
  context.fillText('ガブガブーノ', 128, 96);
  return toTexture(canvas, false);
}
