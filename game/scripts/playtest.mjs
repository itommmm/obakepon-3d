// 実キー入力だけでゲームを遊び、出来事を記録するプレイテストボット。
// 作戦(policy)は2種類:
//   careful  : 懐中電灯を消して歩く。ドラゴンチーノの近くを避け、追われたら非常灯へ逃げて待つ。
//   reckless : 懐中電灯を点けたまま走り続ける。追われても逃げ方は同じ。
// 使い方:
//   node scripts/playtest.mjs --policy careful [--seed 42] [--max-min 40] [--out artifacts/playtest/careful.json]
// 前提: 開発サーバーが起動していること(既定 http://127.0.0.1:5188)。
// 注意: ボットは診断値(位置・敵の状態)を読んで動く。人の「怖さ」や「面白さ」は測れない。
//       測るのは、仕組みが意図どおり働くか、どこで詰まるか、どれくらい時間がかかるか。
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const gameDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i += 1) {
  if (!argv[i].startsWith('--')) continue;
  const next = argv[i + 1];
  if (next !== undefined && !next.startsWith('--')) {
    args[argv[i].slice(2)] = next;
    i += 1;
  } else {
    args[argv[i].slice(2)] = 'true';
  }
}

const POLICY = args.policy ?? 'careful';
if (!['careful', 'reckless'].includes(POLICY)) throw new Error(`unknown policy: ${POLICY}`);
const URL_BASE = args.url ?? 'http://127.0.0.1:5188';
const SPEED = Math.min(8, Math.max(1, Number(args.speed ?? 1)));
const START = args.start ?? 'title';
if (!['title', 'fuse3'].includes(START)) throw new Error(`unknown start: ${START}`);
const SEED = Number(args.seed ?? 42);
const MAX_MS = Number(args['max-min'] ?? 40) * 60_000;
const OUT = path.resolve(gameDir, args.out ?? `artifacts/playtest/${POLICY}-${SEED}.json`);
const SHOT_DIR = path.dirname(OUT);

// ---------- マップ(src/world/levelData.ts から読む) ----------

const src = fs.readFileSync(path.join(gameDir, 'src/world/levelData.ts'), 'utf8');
const MAP = [...src.matchAll(/^  '([^']+)',$/gm)].map((m) => m[1]);
const CELL = 3;
const WALKABLE = '.PFLM';
const at = (col, row) => (row < 0 || row >= MAP.length || col < 0 || col >= MAP[0].length ? '#' : MAP[row][col]);
const cellsOf = (ch) => MAP.flatMap((line, row) => [...line].flatMap((c, col) => (c === ch ? [{ col, row }] : [])));
const center = (c) => ({ x: (c.col + 0.5) * CELL, z: (c.row + 0.5) * CELL });
const cellOf = (p) => ({ col: Math.floor(p.x / CELL), row: Math.floor(p.z / CELL) });
const sameCell = (a, b) => a.col === b.col && a.row === b.row;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const round = (v, n = 1) => Math.round(v * 10 ** n) / 10 ** n;

const FUSES = cellsOf('F').map((cell, i) => ({ i, cell, point: center(cell) }));
const SAFE_CELLS = cellsOf('L');
const EXIT_CELL = cellsOf('E')[0];
const BREAKER_CELL = cellsOf('B')[0];
const BREAKER_FRONT = { x: center(BREAKER_CELL).x + 1.6, z: center(BREAKER_CELL).z };
const BREAKER_GOAL = cellOf(BREAKER_FRONT);
const EXIT_GOAL = { col: EXIT_CELL.col - 1, row: EXIT_CELL.row };
const EXIT_POINT = { x: EXIT_CELL.col * CELL - 0.4, z: center(EXIT_CELL).z };
const DRAGON = { col: 17, row: 4 }; // 理科準備室の入口(ドラゴンチーノの初期位置)
const DRAGON_POINT = center(DRAGON);

const isSafe = (c) => SAFE_CELLS.some((s) => sameCell(s, c));
// 慎重派は、ドラゴンチーノの周囲(3x3マス)を通らない
const avoidFor = () => (POLICY === 'careful' ? (c) => Math.max(Math.abs(c.col - DRAGON.col), Math.abs(c.row - DRAGON.row)) <= 1 : null);

