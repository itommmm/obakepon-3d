// ===== 設定（Roblox: 共有ModuleScript）=====
const K = { // w,h: 大きさ / col: 弾ける綿の色 / u: 登場WAVE / at: 出現場所 d=机 f=床 a=空中 b=ボス専用
  bunny: { nm:'ぬいぴょん', w:.5,  h:.7,  col:0xff9ad0, hp:1, pts:30,  ttl:2.2, at:'dfa', wt:40, u:1, hop:1 },
  doll:  { nm:'にんぎょわらし', w:.45, h:.65, col:0x7a3aff, hp:1, pts:50,  ttl:2.5, at:'dfa', wt:30, u:1 },
  jack:  { nm:'びっくりんぼ', w:.55, h:1.05, col:0xffc83a, hp:3, pts:100, ttl:4,   at:'df',  wt:18, u:2 },
  gold:  { nm:'きんぴょん', w:.5,  h:.7,  col:0xffd23a, hp:1, pts:150, ttl:1.5, at:'dfa', wt:7,  u:2, bonus:1 },
  lanky: { nm:'ながうでん', w:1.1, h:1.25, col:0xb4e04a, hp:3, pts:120, ttl:4.5, at:'f',   wt:14, u:3 },
  chick: { nm:'ひよっこ（味方！）', w:.4,  h:.4,  col:0xffe95a, hp:1, pts:-50, ttl:2.4, at:'dfa', wt:12, u:4, decoy:1 },
  ball:  { nm:'ぽんぽんまる', w:.7, h:.7, col:0xff5a8a, hp:2, pts:80, ttl:3.5, at:'df', wt:14, u:2, split:1 },
  bear:  { nm:'ぬいぐま', w:.8, h:.95, col:0xc88a5a, hp:2, pts:90, ttl:99, at:'w', wt:12, u:3, walk:6 },
  boss:  { nm:'ミス・ニコニコ', w:1.4, h:2.5, col:0xff9a2a, hp:25, pts:1000, ttl:50, at:'b', wt:0, u:99, boss:1 }
};
const SP = [[-2.4,.77,3.2,'d'],[0,.77,1.2,'d'],[2.4,.77,-.8,'d'],[-2.4,.77,-2.8,'d'],[0,.77,-2.8,'d'],[2.4,.77,3.2,'d'],
  [-1.2,0,2.2,'f'],[1.2,0,.2,'f'],[-1.2,0,-1.8,'f'],[1.2,0,-3.8,'f'],[-3.7,0,-5.5,'f'],[3.7,0,-5.5,'f'],
  [-3.6,1.8,-2,'a'],[3.6,1.6,-3.5,'a'],[0,1.9,-5.2,'a'],[-3.5,1.7,1.5,'a'],[0,0,-5.4,'b'],[-2.2,0,-5.6,'w'],[2.2,0,-5.6,'w']];
const WV = { gap:[1.5,1.2,1,.8,.6], max:[1,2,2,3,3], ttl:[1.2,1.05,.95,.85,.75] };
const GOAL = 24, TIME = 150, CD = { z:8, x:20 };
const DIFF = [{ n:'やさしい', mh:4, ttl:1.3, gap:1.25, sc:1 }, { n:'ふつう', mh:3, ttl:1, gap:1, sc:1.3 }, { n:'むずかしい', mh:2, ttl:.8, gap:.8, sc:1.7 }];
let DIFFI = 1; try { const sv = localStorage.getItem('obakeDiff'); if (sv !== null) DIFFI = +sv; } catch (e) {}
const RMO = matchMedia('(prefers-reduced-motion:reduce)').matches ? 0 : 1; // 揺れ演出の抑制

// ===== three.js 基本 =====
const $ = s => document.querySelector(s);
const COARSE = matchMedia('(pointer:coarse)').matches, HITK = COARSE ? 1.6 : 1, SWAY = COARSE ? .25 : 1, FURN = COARSE ? 2 : 4;
const R = new THREE.WebGLRenderer({ antialias:!COARSE, powerPreference:'high-performance' });
R.setPixelRatio(Math.min(devicePixelRatio, COARSE ? 1.75 : 2)); R.domElement.style.cssText = 'position:fixed;inset:0;touch-action:none'; document.body.prepend(R.domElement);
const S = new THREE.Scene(); S.background = new THREE.Color(0x0d0a24); S.fog = new THREE.Fog(0x1a1240, 9, 24);
const C = new THREE.PerspectiveCamera(62, 1, .1, 50); C.position.set(0, 1.45, 6.3); C.rotation.order = 'YXZ'; S.add(C);
const resize = () => { R.setSize(innerWidth, innerHeight); C.aspect = innerWidth / innerHeight; C.fov = C.aspect < 1 ? 78 : Math.min(62, 2 * Math.atan(Math.tan(44 * Math.PI / 180) / C.aspect) * 180 / Math.PI); C.updateProjectionMatrix(); };
addEventListener('resize', resize); addEventListener('orientationchange', () => setTimeout(resize, 250)); visualViewport && visualViewport.addEventListener('resize', resize); resize();
const tex = (w, h, f) => { const c = document.createElement('canvas'); c.width = w; c.height = h; f(c.getContext('2d'), w, h); return new THREE.CanvasTexture(c); };
const M = (c, o) => new THREE.MeshLambertMaterial(Object.assign({ color:c }, o));
const box = (w, h, d, m, x, y, z, p = S) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); p.add(o); return o; };
const plane = (w, h, t, x, y, z, ry = 0) => { const o = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map:t })); o.position.set(x, y, z); o.rotation.y = ry; S.add(o); return o; };
const glowT = tex(64, 64, x => { const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, '#fff'); g.addColorStop(.4, '#fff8'); g.addColorStop(1, '#fff0'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); });
const spr = (c, s) => { const o = new THREE.Sprite(new THREE.SpriteMaterial({ map:glowT, color:c, blending:THREE.AdditiveBlending, transparent:true, depthWrite:false })); o.scale.set(s, s, 1); return o; };

// ===== 教室 =====
const LT = []; const addL = l => { LT.push([l, l.intensity]); S.add(l); return l; };
addL(new THREE.HemisphereLight(0xffd8a8, 0x2a1840, .85));
const moonL = new THREE.DirectionalLight(0x8fb4ff, .7); moonL.position.set(-6, 4, 0); addL(moonL);
[[0,2.9,-3,0xff5ad2,1.5],[0,2.6,3,0x4ad0ff,1.1],[2.5,1.2,0,0xffc060,1]].forEach(([x, y, z, c, i]) => { const l = new THREE.PointLight(c, i, 10); l.position.set(x, y, z); addL(l); });
const ROOMW = box(9, 3.2, 14, M(0x5f86b8, { side:THREE.BackSide }), 0, 1.6, 0);
const wood = tex(256, 256, (x, w) => { for (let i = 0; i < 8; i++) { x.fillStyle = `hsl(28,45%,${30 + Math.random() * 10}%)`; x.fillRect(0, i * 32, w, 31); } });
wood.wrapS = wood.wrapT = THREE.RepeatWrapping; wood.repeat.set(4, 6);
const fl = new THREE.Mesh(new THREE.PlaneGeometry(9, 14), M(0xffffff, { map:wood })); fl.rotation.x = -Math.PI / 2; fl.position.y = .01; S.add(fl);
plane(4.6, 1.9, tex(512, 212, (x, w, h) => {
  x.fillStyle = '#1f3d52'; x.fillRect(0, 0, w, h); x.strokeStyle = '#d9a441'; x.lineWidth = 8; x.strokeRect(0, 0, w, h);
  x.fillStyle = '#ffe28a'; x.font = '900 26px "Hiragino Maru Gothic ProN",sans-serif'; x.fillText('あそぼうよ…ずっと、ずっと', 110, 36);
  x.fillStyle = '#fff'; [190, 322].forEach(a => { x.beginPath(); x.arc(a, 100, 34, 0, 7); x.fill(); });
  x.fillStyle = '#111'; [198, 314].forEach(a => { x.beginPath(); x.arc(a, 104, 8, 0, 7); x.fill(); });
  x.strokeStyle = '#ffb3e6'; x.lineWidth = 6; x.beginPath(); x.moveTo(110, 150); x.quadraticCurveTo(256, 250, 402, 150); x.stroke();
  x.fillStyle = '#fff'; for (let i = 0; i < 11; i++) { const t = (i + 1) / 12, X = 110 + 292 * t, Y = 150 + 200 * t * (1 - t); x.beginPath(); x.moveTo(X - 9, Y); x.lineTo(X, Y - 18); x.lineTo(X + 9, Y); x.fill(); }
}), 0, 1.7, -6.95);
const poster = (t, x) => plane(.9, .6, tex(180, 120, (c, w, h) => { c.fillStyle = '#e8dcc0'; c.fillRect(0, 0, w, h); c.fillStyle = '#333'; c.font = '900 20px "Hiragino Maru Gothic ProN",sans-serif'; t.forEach((s, i) => c.fillText(s, 20, 34 + i * 32)); }), x, 2.45, -6.95);
poster(['やさしく', 'たくましく', 'たのしく'], -2.9); poster(['みんなの', 'えがおで', 'あかるい学校'], 2.9);
plane(.5, .5, tex(64, 64, x => { x.fillStyle = '#ddd'; x.beginPath(); x.arc(32, 32, 30, 0, 7); x.fill(); x.strokeStyle = '#222'; x.lineWidth = 3; x.beginPath(); x.moveTo(32, 32); x.lineTo(32, 10); x.moveTo(32, 32); x.lineTo(48, 36); x.stroke(); }), 0, 2.75, -6.95);
const WINS = [];
const sky = tex(8, 64, x => { const g = x.createLinearGradient(0, 0, 0, 64); g.addColorStop(0, '#141c66'); g.addColorStop(1, '#3a4cb8'); x.fillStyle = g; x.fillRect(0, 0, 8, 64); });
const frm = M(0x2a2440);
for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
  const z = -4 + i * 3.2; WINS.push(plane(2.4, 1.4, sky, s * 4.49, 1.9, z, -s * Math.PI / 2));
  box(.06, 1.4, .06, frm, s * 4.46, 1.9, z); box(.06, .06, 2.4, frm, s * 4.46, 1.9, z);
}
const mo = new THREE.Mesh(new THREE.CircleGeometry(.22, 24), new THREE.MeshBasicMaterial({ color:0xfff6c8 })); mo.position.set(-4.47, 2.2, -.8); mo.rotation.y = Math.PI / 2; S.add(mo);
const tube = new THREE.MeshBasicMaterial({ color:0xcfe8ff });
for (const z of [4, 0, -4]) for (const x of [-1.5, 1.5]) box(.25, .05, 1.6, tube, x, 3.15, z);
const dm = M(0xc08a50), fm = M(0x555a6a);
for (const x of [-2.4, 0, 2.4]) for (const z of [3.2, 1.2, -.8, -2.8]) {
  box(.8, .05, .55, dm, x, .74, z);
  for (const [a, b] of [[-1,-1],[1,-1],[-1,1],[1,1]]) box(.04, .72, .04, fm, x + a * .36, .37, z + b * .24);
  box(.4, .04, .4, dm, x, .45, z + .65); box(.4, .4, .04, dm, x, .7, z + .85);
  box(.04, .45, .04, fm, x - .17, .22, z + .82); box(.04, .45, .04, fm, x + .17, .22, z + .82);
}