function bfs(start, isGoal, avoid = null) {
  const key = (c) => `${c.col},${c.row}`;
  const parent = new Map([[key(start), null]]);
  const queue = [start];
  for (let qi = 0; qi < queue.length; qi += 1) {
    const cur = queue[qi];
    if (isGoal(cur)) {
      const path = [];
      for (let node = cur; node; node = parent.get(key(node))) path.push(node);
      return path.reverse().slice(1);
    }
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const n = { col: cur.col + dc, row: cur.row + dr };
      if (parent.has(key(n)) || !WALKABLE.includes(at(n.col, n.row))) continue;
      if (avoid && avoid(n)) continue;
      parent.set(key(n), cur);
      queue.push(n);
    }
  }
  return null;
}

// ---------- 判断 ----------

const stuckLog = [];
const mem = {
  fuseDone: new Set(),
  planKey: null,
  plan: [],
  best: Infinity,
  bestAt: 0,
  stuck: 0,
  idle: 0,
  waitingSince: null,
  waits: 0,
  nudgeUntil: 0,
  nudgeKeys: [],
  lastToggle: 0,
  lastE: 0,
  rng: 987654321,
  interval: 0.3,
  lastElapsed: null,
};
const rand = () => {
  mem.rng = (mem.rng * 1664525 + 1013904223) % 4294967296;
  return mem.rng / 4294967296;
};

// 旋回は 2.4 rad/秒。判断の間隔(ゲーム内の秒数)の間は旋回キーが押されたままになるので、
// 間隔の半分の角度より小さなずれでは回さない(回しすぎて往復するのを防ぐ)。
const TURN_RATE = 2.4;
function steerKeys(s, wp, sprint, interval) {
  const dx = wp.x - s.x;
  const dz = wp.z - s.z;
  let diff = Math.atan2(-dx, -dz) - s.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const deadband = Math.min(0.8, Math.max(0.15, 0.5 * TURN_RATE * interval));
  const keys = [];
  if (diff > deadband) keys.push('ArrowLeft');
  else if (diff < -deadband) keys.push('ArrowRight');
  if (Math.abs(diff) < 0.6) keys.push('KeyW');
  // 走るのは前に進んでいるときだけ(W と一緒)。ずれが小さければ、判断の間に向きが戻っても走り続ける
  if (sprint && Math.abs(diff) < 0.9) keys.push('ShiftLeft');
  return keys;
}

// 経路(ウェイポイントの列)に沿って進む。5秒(ゲーム内)近づけなければ詰まりとして、後ろに下がって仕切り直す。
function navigate(s, light, key, makeWaypoints, opts) {
  if (mem.planKey !== key) {
    const wps = makeWaypoints();
    mem.planKey = key;
    mem.plan = wps ?? [];
    mem.best = Infinity;
    mem.bestAt = s.elapsed;
    if (!wps) return { keys: [], light, label: `${opts.label}:nopath` };
  }
  while (mem.plan.length && dist(mem.plan[0], s) < 0.6) {
    mem.plan.shift();
    mem.best = Infinity;
    mem.bestAt = s.elapsed;
  }
  if (!mem.plan.length) {
    // 目的地に着いた。次の判断で経路を引き直す(動かずに行動だけ行う場面のため)
    mem.planKey = null;
    mem.idle += 1;
    return { keys: [], light, label: `${opts.label}:arrived` };
  }
  const wp = mem.plan[0];
  const d = dist(wp, s);
  if (d < mem.best - 0.15) {
    mem.best = d;
    mem.bestAt = s.elapsed;
  } else if (s.elapsed - mem.bestAt > 5) {
    mem.stuck += 1;
    stuckLog.push({ t: round(s.elapsed), at: [round(s.x), round(s.z)], label: opts.label, target: [round(wp.x), round(wp.z)] });
    mem.planKey = null;
    mem.plan = [];
    mem.nudgeUntil = s.elapsed + 1.2;
    mem.nudgeKeys = ['KeyS', rand() < 0.5 ? 'ArrowLeft' : 'ArrowRight'];
    return { keys: mem.nudgeKeys, light, label: 'stuck-nudge' };
  }
  return { keys: steerKeys(s, wp, opts.sprint, mem.interval), light, label: opts.label };
}

function chooseGoal(s) {
  const avoid = avoidFor();
  if (s.powered) return { id: 'exit', action: 'exit', cell: EXIT_GOAL, point: EXIT_POINT, sprint: true };
  if (s.carried > 0) {
    return { id: 'breaker', action: 'breaker', cell: BREAKER_GOAL, point: BREAKER_FRONT, sprint: POLICY === 'reckless' };
  }
  const candidates = FUSES.filter((f) => !mem.fuseDone.has(f.i))
    .map((f) => ({ ...f, d: dist(f.point, s) }))
    .sort((a, b) => a.d - b.d);
  for (const f of candidates) {
    if (bfs(cellOf(s), (c) => sameCell(c, f.cell), avoid)) {
      return { id: `fuse${f.i}`, action: 'fuse', cell: f.cell, point: f.point, sprint: POLICY === 'reckless' };
    }
  }
  return { id: 'none', action: 'none', sprint: false };
}

function decide(s) {
  const light = POLICY === 'reckless';
  const now = s.elapsed;
  if (mem.lastElapsed !== null) {
    const gap = now - mem.lastElapsed;
    if (gap > 0 && gap < 3) mem.interval = 0.8 * mem.interval + 0.2 * gap;
  }
  mem.lastElapsed = now;
  const monsterNear = ['chase', 'alert', 'search'].includes(s.monsterState) && s.monsterDist < 14;

  // 1. 非常灯の下で、追ってきた敵が離れるのを待つ(最大25秒)
  if (monsterNear && s.safe) {
    if (mem.waitingSince === null) {
      mem.waitingSince = now;
      mem.waits += 1;
    }
    if (now - mem.waitingSince < 25) return { keys: [], light, label: 'wait-safe' };
  } else {
    mem.waitingSince = null;
  }
  if (mem.nudgeUntil > now) return { keys: mem.nudgeKeys, light, label: 'stuck-nudge' };

  if (!monsterNear && mem.planKey === 'flee') mem.planKey = null;

  // 2. 追われている: いちばん近い非常灯へ走る
  if (monsterNear && !s.safe) {
    return navigate(s, light, 'flee', () => {
      const path = bfs(cellOf(s), isSafe);
      return path ? path.map(center) : null;
    }, { sprint: true, label: 'flee' });
  }

  // 3. 目的: ヒューズを拾う → 分電盤にはめる → 出口へ走る
  const goal = chooseGoal(s);
  if (goal.action === 'none') return { keys: [], light, label: 'no-goal' };
  const r = navigate(s, light, goal.id, () => {
    const path = bfs(cellOf(s), (c) => sameCell(c, goal.cell), avoidFor());
    return path ? [...path.map(center), goal.point] : null;
  }, { sprint: goal.sprint, label: goal.id });

  let press = null;
  const wallNow = Date.now();
  if (wallNow - mem.lastE > 900) {
    if (goal.action === 'fuse' && dist(goal.point, s) < 1.6) press = 'KeyE';
    if (goal.action === 'breaker' && s.carried > 0 && dist(BREAKER_FRONT, s) < 2.0) press = 'KeyE';
  }
  return { ...r, press };
}

// ---------- 実行 ----------

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE ?? '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});

const snap = () =>
  page.evaluate(() => {
    const d = window.__THREE_GAME_DIAGNOSTICS__;
    const promptEl = document.querySelector('#prompt');
    return {
      frame: d.frame,
      elapsed: d.elapsed,
      state: d.state,
      x: d.player.position.x,
      z: d.player.position.z,
      yaw: d.player.yaw,
      stamina: d.player.stamina,
      battery: d.player.battery,
      lightOn: d.player.lightOn,
      safe: d.player.safe,
      carried: d.fuses.carried,
      inserted: d.fuses.inserted,
      powered: d.fuses.powered,
      monsterState: d.monster.state,
      monsterX: d.monster.position.x,
      monsterZ: d.monster.position.z,
      monsterDist: d.monster.distance,
      caught: d.caughtCount,
      alarms: d.allies.alarms,
      dragonAwake: d.allies.dragontinoAwake,
      toast: document.querySelector('#toast')?.textContent ?? '',
      prompt: promptEl && !promptEl.hidden ? document.querySelector('#prompt-text')?.textContent ?? '' : '',
    };
  });