const BC = [0x3a8cff, 0xffd23a, 0xff5ad2, 0x4ad07a, 0xff8a2a];
[[-3.6,5,4.5],[3.5,5,5],[-3.9,5,-.5],[3.8,5,-1.5],[-3.3,5,-4.2],[3.3,5,-4.8],[-1.8,5,-5.8],[1.9,5,-5.9]].forEach(([x, , z], i) => {
  box(.3, .3, .3, M(BC[i % 5]), x, .15, z).rotation.y = i; box(.3, .3, .3, M(BC[(i + 2) % 5]), x + .05, .45, z).rotation.y = i * 2;
});
for (let i = 0; i < 17; i++) { const c = new THREE.Mesh(new THREE.CircleGeometry(.16, 3), new THREE.MeshBasicMaterial({ color:BC[i % 5], side:THREE.DoubleSide })); c.position.set(-4.2 + i * .52, 2.85 - Math.sin(i / 16 * Math.PI) * .35, -2); c.rotation.z = -Math.PI / 2; S.add(c); }
const ROOM = S.children.filter(o => o.isMesh);
const FL = new THREE.SpotLight(0xfff2cc, 0, 20, .4, .5); C.add(FL); C.add(FL.target); FL.target.position.set(0, 0, -5);
// ===== 懐中電灯ブラスター（一人称）=====
const gun = new THREE.Group(); C.add(gun); gun.rotation.y = .06;
const br = new THREE.Mesh(new THREE.CylinderGeometry(.07, .1, .6, 16), M(0x3a8cff)); br.rotation.x = Math.PI / 2; gun.add(br);
[[-.1,0xffd23a],[-.3,0xff5ad2]].forEach(([z, c]) => { const t = new THREE.Mesh(new THREE.TorusGeometry(.11, .025, 8, 20), new THREE.MeshBasicMaterial({ color:c })); t.position.z = z; gun.add(t); });
box(.08, .2, .1, M(0x2a1a4a), 0, -.14, .15, gun);
const mz = spr(0x6fe0ff, .3); mz.position.z = -.34; gun.add(mz);