// キーは、ページの中で window にキーイベントを直接発行して送る(Playwright の keyboard は描画フレームを待つため遅い)。
// ゲームは window の keydown / keyup の event.code だけを見るので、入力としては同じ。
let held = new Set();
const fireKeys = (events) =>
  page.evaluate((list) => {
    for (const [type, code] of list) {
      window.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true }));
    }
  }, events);
async function setKeys(keys) {
  const want = new Set(keys);
  const events = [];
  for (const k of held) if (!want.has(k)) events.push(['keyup', k]);
  for (const k of want) if (!held.has(k)) events.push(['keydown', k]);
  if (events.length) await fireKeys(events);
  held = want;
}
async function tap(code) {
  await fireKeys([
    ['keydown', code],
    ['keyup', code],
  ]);
}

const events = [];
const trace = [];
const decisionLog = [];
let prev = null;
let lastTrace = -100;
let exhaustions = 0;
let batteryEmptyAt = null;
const pendingShots = [];
const shotSeen = new Set();

function record(s) {
  const t = round(s.elapsed);
  const add = (e) => {
    if (events.length < 4000) events.push({ t, ...e });
  };
  if (prev) {
    if (s.state !== prev.state) add({ type: 'state', to: s.state });
    if (s.caught > prev.caught) {
      add({ type: 'caught', at: [round(s.x), round(s.z)], monster: prev.monsterState, lightOn: prev.lightOn, carried: prev.carried, inserted: prev.inserted });
      if (!shotSeen.has('caught')) pendingShots.push('caught');
      shotSeen.add('caught');
    }
    if (s.alarms > prev.alarms) {
      const source = s.toast.includes('ワニーニ') ? 'wanini' : s.toast.includes('ドラゴン') ? 'dragontino' : 'other';
      add({ type: 'summon', source, monster: prev.monsterState });
      if (!shotSeen.has(`summon-${source}`)) pendingShots.push(`summon-${source}`);
      shotSeen.add(`summon-${source}`);
    }
    if (s.dragonAwake && !prev.dragonAwake) {
      add({ type: 'dragontino-wake', playerDist: round(dist(s, DRAGON_POINT)), lightOn: s.lightOn });
      if (!shotSeen.has('dragon-wake')) pendingShots.push('dragon-wake');
      shotSeen.add('dragon-wake');
    }
    const totalPrev = prev.carried + prev.inserted;
    const totalNow = s.carried + s.inserted;
    if (totalNow > totalPrev) {
      const nearest = FUSES.filter((f) => !mem.fuseDone.has(f.i))
        .map((f) => ({ i: f.i, d: dist(f.point, s) }))
        .sort((a, b) => a.d - b.d)[0];
      if (nearest && nearest.d < 4) mem.fuseDone.add(nearest.i);
      add({ type: 'fuse-picked', total: totalNow });
    }
    if (s.inserted > prev.inserted) add({ type: 'fuse-inserted', inserted: s.inserted });
    if (s.powered && !prev.powered) add({ type: 'power-on' });
    if (s.monsterState !== prev.monsterState) add({ type: 'monster', from: prev.monsterState, to: s.monsterState, dist: round(s.monsterDist) });
    if (s.toast && s.toast !== prev.toast) add({ type: 'toast', text: s.toast });
    if (prev.stamina > 1 && s.stamina <= 1) exhaustions += 1;
    if (prev.battery > 0 && s.battery <= 0 && batteryEmptyAt === null) {
      batteryEmptyAt = t;
      add({ type: 'battery-empty' });
    }
  }
  if (t - lastTrace >= 30) {
    trace.push({ t, state: s.state, battery: round(s.battery, 0), stamina: round(s.stamina, 0), lightOn: s.lightOn, safe: s.safe, x: round(s.x), z: round(s.z), monster: s.monsterState, monsterDist: round(s.monsterDist) });
    lastTrace = t;
  }
  prev = s;
}

const wallStart = Date.now();
let outcome = 'timeout';
let last = null;
let fatal = null;