// ===== おばけ =====
const FT = tex(128, 128, x => {
  x.fillStyle = '#ff9ac8aa'; [[14, 74], [114, 74]].forEach(([a, b]) => { x.beginPath(); x.ellipse(a, b, 11, 7, 0, 0, 7); x.fill(); });
  x.fillStyle = '#fff'; x.strokeStyle = '#1a0c2a'; x.lineWidth = 3;
  [38, 90].forEach(p => { x.beginPath(); x.arc(p, 38, 20, 0, 7); x.fill(); x.stroke(); });
  x.fillStyle = '#111'; [[41, 41], [87, 41]].forEach(([a, b]) => { x.beginPath(); x.arc(a, b, 5, 0, 7); x.fill(); });
  x.fillStyle = '#2a0a3a'; x.beginPath(); x.moveTo(8, 72); x.quadraticCurveTo(64, 152, 120, 72); x.quadraticCurveTo(64, 84, 8, 72); x.fill();
  x.fillStyle = '#fff';
  for (let i = 0; i < 9; i++) {
    const X = 20 + i * 11, t = (X - 8) / 112, yu = 72 + 24 * t * (1 - t), yb = 72 + 160 * t * (1 - t);
    x.beginPath(); x.moveTo(X - 5, yu); x.lineTo(X, yu + 13); x.lineTo(X + 5, yu); x.fill();
    x.beginPath(); x.moveTo(X - 5, yb); x.lineTo(X, yb - 12); x.lineTo(X + 5, yb); x.fill();
  }
  x.strokeStyle = '#ffffff99'; x.lineWidth = 2; x.setLineDash([5, 4]); x.beginPath(); x.moveTo(30, 8); x.lineTo(98, 8); x.stroke();
});
// ===== キャラクター造形（手続き型モデリング）=====
const STD = (c, r = .6, m = 0, o) => new THREE.MeshStandardMaterial(Object.assign({ color:c, roughness:r, metalness:m }, o));
const PH = (c, r = .2, o) => new THREE.MeshPhysicalMaterial(Object.assign({ color:c, roughness:r, clearcoat:1, clearcoatRoughness:.1 }, o));
const rep2 = t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
const FUR = rep2(tex(128, 128, x => { x.fillStyle = '#c8c8c8'; x.fillRect(0, 0, 128, 128); for (let i = 0; i < 420; i++) { x.strokeStyle = `hsl(0,0%,${55 + Math.random() * 45}%)`; const a = Math.random() * 128, b = Math.random() * 128; x.beginPath(); x.moveTo(a, b); x.lineTo(a + Math.random() * 6 - 3, b + 7); x.stroke(); } })); FUR.repeat.set(3, 3);
const FA = rep2(tex(128, 128, x => { x.fillStyle = '#000'; x.fillRect(0, 0, 128, 128); for (let i = 0; i < 700; i++) { x.fillStyle = `hsl(0,0%,${40 + Math.random() * 60}%)`; x.beginPath(); x.arc(Math.random() * 128, Math.random() * 128, 1 + Math.random() * 1.4, 0, 7); x.fill(); } })); FA.repeat.set(6, 4);
const FAS = [0, 1, 2, 3].map(i => { const t = FA.clone(); t.needsUpdate = true; t.offset.set(i * .23, i * .37); return t; });
const FM = c => STD(c, .95, 0, { bumpMap:FUR, bumpScale:2 });
// 環境マップ（光沢・金属の反射用）と足元の影
const envS = new THREE.Scene();
envS.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.MeshBasicMaterial({ side:THREE.BackSide, map:tex(256, 128, x => {
  const g = x.createLinearGradient(0, 0, 0, 128); g.addColorStop(0, '#6a5acd'); g.addColorStop(.5, '#2a1850'); g.addColorStop(1, '#120a28'); x.fillStyle = g; x.fillRect(0, 0, 256, 128);
  [[40, 40, '#ff5ad2'], [130, 30, '#4ad0ff'], [210, 50, '#ffd890']].forEach(([a, b, c]) => { const r = x.createRadialGradient(a, b, 0, a, b, 34); r.addColorStop(0, c); r.addColorStop(1, '#0000'); x.fillStyle = r; x.fillRect(a - 34, b - 34, 68, 68); });
}) })));
const pmrem = new THREE.PMREMGenerator(R); S.environment = pmrem.fromScene(envS).texture; pmrem.dispose();
const SHM = new THREE.MeshBasicMaterial({ map:tex(64, 64, x => { const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(0,0,0,.65)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); }), transparent:true, depthWrite:false });
// ジオメトリ工具
const soft = (g, a = .02, ph = Math.random() * 6) => { const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + a * Math.sin(x * 5 + ph) * Math.sin(y * 6 + ph * 1.3) * Math.sin(z * 4.5 + ph * .7); p.setXYZ(i, x * k, y * k, z * k); } g.computeVertexNormals(); return g; };
const wav = (g, n, a) => { const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), k = 1 + a * Math.sin(Math.atan2(z, x) * n); p.setX(i, x * k); p.setZ(i, z * k); } g.computeVertexNormals(); return g; };
const put = (m, p, x, y, z, rz = 0) => { m.position.set(x, y, z); m.rotation.z = rz; p.add(m); return m; };
const SGEO = Array.from({ length:6 }, () => soft(new THREE.SphereGeometry(1, 28, 20)));
const sph = (r, c, x, y, z, p, mat, fur) => { // 柔らかく歪ませた球。fur=1でシェル法の毛並み
  const m = new THREE.Mesh(SGEO[Math.random() * SGEO.length | 0], mat || FM(c)); m.scale.set(r[0], r[1], r[2]); m.position.set(x, y, z); p.add(m);
  if (fur) for (let i = 1; i <= FURN; i++) { const f = new THREE.Mesh(m.geometry, STD(c, 1, 0, { alphaMap:FAS[i - 1], alphaTest:.45 })); f.scale.setScalar(1 + i * .02); m.add(f); }
  return m;
};
const limb = (r, len, c, mat) => { const pts = []; for (let i = 0; i <= 8; i++) { const a = i / 8 * Math.PI / 2; pts.push(new THREE.Vector2(Math.sin(a) * r, -len / 2 - Math.cos(a) * r)); } for (let i = 0; i <= 8; i++) { const a = i / 8 * Math.PI / 2; pts.push(new THREE.Vector2(Math.cos(a) * r, len / 2 + Math.sin(a) * r)); } return new THREE.Mesh(new THREE.LatheGeometry(pts, 16), mat || FM(c)); };
const lathe = (pts, mat) => new THREE.Mesh(new THREE.LatheGeometry(pts.map(q => new THREE.Vector2(q[0], q[1])), 32), mat);
const cyl = (rt, rb, h, mat) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 16), mat);
const rbox = (w, h, d, r, mat) => { const s = new THREE.Shape(), x = -w / 2, y = -h / 2; s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, { depth:d, bevelEnabled:true, bevelThickness:r * .5, bevelSize:r * .5, bevelSegments:3, curveSegments:6 }); g.translate(0, 0, -d / 2); return new THREE.Mesh(g, mat); };
const earGeo = (len, w) => { const s = new THREE.Shape(); s.moveTo(0, 0); s.bezierCurveTo(w, len * .1, w, len * .8, 0, len); s.bezierCurveTo(-w, len * .8, -w, len * .1, 0, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth:.012, bevelEnabled:true, bevelThickness:.012, bevelSize:.012, bevelSegments:3, curveSegments:12 }), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) - 1.2 * p.getY(i) * p.getY(i)); g.computeVertexNormals(); return g; };
const sub = (p, y = 0, sc = 1) => { const b = new THREE.Group(); b.position.y = y; b.scale.setScalar(sc); p.add(b); return b; };
const sw = (o, a, ph = 0) => { let r = o; while (r.parent) r = r.parent; (r.userData.sw = r.userData.sw || []).push({ o, a, p:ph, b:o.rotation.z }); };
const arm = (p, x, y, len, r, c, hc, rz, fing = 0) => {
  const a = new THREE.Group(); a.position.set(x, y, 0); a.rotation.z = rz; p.add(a);
  put(limb(r, len, c), a, 0, -len / 2, 0); sph([r * 1.7, r * 1.7, r * 1.5], hc, 0, -len - r * .3, 0, a);
  for (let i = 0; i < fing; i++) put(limb(r * .38, r * 1.6, hc), a, (i - 1) * r * 1.2, -len - r * 2.4, 0, (1 - i) * .15);
  sw(a, .25, x * 9); return a;
};
// 顔：曲面に貼る口腔・ほっぺ＋本物の3Dの目・歯・鼻
const onH = (r, c, az, el, k = 1) => new THREE.Vector3(r[0] * Math.cos(el) * Math.sin(az) * k + c[0], r[1] * Math.sin(el) * k + c[1], r[2] * Math.cos(el) * Math.cos(az) * k + c[2]);
const arc = (r, c, az, e0, e1, n) => Array.from({ length:n }, (_, i) => onH(r, c, az, e0 + (e1 - e0) * i / (n - 1), 1.04));
const xs = (p, pts, col = 0x2a1a3a) => { const g = new THREE.BoxGeometry(.004, .024, .004), m = new THREE.MeshBasicMaterial({ color:col }); pts.forEach(v => [.8, -.8].forEach(a => { const b = new THREE.Mesh(g, m); b.position.copy(v); b.rotation.z = a; p.add(b); })); };
const fpatch = (p, r, c, tx, wa = 1.6, ha = 1.4) => { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16, Math.PI / 2 - wa / 2, wa, Math.PI / 2 - ha / 2, ha), new THREE.MeshBasicMaterial({ map:tx, transparent:true })); m.scale.set(r[0] * 1.035, r[1] * 1.035, r[2] * 1.035); m.position.set(c[0], c[1], c[2]); p.add(m); };
const mkFace = o => tex(256, 256, x => {
  x.globalAlpha = .7; [[34, 150], [222, 150]].forEach(([a, b]) => { x.fillStyle = o.cheek; x.beginPath(); x.ellipse(a, b, 24, 15, 0, 0, 7); x.fill(); }); x.globalAlpha = 1;
  if (o.brow) { x.strokeStyle = '#1a0c2a'; x.lineWidth = 9; [78, 178].forEach(a => { x.beginPath(); x.moveTo(a - 36, 40); x.quadraticCurveTo(a, 14, a + 36, 40); x.stroke(); }); }
  x.fillStyle = '#2a0a3a'; x.beginPath(); x.moveTo(16, 144); x.quadraticCurveTo(128, 304, 240, 144); x.quadraticCurveTo(128, 168, 16, 144); x.fill();
  x.fillStyle = '#ff7aa8'; x.beginPath(); x.ellipse(128, 206, 30, 14, 0, 0, 7); x.fill();
});
const EB = new THREE.SphereGeometry(1, 24, 16);
const disp = o => o.traverse(c => { if (c.geometry && !c.isSprite && c.geometry !== EB && !SGEO.includes(c.geometry)) c.geometry.dispose(); if (c.material && c.material !== SHM) [].concat(c.material).forEach(m => m.dispose()); });
const eye = (p, pos, s, o = {}) => {
  const e = new THREE.Group(); e.position.copy(pos); e.rotation.set(-(o.el || 0) * .8, (o.az || 0) * .9, 0); p.add(e);
  const q = (mat, sx, sy, sz, z, x = 0, y = 0) => { const m = new THREE.Mesh(EB, mat); m.scale.set(s * sx, s * sy, s * sz); m.position.set(s * x, s * y, s * z); e.add(m); };
  q(PH(o.ball || 0xffffff, .12), 1, 1, 1, 0);
  if (!o.noIris) { q(STD(o.iris || 0x2a1a3a, .3), .62, .62, .22, .86); q(new THREE.MeshBasicMaterial({ color:0 }), .3, .3, .1, .98); }
  q(new THREE.MeshBasicMaterial({ color:0xffffff }), .13, .13, .06, 1.02, .28, .3);
  if (o.lid !== 0) { const l = new THREE.Mesh(new THREE.SphereGeometry(1.08, 18, 10, 0, Math.PI * 2, 0, o.lid || 1), STD(o.lc || 0xffffff, .8)); l.scale.setScalar(s); l.rotation.x = o.tilt ?? .5; e.add(l); }
  if (o.lash) for (let k = -2; k <= 2; k++) { const l = new THREE.Mesh(new THREE.ConeGeometry(s * .06, s * .5, 5), new THREE.MeshBasicMaterial({ color:0x1a0c2a })); l.position.set(s * k * .42, s * (1.05 - Math.abs(k) * .1), s * .55); l.rotation.z = -k * .35; e.add(l); }
};
const face3d = (p, r, c, o) => {
  fpatch(p, r, c, o.tex);
  const A = (t, up) => { const X = 16 + 224 * t, y = up ? 144 + 48 * t * (1 - t) : 144 + 320 * t * (1 - t); return [-.8 + 1.6 * X / 256, .7 - 1.4 * y / 256]; };
  const tw = r[0] * (o.sq ? .05 : .065), th = r[0] * .14, g = o.sq ? new THREE.BoxGeometry(tw * 1.9, th, tw) : new THREE.ConeGeometry(tw, th, 6), m = PH(0xfff6e8, .35);
  for (let i = 0; i < o.teeth; i++) [1, 0].forEach(up => {
    const [az, el] = A(.08 + .84 * i / (o.teeth - 1), up), P = onH(r, c, az, el, 1.04), t = new THREE.Mesh(g, m);
    t.position.set(P.x, P.y + (up ? -th / 2 : th / 2), P.z - tw * .2); if (!o.sq && up) t.rotation.z = Math.PI; p.add(t);
  });
  const ea = o.ea || .31, ee = o.ee || .24;
  [-1, 1].forEach(s => eye(p, onH(r, c, s * ea, ee, .985), o.es, Object.assign({ az:s * ea, el:ee }, o.e)));
  if (o.nose) { const n = new THREE.Mesh(EB, PH(o.nose, .15)); n.scale.set(o.nr * 1.1, o.nr, o.nr); n.position.copy(onH(r, c, 0, .05, 1.03)); p.add(n); }
};
const FACE = {
  bunny: { tex:mkFace({ cheek:'#ff7aa8' }), teeth:9, es:.045, nose:0xff5a8a, nr:.018, e:{ iris:0x2a1a3a, lid:.9, tilt:.35, lc:0xff9ad0 } },
  doll:  { tex:mkFace({ cheek:'#ff8aa0' }), teeth:8, sq:1, es:.052, e:{ iris:0x6a3a2a, lid:1, tilt:.2, lc:0xffe6d4, lash:1 } },
  jack:  { tex:mkFace({ cheek:'#ff7aa8', brow:1 }), teeth:9, es:.058, nose:0xff6a3a, nr:.036, e:{ iris:0x3a8cff, lid:.8, tilt:.2, lc:0xfdf0ff } },
  bear:  { tex:mkFace({ cheek:'#ff9a7a' }), teeth:9, es:.05, nose:0x3a2a2a, nr:.03, e:{ iris:0x3a2010, lid:.8, tilt:.3, lc:0xc88a5a } },
  lanky: { tex:mkFace({ cheek:'#8fd04a' }), teeth:13, es:.03, ea:.3, ee:.42, e:{ ball:0x14091f, noIris:1, lid:0 } }
};
const BUILD = { // 原点は高さの中心
  bunny: (g, c = 0xff9ad0, e = 0xffc4e4, gold) => { // ぬいぐるみウサギ：シェル毛並み・押し出し成形の耳・縫い目
    const b = sub(g, 0), HR = [.2, .17, .14], HC = [0, .02, 0];
    [-1, 1].forEach(s => {
      sph([.07, .04, .1], 0xd9709f, s * .09, -.31, .03, b);
      const E = new THREE.Group(); E.position.set(s * .09, .12, -.02); E.rotation.z = -s * .22; b.add(E); sw(E, .12, s * 2);
      put(new THREE.Mesh(earGeo(.3, .06), FM(c)), E, 0, 0, -.012); put(new THREE.Mesh(earGeo(.24, .035), STD(e, .7)), E, 0, .02, .014);
      arm(b, s * .15, -.1, .08, .03, c, c, s * .5); sph([.05, .03, .025], 0, s * .045, -.14, .105, b, PH(0x3a8cff, .3));
    });
    sph([.16, .15, .12], c, 0, -.17, 0, b, null, 1); sph([.05, .05, .05], 0xffffff, 0, -.22, -.13, b, null, 1); sph([.02, .02, .02], 0, 0, -.14, .115, b, PH(0xffd23a, .25));
    sph(HR, c, HC[0], HC[1], HC[2], b);
    if (gold) put(cyl(.06, .085, .07, STD(0xffd23a, .25, .9)), b, 0, .22, 0);
    face3d(b, HR, HC, FACE.bunny); xs(b, arc(HR, HC, 0, .55, 1.15, 5));
  },
  gold: g => BUILD.bunny(g, 0xffd23a, 0xfff0a0, 1),
  chick: g => { // 味方のヒヨコ
    const b = sub(g, 0), c = 0xffe95a;
    sph([.2, .19, .17], c, 0, 0, 0, b, null, 1); sph([.14, .1, .1], 0xfff6a8, 0, -.08, .08, b, null, 1);
    [-1, 1].forEach(s => {
      sph([.05, .09, .06], 0xffd23a, s * .2, -.02, 0, b).rotation.z = s * .5;
      eye(b, new THREE.Vector3(s * .08, .06, .15), .03, { noIris:1, ball:0x111111, lid:0, az:s * .5, el:.2 });
      sph([.035, .02, .01], 0xff9ac0, s * .13, -.03, .15, b); sph([.05, .02, .06], 0xff9a2a, s * .07, -.19, .04, b);
    });
    for (let i = -1; i <= 1; i++) sph([.02, .06, .02], c, i * .03, .2, 0, b);
    const bk = new THREE.Mesh(new THREE.ConeGeometry(.045, .1, 12), PH(0xff9a2a, .35)); bk.rotation.x = Math.PI / 2; bk.position.set(0, -.01, .2); b.add(bk);
    const h = spr(0xff9ad0, .22); h.position.set(0, .32, 0); b.add(h);
  },
  ball: g => { // ぽんぽんまる：つやつやのボール。撃つとわれてウサギ2体に分裂
    const b = sub(g, 0), HR = [.3, .3, .3], c = 0xff5a8a;
    sph(HR, 0, 0, 0, 0, b, PH(c, .25));
    [-1, 1].forEach(s => { sph([.09, .05, .12], 0, s * .13, -.3, .06, b, PH(0xffd23a, .3)); arm(b, s * .3, -.02, .12, .04, 0xffd23a, 0xffd23a, s * .6); });
    for (let i = 0; i < 3; i++) { const a = i * 2.1; sph([.05, .05, .05], 0, Math.cos(a) * .12, .29, Math.sin(a) * .12 - .05, b, PH(0x3a8cff, .25)); }
    face3d(b, HR, [0, 0, 0], FACE.bunny);
  },
  bear: g => { // ぬいぐま：奥から歩いて近づいてくる大きなクマ
    const b = sub(g, 0), c = 0xc88a5a, HR = [.26, .23, .2], HC = [0, .2, 0];
    [-1, 1].forEach(s => { sph([.09, .08, .09], c, s * .2, .4, -.02, b); sph([.05, .05, .04], 0xffc9a8, s * .2, .4, .03, b); put(limb(.07, .12, c), b, s * .12, -.38, 0); sph([.1, .05, .13], c, s * .12, -.5, .04, b); arm(b, s * .26, -.02, .2, .055, c, c, s * .35); });
    sph([.26, .3, .2], c, 0, -.15, 0, b, null, 1); sph([.14, .16, .04], 0xffc9a8, 0, -.18, .19, b);
    sph(HR, c, HC[0], HC[1], HC[2], b); face3d(b, HR, HC, FACE.bear);
  },
  boss: g => { const w = new THREE.Group(); w.scale.setScalar(2.4); g.add(w); BUILD.jack(w, true); },
  doll: g => { // おにんぎょう：陶器の顔・波打つドレスのフリル・まつ毛
    const b = sub(g, 0), sk = 0xffe6d4, HR = [.2, .2, .17], HC = [0, .12, 0], hair = STD(0x7a3aff, .45);
    [-1, 1].forEach(s => {
      put(limb(.025, .1, sk), b, s * .05, -.28, 0); sph([.045, .03, .065], 0, s * .05, -.34, .025, b, PH(0x222233, .25));
      arm(b, s * .12, -.05, .15, .025, sk, sk, s * .45); sph([.05, .05, .05], 0xff5aa8, s * .12, -.03, 0, b);
      sph([.05, .035, .03], 0, s * .2, .2, .03, b, PH(0xffd23a, .3)); sph([.075, .075, .075], 0, s * .2, .27, -.02, b, hair);
    });
    const dr = lathe([[.001, -.285], [.2, -.285], [.205, -.27], [.12, -.18], [.07, -.08], [.05, 0], [.001, .02]], FM(0xff5aa8)); wav(dr.geometry, 14, .045); b.add(dr);
    const fg = new THREE.TorusGeometry(.205, .022, 8, 48); fg.rotateX(Math.PI / 2); wav(fg, 16, .05); put(new THREE.Mesh(fg, STD(0xfff0f8, .8)), b, 0, -.28, 0);
    sph(HR, 0, HC[0], HC[1], HC[2], b, PH(sk, .35, { clearcoat:.4 })); sph([.215, .19, .185], 0, 0, .18, -.03, b, hair); sph([.2, .06, .05], 0, 0, .27, .13, b, hair);
    face3d(b, HR, HC, FACE.doll);
  },
  jack: (g, bs) => { // びっくり箱：角丸ボックス・金属のばね・道化／ボスは金の王冠
    const b = sub(g, -.1), main = bs ? 0x7a3aff : 0xffc83a, alt = bs ? 0xffd23a : 0x3a8cff, HR = [.26, .24, .21], metal = STD(0xdfe6f5, .25, .9), gold = STD(0xffd23a, .25, .9);
    put(rbox(.5, .34, .5, .03, PH(main, .3)), b, 0, -.28, 0);
    [-.15, 0, .15].forEach(x => put(rbox(.05, .3, .01, .004, PH(alt, .3)), b, x, -.28, .262));
    put(rbox(.5, .04, .25, .01, PH(alt, .3)), b, 0, -.08, -.28).rotation.x = .9;
    put(cyl(.015, .015, .14, metal), b, .32, -.28, 0, Math.PI / 2); sph([.04, .04, .04], 0, .39, -.28, 0, b, PH(0xff5ad2, .25));
    const pts = []; for (let i = 0; i <= 40; i++) pts.push(new THREE.Vector3(Math.cos(i * .9) * .07, -.1 + i * .0065, Math.sin(i * .9) * .07));
    b.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, .012, 8), metal));
    [-1, 1].forEach(s => arm(b, s * .3, -.12, .2, .035, 0xfdf0ff, 0xffffff, s * .9, 3));
    const rg = new THREE.TorusGeometry(.19, .045, 10, 48); rg.rotateX(Math.PI / 2); wav(rg, 12, .06); b.add(new THREE.Mesh(rg, STD(0xff5ad2, .7)));
    const hd = new THREE.Group(); hd.position.y = .22; b.add(hd); sw(hd, .08, 1.7);
    sph(HR, 0, 0, 0, 0, hd, PH(0xfdf0ff, .35, { clearcoat:.5 })); [-1, 1].forEach(s => sph([.1, .1, .08], 0xff7a2a, s * .27, .06, 0, hd, null, 1));
    face3d(hd, HR, [0, 0, 0], FACE.jack);
    if (!bs) { put(lathe([[.001, 0], [.17, 0], [.19, .015], [.15, .03], [.1, .18], [.045, .32], [.02, .35], [.001, .36]], PH(0x7a3aff, .35)), hd, 0, .2, 0); sph([.04, .04, .04], 0, 0, .57, 0, hd, STD(0xffffff, .9)); }
    else { put(cyl(.15, .18, .14, gold), hd, 0, .27, 0); for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2, X = Math.cos(a) * .14, Z = Math.sin(a) * .14; put(new THREE.Mesh(new THREE.ConeGeometry(.04, .1, 8), gold), hd, X, .38, Z); sph([.02, .02, .02], 0, X, .45, Z, hd, PH([0xff5ad2, 0x5ad2ff, 0x4ad07a][i % 3], .1)); } }
  },
  lanky: g => { // ながうでくん：回転体の胴・長い腕と指・縫い目・ギザ歯
    const b = sub(g, -.05, .85), c = 0xb4e04a, HR = [.27, .24, .22];
    [-1, 1].forEach(s => { put(limb(.07, .3, c), b, s * .12, -.42, 0); sph([.1, .05, .14], c, s * .12, -.62, .05, b); arm(b, s * .32, .3, .9, .05, c, 0xffd23a, s * .25, 3); });
    b.add(lathe([[.001, -.5], [.2, -.48], [.3, -.3], [.28, 0], [.2, .3], [.1, .48], [.001, .5]], FM(c)));
    sph([.17, .28, .05], 0xe8f5b0, 0, -.08, .255, b, null, 1); xs(b, Array.from({ length:7 }, (_, i) => new THREE.Vector3(0, .1 - i * .07, .3)));
    const hd = new THREE.Group(); hd.position.y = .55; b.add(hd); sw(hd, .06, 0);
    sph(HR, c, 0, 0, 0, hd);
    [-1, 1].forEach(s => { sph([.07, .07, .05], c, s * .25, .08, 0, hd); sph([.04, .04, .03], 0xff9ad0, s * .25, .08, .03, hd); });
    for (let i = -1; i <= 1; i++) put(new THREE.Mesh(new THREE.ConeGeometry(.04, .14, 8), PH(0xffd23a, .4)), hd, i * .09, .27, 0, -i * .3);
    face3d(hd, HR, [0, 0, 0], FACE.lanky);
  }
};
const mon = [], tg = [], fx = [], G = {};
const T = new THREE.Vector3(0, 1.3, 5.6);
const pj = (v, dy = 0) => { const p = v.clone(); p.y += dy; p.project(C); return [(p.x + 1) / 2 * innerWidth, (1 - p.y) / 2 * innerHeight, p.z < 1]; };
const pt = (s, x, y) => { const d = document.createElement('div'); d.className = 'pt'; d.textContent = s; d.style.cssText = `left:${x}px;top:${y}px`; $('#fx').append(d); setTimeout(() => d.remove(), 700); };
const flash = c => { const f = $('#fl'); f.style.transition = 'none'; f.style.background = c; f.style.opacity = .22; setTimeout(() => { f.style.transition = 'opacity .45s'; f.style.opacity = 0; }, 30); };
let ac; const sfx = (f, d = .12, ty = 'sine', v = .08) => { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); const o = ac.createOscillator(), g = ac.createGain(), n = ac.currentTime; o.type = ty; o.frequency.value = f; g.gain.setValueAtTime(v, n); g.gain.exponentialRampToValueAtTime(.001, n + d); o.connect(g).connect(ac.destination); o.start(); o.stop(n + d); } catch (e) {} };
const burst = (p, c, n) => { for (let i = 0; i < n; i++) { const s = spr(c, .22 + Math.random() * .2); s.position.copy(p); S.add(s); fx.push({ s, v:new THREE.Vector3(Math.random() - .5, Math.random() * .8, Math.random() - .5).multiplyScalar(3), l:.5, m:.5 }); } };
const rm = m => { S.remove(m.g); disp(m.g); mon.splice(mon.indexOf(m), 1); const i = tg.indexOf(m.hb); i >= 0 && tg.splice(i, 1); m.bar && m.bar.remove(); };
const spawn = force => {
  if (G.space) return;
  const list = Object.entries(K).filter(([, k]) => G.wave + G.stage >= k.u); let r = Math.random() * list.reduce((s, [, k]) => s + k.wt, 0), t = list[0][0];
  for (const [n, k] of list) if ((r -= k.wt) < 0) { t = n; break; }
  if (force) t = force;
  const k = K[t], used = mon.map(m => m.sp), free = SP.map((_, i) => i).filter(i => !used.includes(i) && k.at.includes(SP[i][3]));
  if (!free.length) return;
  const si = free[Math.random() * free.length | 0], s = SP[si], g = new THREE.Group(), fs = Math.min(k.w * .9, k.h);
  BUILD[t](g);
  if (s[3] !== 'a') { const sh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), SHM); sh.rotation.x = -Math.PI / 2; sh.position.y = -k.h / 2 + .012; sh.scale.setScalar(k.w * 1.5); g.add(sh); }
  const a = spr(0xff4fd8, Math.max(k.w, k.h) * 2.4); a.position.z = -.1; g.add(a);
  const hb = new THREE.Mesh(new THREE.SphereGeometry(Math.max(k.w * .6, k.h * .5) * HITK * G.hk, 8, 6), new THREE.MeshBasicMaterial({ transparent:true, opacity:0, depthWrite:false })); g.add(hb);
  g.position.set(s[0], s[1] + k.h / 2, s[2]); g.scale.setScalar(.01); S.add(g);
  const H0 = k.boss ? (k.hp * (1 + .5 * G.stage) | 0) : k.hp; let bar = null; if (k.hp > 1) { bar = document.createElement('div'); bar.className = 'hpb'; bar.innerHTML = `HP <b>${H0}/${H0}</b><i><u style="width:100%"></u></i>`; $('#fx').append(bar); }
  const m = { g, k, sp:si, hp:H0, mx:H0, ttl:k.ttl * WV.ttl[G.wave - 1] * (k.boss ? 1 + .25 * G.stage : Math.pow(.93, G.stage)) * DIFF[DIFFI].ttl, age:0, st:'in', a, hb, bar, y:g.position.y }; hb.userData.m = m; mon.push(m); tg.push(hb); sfx([1047, 1175, 1319, 1568][Math.random() * 4 | 0], .35, 'sine', .04);
  if (!G.seen[t]) { G.seen[t] = 1; const [nx, ny] = pj(g.position, k.h * .6); pt(k.nm, nx, ny); }
};
const kill = m => {
  m.st = 'die'; const i = tg.indexOf(m.hb); i >= 0 && tg.splice(i, 1); m.bar && m.bar.remove(); m.bar = null;
  if (m.k.decoy) { G.score = Math.max(0, G.score + m.k.pts); G.combo = 0; G.left -= 3; flash('#ffe95a'); const [dx, dy] = pj(m.g.position); pt('いたっ！ ' + m.k.pts, dx, dy); burst(m.g.position, 0xffe95a, 8); sfx(180, .3, 'sawtooth', .1); return; }
  G.kills++; G.combo++; const gain = Math.round(m.k.pts * (1 + Math.min(G.combo / 5 | 0, 4) * .5) * (G.fever > 0 ? 2 : 1) * DIFF[DIFFI].sc); G.score += gain; G.sp = Math.min(100, G.sp + G.spk);
  const [x, y] = pj(m.g.position); pt('+' + gain, x, y); burst(m.g.position, 0xffffff, 10); burst(m.g.position, m.k.col, 6); sfx(660 + Math.min(G.combo, 12) * 35, .15);
  if (m.k.bonus) { G.fever = 8; G.ammo = 30; banner('フィーバー！', '8秒間 得点2ばい・弾も全回復'); }
  if (m.k.split) { spawn('bunny'); spawn('bunny'); sfx(520, .2, 'triangle'); }
  if (m.k.boss) { G.shk = .9 * RMO; stageClear(); }
};
const hitMon = (m, p, d = 1) => {
  if (m.st === 'die') return; m.hp -= d; burst(p, 0x9fe8ff, 4);
  if (m.bar) { m.bar.querySelector('b').textContent = Math.max(m.hp, 0) + '/' + m.mx; m.bar.querySelector('u').style.width = Math.max(m.hp, 0) / m.mx * 100 + '%'; }
  if (m.hp > 0) sfx(300, .08, 'square', .06); else kill(m);
};
const hurt = () => { if (!G.run) return; G.hp--; G.combo = 0; G.shk = .6 * RMO; flash('#ff4fd8'); sfx(110, .3, 'sawtooth', .1); if (G.hp <= 0) end('over'); };

const dim = v => { LT.forEach(([l, b]) => l.intensity = b * v); tube.color.setRGB(.81 * v, .91 * v, v); };
const resetFx = () => { dim(1); FL.intensity = 0; G.blk = 0; };
const banner = (t, sub) => { const b = $('#bn'); b.querySelector('b').textContent = t; b.querySelector('small').textContent = sub; b.classList.remove('show'); void b.offsetWidth; b.classList.add('show'); };
const WAVES = [['WAVE 1  ねむれないよる', '誰もいない夜の学校。置き忘れのおもちゃが、こっちを見てる…'], ['WAVE 2  ていでん', 'あかりが消えた！ぽんぽんまるは撃つとわれるよ'], ['WAVE 3  おもちゃの大行進', 'ウサギが跳ねる！奥からぬいぐまが近づいてくる'], ['WAVE 4  おともだち？', 'ヒヨコは撃っちゃダメ。金のウサギはごほうび'], ['WAVE 5  ミス・ニコニコ', 'でっかいびっくり箱が目をさました…']];
const burstSp = (k, n, gap) => { for (let i = 0; i < n; i++) setTimeout(() => G.run && spawn(k), i * gap); };
const EVS = [['ていでん', 'あかりが消えた！ライトで探して', () => G.blk = 13], ['おもちゃの大行進', 'ウサギがいっせいに起きた！', () => burstSp('bunny', 5, 250)], ['ぬいぐま行進', 'クマたちが近づいてくる！', () => burstSp('bear', 3, 1200)], ['ゴールドラッシュ', '金のウサギがいっぱい！すぐ撃て', () => burstSp('gold', 4, 500)]];
const BOSSN = ['ミス・ニコニコ', 'ミス・ニコニコ・ふたたび', 'ミスター・ゲラゲラ', 'ミス・ニコニコ・ネオ'];
const onWave = w => {
  const pre = G.stage ? 'STAGE ' + (G.stage + 1) + '  ' : '', ev = G.stage > 0 && w > 1 && w < 5 ? EVS[Math.random() * EVS.length | 0] : null;
  if (w === 5 && G.stage > 0) banner(pre + 'WAVE 5  ' + BOSSN[G.stage % 4], 'もっと大きく、もっとニコニコ…');
  else banner(pre + (ev ? 'WAVE ' + w + '  ' + ev[0] : WAVES[w - 1][0]), ev ? ev[1] : (w === 1 && G.stage ? 'ばめんがかわった…' + THEMES[G.stage].name : WAVES[w - 1][1]));
  sfx(392, .5, 'triangle', .08); if (w > 1) G.left += 30;
  if (ev) ev[2](); else { if (w === 2) G.blk = 13; if (w === 3) burstSp('bunny', 5, 250); }
  if (w === 5) setTimeout(() => G.run && spawn('boss'), 1200);
};
const stageClear = () => {
  G.hold = true; const bonus = 500 * (G.stage + 1); G.score += bonus;
  $('#sct').textContent = 'ステージ' + (G.stage + 1) + 'クリア！';
  $('#scp').textContent = 'ボーナス +' + bonus + '点。つぎのステージに進むと、ハート1個かいふく・のこり時間+60秒・パワーアップ1回。そのかわり、おもちゃがつよくなります。' + (G.stage === 1 ? 'つぎは最終ステージ（スクロール）！' : '');
  const box = $('#scb'); box.innerHTML = '';
  [['つぎのステージへ', () => { G.stage++; G.k0 = G.kills; G.kpw = Math.min(12, 6 + 2 * G.stage); G.hp = Math.min(G.mh, G.hp + 1); G.left += 60; G.ph2 = 0; G.bsT = 4; G.wave = 1; G.hold = false; mon.slice().forEach(rm); $('#sc2').classList.add('off'); applyTheme(Math.min(G.stage, 2)); if (G.stage >= 2) startSpace(); else offerUp(1); }],
   ['ここでおわる', () => { G.hold = false; $('#sc2').classList.add('off'); end('clear'); }]].forEach(([t, f]) => { const b = document.createElement('button'); b.className = 'go'; b.textContent = t; b.onclick = f; box.append(b); });
  $('#sc2').classList.remove('off'); sfx(784, .5, 'triangle');
};
const UPS = [
  { n:'れんしゃ', d:'弾の回復スピード1.5倍', f:() => G.rg *= 1.5 },
  { n:'ライトPlus', d:'ライトの停止+1秒・再使用−2秒', f:() => { G.fz += 1; CD.z = Math.max(3, CD.z - 2); } },
  { n:'ハートUP', d:'ハートが1個ふえる（最大数も+1）', f:() => { G.mh++; G.hp++; } },
  { n:'おおきな判定', d:'タップの当たりが25%広がる', f:() => G.hk *= 1.25 },
  { n:'ゲージ急速', d:'スペシャルがたまりやすい', f:() => G.spk = 14 },
  { n:'タイム+20', d:'のこり時間が20秒ふえる', f:() => G.left += 20 }
];
const offerUp = w => {
  G.hold = true; const box = $('#cards'); box.innerHTML = '';
  UPS.slice().sort(() => Math.random() - .5).slice(0, 3).forEach(u => {
    const b = document.createElement('button'); b.className = 'card'; b.innerHTML = `<b>${u.n}</b><small>${u.d}</small>`;
    b.onclick = () => { u.f(); G.hold = false; $('#up').classList.add('off'); sfx(880, .2, 'triangle'); onWave(w); }; box.append(b);
  });
  $('#up').classList.remove('off'); sfx(660, .3, 'triangle');
};
// ===== 場面転換（テーマ）=====
const THEMES = [
  { name:'夜の教室', wall:0x5f86b8, bg:0x0d0a24, fog:0x1a1240, hemi:0xffd8a8, pts:[0xff5ad2, 0x4ad0ff, 0xffc060], win:0xffffff },
  { name:'あかね色の教室', wall:0xd49a7c, bg:0x2a1420, fog:0x3a1c28, hemi:0xffc890, pts:[0xff9a4a, 0xff5a9a, 0xffd060], win:0xff9a6a },
  { name:'おもちゃ宇宙', wall:0, bg:'sky', fog:0x9a6ab0, fn:30, ff:130, hemi:0xffffff, pts:[0xff9ad0, 0x9ad0ff, 0xfff0b0], win:0xffffff }
];
const SPSKY = tex(4, 256, x => { const g = x.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, '#1a1050'); g.addColorStop(.55, '#a04aa8'); g.addColorStop(.8, '#ff9ac0'); g.addColorStop(1, '#ffe0b0'); x.fillStyle = g; x.fillRect(0, 0, 4, 256); });
const applyTheme = i => {
  const t = THEMES[i]; ROOMW.material.color.set(t.wall); S.background = t.bg === 'sky' ? SPSKY : new THREE.Color(t.bg);
  S.fog.color.set(t.fog); S.fog.near = t.fn || 9; S.fog.far = t.ff || 24; LT[0][0].color.set(t.hemi);
  [2, 3, 4].forEach((j, n) => LT[j][0].color.set(t.pts[n])); WINS.forEach(w => w.material.color.set(t.win));
};
// ===== 最終ステージ：奥へスクロール（スペースハリアー風）=====
const SPG = new THREE.Group(); SPG.visible = false; S.add(SPG);
const GT = rep2(tex(64, 64, x => { x.fillStyle = '#3ad0b0'; x.fillRect(0, 0, 64, 64); x.fillStyle = '#2aa88f'; x.fillRect(0, 0, 32, 32); x.fillRect(32, 32, 32, 32); x.fillStyle = '#ff9ad0'; x.fillRect(0, 31, 64, 2); })); GT.repeat.set(10, 40);
const gnd = new THREE.Mesh(new THREE.PlaneGeometry(60, 400), new THREE.MeshBasicMaterial({ map:GT })); gnd.rotation.x = -Math.PI / 2; gnd.position.set(0, 0, -150); SPG.add(gnd);
const CL = Array.from({ length:12 }, () => { const c = spr(0xffffff, 1); c.scale.set(10 + Math.random() * 8, 4 + Math.random() * 3, 1); c.position.set((Math.random() - .5) * 60, 6 + Math.random() * 8, -Math.random() * 130); c.material.opacity = .4; SPG.add(c); return c; });
const PL = new THREE.Group(); BUILD.chick(PL); PL.scale.setScalar(2.3); { const gl = spr(0x6fe0ff, 1.1); gl.position.set(0, -.25, .2); PL.add(gl); } PL.rotation.y = Math.PI; SPG.add(PL); // 自機：ひよっこ号
const SE = [], SB = [];
const sEnemy = (kind, x, y, z) => { const k = K[kind], g = new THREE.Group(); BUILD[kind](g); g.scale.setScalar(2.2); g.position.set(x, y, z); SPG.add(g);
  const e = { g, k, hp:k.hp, x0:x, y0:y, a:1 + Math.random() * 2.5, f:.8 + Math.random() * 1.2, ph:Math.random() * 6, r:Math.max(k.w, k.h) * 1.1, v:6 + Math.random() * 8 }; SE.push(e); return e; };