try {
  await page.goto(`${URL_BASE}/?lowfx&speed=${SPEED}`);
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10, null, { timeout: 120_000 });
  await page.evaluate((seed) => window.__THREE_GAME_TEST_HOOKS__.seed(seed), SEED);
  if (START === 'fuse3') {
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('fuse3'));
  } else {
    await page.getByRole('button', { name: '校舎に入る' }).click();
  }

  while (Date.now() - wallStart < MAX_MS) {
    const s = await snap();
    last = s;
    record(s);
    while (pendingShots.length) {
      const label = pendingShots.shift();
      await page.screenshot({ path: path.join(SHOT_DIR, `${POLICY}-${SEED}-${label}.png`) });
    }
    if (s.state === 'escaped') {
      outcome = 'escaped';
      break;
    }
    if (s.state === 'title') {
      await page.getByRole('button', { name: '校舎に入る' }).click();
    } else if (s.state === 'playing') {
      const action = decide(s);
      if (action.light !== undefined && action.light !== s.lightOn && s.battery > 3 && Date.now() - mem.lastToggle > 1500) {
        await tap('KeyF');
        mem.lastToggle = Date.now();
      }
      if (action.press) {
        await tap(action.press);
        mem.lastE = Date.now();
      }
      await setKeys(action.keys ?? []);
      if (args.debug && decisionLog.length < 400) {
        decisionLog.push({ wall: Date.now() - wallStart, t: round(s.elapsed), label: action.label, x: round(s.x, 2), z: round(s.z, 2), yaw: round(s.yaw, 3), held: [...held].join('+'), wp: mem.plan[0] ? [round(mem.plan[0].x, 1), round(mem.plan[0].z, 1)] : null });
      }
    } else {
      await setKeys([]);
    }
    await page.waitForTimeout(30);
  }
} catch (e) {
  fatal = String(e && e.message ? e.message : e);
} finally {
  try {
    await setKeys([]);
  } catch {
    // ブラウザが既に閉じている場合は無視
  }
}

const caughtEvents = events.filter((e) => e.type === 'caught');
const summons = events.filter((e) => e.type === 'summon');
const bySource = summons.reduce((acc, e) => ({ ...acc, [e.source]: (acc[e.source] ?? 0) + 1 }), {});
const summary = {
  policy: POLICY,
  seed: SEED,
  outcome,
  fatal,
  gameSeconds: last ? round(last.elapsed) : null,
  wallSeconds: round((Date.now() - wallStart) / 1000, 0),
  escapedAtGameSec: outcome === 'escaped' && last ? round(last.elapsed) : null,
  fuses: {
    picked: events.filter((e) => e.type === 'fuse-picked').map((e) => e.t),
    inserted: events.filter((e) => e.type === 'fuse-inserted').map((e) => e.t),
    powerOn: events.find((e) => e.type === 'power-on')?.t ?? null,
  },
  deaths: caughtEvents.length,
  deathList: caughtEvents.map((e) => ({ t: e.t, at: e.at, monster: e.monster, lightOn: e.lightOn, carried: e.carried, inserted: e.inserted })),
  summons: { total: summons.length, bySource },
  dragontinoWakes: events.filter((e) => e.type === 'dragontino-wake').map((e) => ({ t: e.t, playerDist: e.playerDist, lightOn: e.lightOn })),
  batteryEmptyAt,
  exhaustions,
  stuckNudges: mem.stuck,
  stuckLog,
  start: START,
  arrivedIdle: mem.idle,
  safeWaits: mem.waits,
  consoleErrors,
  pageErrors,
  toasts: events.filter((e) => e.type === 'toast').map((e) => ({ t: e.t, text: e.text })),
  trace,
  events,
  decisionLog,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
await browser.close();

console.log(
  JSON.stringify({
    policy: POLICY,
    seed: SEED,
    outcome,
    gameSeconds: summary.gameSeconds,
    wallSeconds: summary.wallSeconds,
    deaths: summary.deaths,
    summons: summary.summons,
    fuses: summary.fuses,
    stuckNudges: summary.stuckNudges,
    consoleErrors: consoleErrors.length,
    pageErrors: pageErrors.length,
    fatal,
    out: path.relative(gameDir, OUT),
  }),
);