const sObst = () => { const h = 1.6 + Math.random() * 2.6, g = new THREE.Group(); box(1.3, h, 1.3, M(BC[Math.random() * 5 | 0]), 0, h / 2, 0, g); box(1.5, .25, 1.5, M(0xffffff), 0, h + .12, 0, g); g.position.set((Math.random() - .5) * 11, 0, -130); SPG.add(g); SE.push({ g, h, obst:1, r:.95 }); };
const sKill = e => { SPG.remove(e.g); disp(e.g); const i = SE.indexOf(e); i >= 0 && SE.splice(i, 1); e.bar && e.bar.remove(); if (e.boss) { G.sboss = null; G.shk = .9 * RMO; end('clear'); } };
const sHit = (e, d = 1) => {
  e.hp -= d; burst(e.g.position, 0x9fe8ff, 3);
  if (e.bar) { e.bar.querySelector('b').textContent = Math.max(e.hp, 0) + '/' + e.mx; e.bar.querySelector('u').style.width = Math.max(e.hp, 0) / e.mx * 100 + '%'; }
  if (e.hp > 0) return;
  G.combo++; const gain = Math.round(e.k.pts * (1 + Math.min(G.combo / 5 | 0, 4) * .5) * (G.fever > 0 ? 2 : 1) * DIFF[DIFFI].sc); G.score += gain; G.kills++; G.sp = Math.min(100, G.sp + G.spk);
  const [x, y] = pj(e.g.position); pt('+' + gain, x, y); burst(e.g.position, 0xffffff, 10); burst(e.g.position, e.k.col, 6); sfx(660 + Math.min(G.combo, 12) * 35, .12); sKill(e);
};
const spSpecial = () => { SE.filter(e => !e.obst).forEach(e => sHit(e, 2)); SE.filter(e => e.obst).forEach(sKill); };
const clearSp = () => { SE.slice().forEach(e => { SPG.remove(e.g); disp(e.g); e.bar && e.bar.remove(); }); SE.length = 0; SB.forEach(b => { SPG.remove(b); disp(b); }); SB.length = 0; G.sboss = null; };
const setSpace = on => {
  G.space = on; ROOM.forEach(o => o.visible = !on); SPG.visible = on; gun.visible = !on; C.far = on ? 160 : 50; C.updateProjectionMatrix();
  if (!on) { C.position.set(0, 1.45, 6.3); C.rotation.set(0, 0, 0); clearSp(); }
};
const startSpace = () => {
  mon.slice().forEach(rm); setSpace(true); applyTheme(2); Object.assign(G, { stt:0, ss:1, sf:0, sbt:3, sboss:null, bs:0, ph2:0 });
  PL.position.set(0, 1.5, 0); banner('STAGE 3  FINAL', 'ひよっこ号で空へ！ボスまでつき進め'); sfx(330, .6, 'triangle', .08);
};
const sOrb = q => { const s = spr(0xff4fd8, 1.3), tz = Math.max(.5, -q.z / 55); s.position.copy(q); SPG.add(s);
  const o = { g:s, k:{ pts:10, col:0xff4fd8 }, hp:1, orb:1, r:.55, vx:(PL.position.x - q.x) / tz, vy:(PL.position.y - q.y) / tz, vz:55 }; SE.push(o); return o; };
const spStep = dt => {
  const SPD = 24 + 3 * Math.min(G.stt / 20, 3), sl = G.freeze > 0 ? .35 : 1; G.stt += dt;
  GT.offset.y += SPD * sl * dt / 10; CL.forEach(c => { c.position.z += SPD * .5 * sl * dt; if (c.position.z > 10) c.position.set((Math.random() - .5) * 60, 6 + Math.random() * 8, -130); });
  const tx = (ptr.x / innerWidth * 2 - 1) * 4.6, ty = .9 + (1 - ptr.y / innerHeight) * 3.4, k = Math.min(1, dt * 8);
  PL.position.x += (tx - PL.position.x) * k; PL.position.y += (ty - PL.position.y) * k; PL.rotation.z = (PL.position.x - tx) * .08;
  C.position.set(PL.position.x * .6 + (Math.random() - .5) * G.shk * .3, PL.position.y * .45 + 1.9 + (Math.random() - .5) * G.shk * .3, 7); G.shk = Math.max(0, G.shk - dt * 2); C.lookAt(PL.position.x * .3, PL.position.y * .4 + 1, -20);
  if ((G.sf -= dt) <= 0) { G.sf = .13; const b = spr(0x6fe0ff, .5); b.position.set(PL.position.x, PL.position.y + .3, -1); SPG.add(b); SB.push(b); }
  for (const b of SB.slice()) { b.position.z -= 95 * dt; if (b.position.z < -120) { SPG.remove(b); disp(b); SB.splice(SB.indexOf(b), 1); } }
  if (G.stt >= 50 && !G.bs) { // ボス登場
    G.bs = 1; const e = sEnemy('boss', 0, 2.8, -75); e.g.scale.setScalar(1.6); e.boss = 1; e.r = 3.4; e.hp = e.mx = 45; G.sboss = e;
    e.bar = document.createElement('div'); e.bar.className = 'hpb'; e.bar.innerHTML = 'HP <b>45/45</b><i><u style="width:100%"></u></i>'; $('#fx').append(e.bar); banner('FINAL BOSS', 'ミス・ニコニコ・ギガ！');
  }
  if (!G.sboss && G.stt < 50 && (G.ss -= dt) <= 0) {
    G.ss = Math.max(.5, 1 - G.stt / 80) * DIFF[DIFFI].gap;
    if (Math.random() < .35) sObst(); else { const pool = G.stt < 15 ? ['bunny', 'doll'] : G.stt < 32 ? ['bunny', 'doll', 'ball', 'jack'] : ['bunny', 'doll', 'ball', 'jack', 'bear', 'lanky']; sEnemy(pool[Math.random() * pool.length | 0], (Math.random() - .5) * 9, 1 + Math.random() * 3, -120); }
  }
  const bs = G.sboss; if (bs && bs.hp <= bs.mx / 2 && !G.ph2) { G.ph2 = 1; banner('ミス・ニコニコ・ギガがおこった！', '手下がふえるよ！'); sfx(110, .6, 'sawtooth', .1); }
  if (bs && bs.g.position.z > -32 && (G.sbt -= dt) <= 0) { G.sbt = G.ph2 ? 1.6 : 2.6; { const n = G.ph2 ? 3 : 1; for (let i = 0; i < n; i++) sOrb(bs.g.position).vx += (i - (n - 1) / 2) * 5; } const m = sEnemy(G.ph2 && Math.random() < .5 ? 'ball' : 'bunny', bs.g.position.x, bs.g.position.y, bs.g.position.z + 3); m.x0 = bs.g.position.x; }
  for (const e of SE.slice()) {
    const q = e.g.position;
    if (e.obst) q.z += SPD * sl * dt;
    else if (e.boss) { q.z = Math.min(-30, q.z + 14 * sl * dt); q.x = Math.sin(G.stt * .8) * 3.8; q.y = 2.8 + Math.sin(G.stt * 1.3) * .8; if (e.bar) { const [bx, by, bv] = pj(q, 2.2); e.bar.style.cssText = `left:${bx}px;top:${by}px;display:${bv ? 'block' : 'none'}`; } }
    else if (e.orb) { q.x += e.vx * sl * dt; q.y += e.vy * sl * dt; q.z += e.vz * sl * dt; }
    else { q.z += (SPD * .8 + e.v) * sl * dt; q.x = e.x0 + Math.sin(G.stt * e.f + e.ph) * e.a; q.y = e.y0 + Math.cos(G.stt * e.f * 1.3 + e.ph) * .6; if (!e.fired && q.z > -75 && q.z < -40 && e.k.hp > 1 && Math.random() < dt * 1.2) { e.fired = 1; sOrb(q); } }
    if (q.z > -1 && q.z < 1.2) {
      const dx = Math.abs(q.x - PL.position.x), dy = q.y - PL.position.y;
      if (e.obst ? dx < 1.15 && PL.position.y < e.h + .3 : !e.boss && Math.hypot(dx, dy) < e.r + .5) { hurt(); SPG.remove(e.g); disp(e.g); SE.splice(SE.indexOf(e), 1); continue; }
    }
    if (q.z > 8) { SPG.remove(e.g); disp(e.g); SE.splice(SE.indexOf(e), 1); }
  }
  for (const b of SB.slice()) for (const e of SE) {
    if (!e.obst && Math.abs(b.position.z - e.g.position.z) < 1.6 && Math.hypot(b.position.x - e.g.position.x, b.position.y - e.g.position.y) < e.r) { SPG.remove(b); disp(b); SB.splice(SB.indexOf(b), 1); sHit(e); break; }
  }
};
// ===== ゲーム進行 =====
const RC = new THREE.Raycaster(); let kick = 0; const ptr = { x:innerWidth / 2, y:innerHeight / 2 };
const init = () => (CD.z = 8, Object.assign(G, { run:false, t:0, left:TIME, score:0, kills:0, combo:0, hp:DIFF[DIFFI].mh, ammo:30, sp:0, freeze:0, wave:1, spT:1, cd:{ z:0, x:0 }, fever:0, blk:0, bsT:4, seen:{}, mh:DIFF[DIFFI].mh, rg:1, fz:3, hk:1, spk:8, hold:false, ph2:0, stage:0, k0:0, kpw:6, space:false, stt:0, ss:1, sf:0, sbt:3, sboss:null, bs:0, shk:0 }));
const start = () => { mon.slice().forEach(rm); init(); resetFx(); setSpace(false); applyTheme(0); G.run = true; onWave(1); $('#st').classList.add('off'); $('#en').classList.add('off'); sfx(520, .2, 'triangle'); };
const end = r => {
  G.run = false; resetFx(); if (r === 'clear') G.score += Math.round(G.left) * 5;
  let best = 0; try { best = +localStorage.getItem('ghostBest3d') || 0; if (G.score > best) localStorage.setItem('ghostBest3d', best = G.score); } catch (e) { best = Math.max(best, G.score); }
  $('#et').textContent = { clear:G.space ? 'ぜんぶクリア！おめでとう！' : 'ステージ' + (G.stage + 1) + 'クリア！', time:'じかんぎれ…', over:'おばけにつかまっちゃった…' }[r]; $('#fs').textContent = G.score;
  $('#rk').textContent = '称号：' + [[1500, '肝だめし初心者'], [4000, '見習いゴーストバスター'], [8000, '学校の守り神'], [15000, '伝説の霊能力者'], [1e9, '夜の学校の主']].find(a => G.score < a[0])[1] + '（ステージ' + (G.stage + 1) + '／たおした数 ' + G.kills + '）';
  $('#bs').textContent = 'ベストスコア：' + best; mon.slice().forEach(rm); $('#en').classList.remove('off');
};
const shoot = (px, py) => {
  if (!G.run || G.hold || G.space || G.ammo < 1) return; G.ammo--; kick = .08;
  RC.setFromCamera({ x:px / innerWidth * 2 - 1, y:-(py / innerHeight) * 2 + 1 }, C);
  const h = RC.intersectObjects(tg, false)[0], end = h ? h.point : RC.ray.at(14, new THREE.Vector3());
  const t = spr(0x6fe0ff, .35); t.position.copy(gun.localToWorld(new THREE.Vector3(0, 0, -.35))); S.add(t); fx.push({ s:t, a:t.position.clone(), b:end, l:.1, m:.1 });
  sfx(900, .09, 'square', .05); if (h) hitMon(h.object.userData.m, end);
};
const skill = k => {
  if (!G.run || G.hold) return;
  if (k === 'z' && G.cd.z <= 0) { G.freeze = G.fz; G.cd.z = CD.z; flash('#cfe8ff'); sfx(1200, .2, 'triangle'); }
  if (k === 'x' && G.cd.x <= 0) { G.ammo = 30; G.hp = Math.min(G.mh, G.hp + 1); G.cd.x = CD.x; flash('#ffe08a'); sfx(988, .5, 'sine', .1); setTimeout(() => sfx(740, .6, 'sine', .1), 250); }
  if (k === 'c' && G.sp >= 100) { G.sp = 0; flash('#b060ff'); sfx(200, .5, 'sawtooth', .1); if (G.space) spSpecial(); mon.filter(m => (m.st === 'up' || m.st === 'in' || m.st === 'hop' || m.st === 'walk') && !m.k.decoy).forEach(m => hitMon(m, m.g.position, 2)); }
};
R.domElement.addEventListener('pointerdown', e => { ptr.x = e.clientX; ptr.y = e.clientY; shoot(e.clientX, e.clientY); });
addEventListener('pointermove', e => { ptr.x = e.clientX; ptr.y = e.clientY; });
addEventListener('keydown', e => skill(e.key.toLowerCase())); addEventListener('contextmenu', e => e.preventDefault());
document.querySelectorAll('.sk').forEach(b => b.addEventListener('pointerdown', e => { e.stopPropagation(); skill(b.dataset.k); }));
document.querySelectorAll('.go').forEach(b => b.onclick = start);

const SK = { z:$('[data-k=z]'), x:$('[data-k=x]'), c:$('[data-k=c]') };
const step = dt => {
  if (!G.space) {
  C.rotation.y += (-(ptr.x / innerWidth * 2 - 1) * .22 * SWAY - C.rotation.y) * Math.min(1, dt * 5);
  C.rotation.x += ((.5 - ptr.y / innerHeight) * .16 * SWAY - C.rotation.x) * Math.min(1, dt * 5);
  C.position.set((Math.random() - .5) * G.shk * .25, 1.45 + (Math.random() - .5) * G.shk * .25, 6.3); G.shk = Math.max(0, G.shk - dt * 2);
  }
  kick = Math.max(0, kick - dt * .5); gun.position.set(.38, -.33, -.72 + kick * 2);
  $('#xh').style.transform = `translate(${ptr.x}px,${ptr.y}px)`; $('#xh').style.opacity = G.space ? 0 : 1;
  if (G.space && G.run) spStep(dt);
  if (G.run) {
    G.t += dt; G.left -= dt; G.fever = Math.max(0, G.fever - dt); G.freeze = Math.max(0, G.freeze - dt); G.cd.z = Math.max(0, G.cd.z - dt); G.cd.x = Math.max(0, G.cd.x - dt); G.ammo = Math.min(30, G.ammo + dt * 4 * G.rg);
    const w = Math.min(5, 1 + ((G.kills - G.k0) / G.kpw | 0)); if (!G.space && w !== G.wave) { G.wave = w; offerUp(w); }
    if (G.blk > 0) { G.blk -= dt; dim(G.blk > 11.8 ? .12 + .88 * (G.blk - 11.8) / 1.2 : G.blk > 0 ? .12 : 1); FL.intensity = G.blk > 11.8 || G.blk <= 0 ? 0 : 2.6; }
    const bm = G.wave === 5 && mon.find(m => m.k.boss && m.st === 'up');
    if (bm && !G.ph2 && bm.hp <= bm.mx / 2) { G.ph2 = 1; banner('ミス・ニコニコがおこった！', '手下がふえるよ！ぽんぽんまるにも注意'); sfx(110, .6, 'sawtooth', .1); flash('#ff4fd8'); }
    if (bm && (G.bsT -= dt) <= 0) { G.bsT = G.ph2 ? 2.8 : 4.5; spawn('bunny'); spawn('doll'); if (G.ph2) spawn('ball'); sfx(160, .4, 'sawtooth', .08); }
    if (!G.space && (G.spT -= dt) <= 0) { if (mon.filter(m => m.st !== 'die').length < WV.max[G.wave - 1] + (G.stage > 1 ? 1 : 0)) spawn(); G.spT = WV.gap[G.wave - 1] * Math.pow(.92, G.stage) * DIFF[DIFFI].gap * (.7 + Math.random() * .6); }
    if (G.left <= 0) end('time');
  }
  for (const m of mon.slice()) {
    const g = m.g, k = m.k; g.rotation.y = Math.atan2(C.position.x - g.position.x, C.position.z - g.position.z);
    m.a.material.color.set(G.freeze > 0 ? 0x66ccff : m.k.bonus ? 0xffd23a : m.k.decoy ? 0xffffaa : 0xff4fd8);
    if (m.st === 'in') { m.age += dt; const u = Math.min(m.age / .3, 1); g.scale.setScalar(1 + 2.70158 * Math.pow(u - 1, 3) + 1.70158 * Math.pow(u - 1, 2)); if (u >= 1) { m.st = k.walk ? 'walk' : 'up'; m.wt = 0; m.from = g.position.clone(); } }
    else if (m.st === 'up') {
      if (G.freeze <= 0) m.ttl -= dt; g.position.y = m.y + Math.sin(G.t * 4 + m.sp) * (k.at.includes('a') ? .08 : .04); g.rotation.z = Math.sin(G.t * 9 + m.sp) * .05; g.scale.set(1 + Math.sin(G.t * 5 + m.sp) * .04, 1 - Math.sin(G.t * 5 + m.sp) * .04, 1);
      for (const q of g.userData.sw || []) q.o.rotation.z = q.b + Math.sin(G.t * 6 + q.p + m.sp) * q.a;
      if (k.hop && G.wave >= 3 && G.freeze <= 0 && (m.hopT = (m.hopT == null ? 1.1 : m.hopT) - dt) <= 0) {
        const fr = SP.map((_, i) => i).filter(i => !mon.some(o => o.sp === i) && k.at.includes(SP[i][3]));
        if (fr.length) { const ni = fr[Math.random() * fr.length | 0]; m.sp = ni; m.from = g.position.clone(); m.to = new THREE.Vector3(SP[ni][0], SP[ni][1] + k.h / 2, SP[ni][2]); m.y = m.to.y; m.ht = 0; m.st = 'hop'; } else m.hopT = .5;
      }
      if (m.st === 'up' && m.ttl <= 0) { if (k.decoy || k.bonus) { m.st = 'die'; const i = tg.indexOf(m.hb); i >= 0 && tg.splice(i, 1); } else { m.st = 'lunge'; m.lt = 0; m.from = g.position.clone(); } }
    } else if (m.st === 'walk') {
      if (G.freeze <= 0) m.wt += dt; const u = Math.min(m.wt / k.walk, 1);
      g.position.set(m.from.x * (1 - u), m.y + Math.abs(Math.sin(m.wt * 7)) * .08, m.from.z + (5.2 - m.from.z) * u); g.rotation.z = Math.sin(m.wt * 7) * .06;
      for (const q of g.userData.sw || []) q.o.rotation.z = q.b + Math.sin(m.wt * 9 + q.p) * q.a * 1.6;
      if (u >= 1) { hurt(); rm(m); continue; }
    } else if (m.st === 'hop') {
      m.ht += dt; const u = Math.min(m.ht / .3, 1); g.position.lerpVectors(m.from, m.to, u); g.position.y += Math.sin(u * Math.PI) * .4;
      if (u >= 1) { m.st = 'up'; m.hopT = 1.2; }
    } else if (m.st === 'lunge') {
      m.lt += dt; const u = Math.min(m.lt / .4, 1); g.position.lerpVectors(m.from, T, u * u); g.scale.setScalar(1 + u * .8);
      if (u >= 1) { if (k.boss) G.hp = 1; hurt(); rm(m); continue; }
    } else if (m.st === 'die') { g.scale.multiplyScalar(1 - dt * 9); g.rotation.z += dt * 10; if (g.scale.x < .05) { rm(m); continue; } }
    if (m.bar) { const [x, y, v] = pj(g.position, k.h * .7); m.bar.style.cssText = `left:${x}px;top:${y}px;display:${v ? 'block' : 'none'}`; }
  }
  for (const f of fx.slice()) {
    f.l -= dt; f.b ? f.s.position.lerpVectors(f.a, f.b, 1 - Math.max(f.l, 0) / f.m) : f.s.position.addScaledVector(f.v, dt);
    f.s.material.opacity = Math.max(f.l, 0) / f.m; if (f.l <= 0) { S.remove(f.s); disp(f.s); fx.splice(fx.indexOf(f), 1); }
  }
  const l = Math.max(0, Math.ceil(G.left));
  $('#tm').textContent = `${String(l / 60 | 0).padStart(2, '0')}:${String(l % 60).padStart(2, '0')}`; $('#rm').textContent = G.space ? (G.sboss ? 'BOSS' : Math.max(0, 50 - G.stt | 0)) : G.kills - G.k0 >= 4 * G.kpw ? 'BOSS' : 4 * G.kpw - (G.kills - G.k0); $('#cb').textContent = G.combo + '（×' + (1 + Math.min(G.combo / 5 | 0, 4) * .5) * (G.fever > 0 ? 2 : 1) + '）'; $('#wv').textContent = G.space ? 'FINAL' : G.wave; $('#w5').style.display = G.space ? 'none' : ''; $('#stg').textContent = G.stage + 1;
  $('#hp').textContent = '♥'.repeat(Math.max(0, G.hp)) + '♡'.repeat(Math.max(0, G.mh - G.hp)); $('#sp').style.width = G.sp + '%'; $('#ammo').textContent = Math.floor(G.ammo);
  SK.z.querySelector('s').style.height = G.cd.z / CD.z * 100 + '%'; SK.x.querySelector('s').style.height = G.cd.x / CD.x * 100 + '%';
  SK.c.querySelector('s').style.height = (100 - G.sp) + '%'; SK.c.classList.toggle('rdy', G.sp >= 100);
};
const PORT = matchMedia('(orientation:portrait) and (max-width:700px)');
const dfc = $('#dfc'), paintDf = () => [...dfc.children].forEach((b, i) => b.classList.toggle('on', i === DIFFI));
DIFF.forEach((d, i) => { const b = document.createElement('button'); b.className = 'df'; b.textContent = d.n; b.onclick = () => { DIFFI = i; try { localStorage.setItem('obakeDiff', i); } catch (e) {} paintDf(); }; dfc.append(b); }); paintDf();
init(); let last = performance.now();
let fpsE = 1 / 60, prCur = Math.min(devicePixelRatio, COARSE ? 1.75 : 2), lowT = 0;
const loop = now => { const dt = Math.min((now - last) / 1000, .1); last = now;
  fpsE += (dt - fpsE) * .05; if (fpsE > 1 / 38) { lowT += dt; if (lowT > 2 && prCur > .7) { prCur = Math.max(.7, prCur - .2); R.setPixelRatio(prCur); resize(); lowT = 0; } } else lowT = Math.max(0, lowT - dt); step(PORT.matches || G.hold ? 0 : dt); R.render(S, C); requestAnimationFrame(loop); };
requestAnimationFrame(loop);
