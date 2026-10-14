import { expect, test, type Page } from '@playwright/test';
import { CELL, LEVEL_MAP } from '../src/world/levelData';

// 実際のキー入力(矢印キーで向きを変え、W で前進、E で操作)だけでゲームを進めるボット。
// 経路はマップから幅優先探索で求め、毎ティック診断値の位置と向きを読んで舵を取る。

type Snapshot = {
  frame: number;
  state: string;
  x: number;
  z: number;
  yaw: number;
  carried: number;
  inserted: number;
  caughtCount: number;
  monsterState: string;
  monsterX: number;
  monsterZ: number;
  complete: boolean;
};

type Cell = { col: number; row: number };

const WALKABLE = '.PFLM';
// ヘッドレスのソフトウェア描画は遅い(数fps)。ゲーム内時間は 1フレーム最大0.05秒なので、
// 実時間の待ち時間は余裕を持たせ、行き詰まりはフレーム数で判定する。
const SLOW = 6;

test.use({ viewport: { width: 640, height: 360 } });

function bfsPath(from: Cell, to: Cell): Cell[] {
  const key = (c: Cell) => `${c.col},${c.row}`;
  const came = new Map<string, string | null>([[key(from), null]]);
  const queue: Cell[] = [from];
  while (queue.length) {
    const cell = queue.shift()!;
    if (cell.col === to.col && cell.row === to.row) break;
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const next = { col: cell.col + dc, row: cell.row + dr };
      const ch = LEVEL_MAP[next.row]?.[next.col];
      if (!ch || !WALKABLE.includes(ch) || came.has(key(next))) continue;
      came.set(key(next), key(cell));
      queue.push(next);
    }
  }
  const path: Cell[] = [];
  let cursor: string | null | undefined = key(to);
  while (cursor) {
    const [col, row] = cursor.split(',').map(Number);
    path.unshift({ col, row });
    cursor = came.get(cursor);
  }
  // 同じ方向に続くマスは間引く(曲がり角だけ残す)
  return path.filter((cell, i) => {
    if (i === 0 || i === path.length - 1) return true;
    const prev = path[i - 1];
    const next = path[i + 1];
    return !(cell.col - prev.col === next.col - cell.col && cell.row - prev.row === next.row - cell.row);
  });
}

const center = (cell: Cell) => ({ x: (cell.col + 0.5) * CELL, z: (cell.row + 0.5) * CELL });

async function sample(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const d = window.__THREE_GAME_DIAGNOSTICS__!;
    return {
      frame: d.frame,
      state: d.state,
      x: d.player.position.x,
      z: d.player.position.z,
      yaw: d.player.yaw,
      carried: d.fuses.carried,
      inserted: d.fuses.inserted,
      caughtCount: d.caughtCount,
      monsterState: d.monster.state,
      monsterX: d.monster.position.x,
      monsterZ: d.monster.position.z,
      complete: d.complete,
    };
  });
}

class Bot {
  distance = 0;
  softlockWindows = 0;
  caughtOnRoute = 0;
  private held = new Set<string>();
  private last: Snapshot | null = null;

  constructor(private readonly page: Page) {}

  private async hold(keys: string[]): Promise<void> {
    for (const key of this.held) if (!keys.includes(key)) await this.page.keyboard.up(key);
    for (const key of keys) if (!this.held.has(key)) await this.page.keyboard.down(key);
    this.held = new Set(keys);
  }

  async release(): Promise<void> {
    await this.hold([]);
  }

  async tick(): Promise<Snapshot> {
    const snap = await sample(this.page);
    if (this.last) {
      const moved = Math.hypot(snap.x - this.last.x, snap.z - this.last.z);
      this.distance += moved;
    }
    this.last = snap;
    return snap;
  }

  /** (x, z) に着くまで歩く。stop() が true を返したら途中で止める。 */
  async driveTo(
    target: { x: number; z: number },
    options: { tolerance?: number; timeoutMs?: number; sprint?: boolean; stop?: (s: Snapshot) => boolean } = {},
  ): Promise<Snapshot> {
    const tolerance = options.tolerance ?? 0.6;
    const deadline = Date.now() + (options.timeoutMs ?? 30_000) * SLOW;
    let stuckFrame = -1;
    let lastProgress = Infinity;
    for (;;) {
      const snap = await this.tick();
      if (options.stop?.(snap)) return snap;
      const dx = target.x - snap.x;
      const dz = target.z - snap.z;
      const distance = Math.hypot(dx, dz);
      if (distance < tolerance) {
        await this.release();
        return snap;
      }
      if (Date.now() > deadline) {
        await this.release();
        throw new Error(`bot could not reach (${target.x.toFixed(1)}, ${target.z.toFixed(1)}) from (${snap.x.toFixed(1)}, ${snap.z.toFixed(1)})`);
      }
      if (stuckFrame < 0) stuckFrame = snap.frame;
      if (distance < lastProgress - 0.3) {
        lastProgress = distance;
        stuckFrame = snap.frame;
      } else if (snap.frame - stuckFrame > 90) {
        // 約4.5秒分(ゲーム内)近づけていない
        this.softlockWindows += 1;
        stuckFrame = snap.frame;
      }
      // 前方 = (-sin yaw, -cos yaw)
      const desired = Math.atan2(-dx, -dz);
      let diff = desired - snap.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const keys: string[] = [];
      if (diff > 0.12) keys.push('ArrowLeft');
      else if (diff < -0.12) keys.push('ArrowRight');
      if (Math.abs(diff) < 0.7) keys.push('KeyW');
      if (options.sprint && Math.abs(diff) < 0.3) keys.push('ShiftLeft');
      await this.hold(keys);
      await this.page.waitForTimeout(40);
    }
  }

  async followPath(from: Cell, to: Cell, options: { sprint?: boolean; stop?: (s: Snapshot) => boolean } = {}): Promise<Snapshot> {
    let snap = await this.tick();
    for (const cell of bfsPath(from, to).slice(1)) {
      snap = await this.driveTo(center(cell), { tolerance: 0.7, ...options });
      if (options.stop?.(snap)) break;
    }
    return snap;
  }

  /** 目的のマスまで行く。途中で捕まったら再開を待ち、今いる場所から経路を引き直す。 */
  async goTo(target: Cell, attempts = 6): Promise<Snapshot> {
    for (let i = 0; i < attempts; i += 1) {
      await expect.poll(async () => (await sample(this.page)).state, { timeout: 30_000 * SLOW }).toBe('playing');
      const now = await this.tick();
      const from = { col: Math.floor(now.x / CELL), row: Math.floor(now.z / CELL) };
      const snap = await this.followPath(from, target, { stop: (s) => s.state !== 'playing' });
      await this.release();
      if (snap.state === 'playing') {
        const goal = center(target);
        if (Math.hypot(snap.x - goal.x, snap.z - goal.z) < 1.2) return snap;
      } else {
        this.caughtOnRoute += 1;
      }
    }
    throw new Error(`bot could not reach cell ${target.col},${target.row}`);
  }

  async press(key: string): Promise<void> {
    await this.page.keyboard.press(key);
    await this.page.waitForTimeout(150);
  }
}

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

test('bot playtest: ヒューズを拾ってはめ、捕まって再開できる', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'キーボード操作のボットはデスクトップのみ');
  test.setTimeout(900_000);
  const errors = collectErrors(page);

  await page.goto('/');
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.seed(12345));
  // タイトル画面のボタンを実際にクリックして開始
  await page.getByRole('button', { name: '校舎に入る' }).click();
  await expect.poll(async () => (await sample(page)).state).toBe('playing');

  const bot = new Bot(page);
  const started = Date.now();

  // 1. 入口ロビーのヒューズへ
  await bot.goTo({ col: 2, row: 8 });
  await expect(page.locator('#prompt')).toBeVisible();
  await bot.press('KeyE');
  const afterPickup = await bot.tick();
  expect(afterPickup.carried, 'E でヒューズを拾えること').toBe(1);
  await expect(page.locator('#carry-value')).toHaveText('1');
  const timeToFirstFuse = (Date.now() - started) / 1000;

  // 2. 多目的ホールの分電盤へ(分電盤の東側)
  await bot.goTo({ col: 10, row: 12 });
  const caughtBefore = (await bot.tick()).caughtCount;
  await bot.driveTo({ x: 9 * CELL + 1.5 + 1.6, z: 12 * CELL + 1.5 }, { tolerance: 0.5 });
  await expect(page.locator('#prompt-text')).toContainText('ヒューズをはめる');
  await bot.press('KeyE');
  const afterInsert = await bot.tick();
  expect(afterInsert.inserted, 'E で分電盤にはめられること').toBe(1);
  await expect(page.locator('.fuse-slot.filled')).toHaveCount(1);
  const timeToInsert = (Date.now() - started) / 1000;

  // 3. わざとガブガブーノに近づいて捕まる → チェックポイントから再開
  let caughtSnap: Snapshot | null = null;
  const recklessDeadline = Date.now() + 90_000 * SLOW;
  while (Date.now() < recklessDeadline) {
    const snap = await bot.tick();
    if (snap.state === 'caught') {
      caughtSnap = snap;
      break;
    }
    await bot.driveTo(
      { x: snap.monsterX, z: snap.monsterZ },
      { tolerance: 0.4, timeoutMs: 3000, stop: (s) => s.state === 'caught' },
    ).catch(() => undefined);
  }
  await bot.release();
  expect(caughtSnap, '敵に近づくと捕まること(失敗状態がある)').not.toBeNull();
  await expect(page.locator('#caught-screen')).toBeVisible();
  const timeToCaught = (Date.now() - started) / 1000;
  await expect.poll(async () => (await sample(page)).state, { timeout: 15_000 * SLOW }).toBe('playing');
  const respawned = await sample(page);
  expect(respawned.caughtCount).toBe(caughtBefore + 1);
  expect(
    Math.hypot(respawned.x - (9 * CELL + 1.5 + 1.6), respawned.z - (12 * CELL + 1.5)),
    '分電盤前のチェックポイントから再開すること',
  ).toBeLessThan(0.8);
  expect(respawned.inserted, '再開後もはめたヒューズは残ること').toBe(1);

  const report = {
    timeToFirstFuse,
    timeToInsert,
    timeToCaught,
    caughtBeforeReckless: caughtBefore,
    caughtOnRoute: bot.caughtOnRoute,
    distanceTravelled: Number(bot.distance.toFixed(1)),
    softlockWindows: bot.softlockWindows,
    errors,
  };
  await testInfo.attach('bot-playtest-report', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  console.log(`bot playtest: ${JSON.stringify(report)}`);
  expect(errors).toEqual([]);
});

test('bot playtest: 電源復旧後、出口まで走ると脱出できる', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'キーボード操作のボットはデスクトップのみ');
  test.setTimeout(300_000);
  const errors = collectErrors(page);
  await page.goto('/');
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10);
  await page.evaluate(async () => {
    await window.__THREE_GAME_TEST_HOOKS__!.seed(7);
    await window.__THREE_GAME_TEST_HOOKS__!.setState('finale');
  });
  // 扉が開ききるのを待ってから走る
  await page.waitForFunction(() => {
    const d = window.__THREE_GAME_DIAGNOSTICS__;
    return !!d && d.frame > 80;
  });
  const bot = new Bot(page);
  await bot.driveTo(
    { x: 25 * CELL - 0.2, z: 18 * CELL + 1.5 },
    { tolerance: 0.3, sprint: true, timeoutMs: 30_000, stop: (s) => s.complete || s.state === 'caught' },
  );
  await bot.release();
  const end = await sample(page);
  expect(end.state, '出口に着くとクリア画面になること').toBe('escaped');
  await expect(page.locator('#win-screen')).toBeVisible();
  await expect(page.getByRole('button', { name: 'もう一度あそぶ' })).toBeVisible();
  // もう一度あそぶ → 最初から
  await page.getByRole('button', { name: 'もう一度あそぶ' }).click();
  await expect.poll(async () => (await sample(page)).state).toBe('playing');
  const restarted = await sample(page);
  expect(restarted.inserted).toBe(0);
  expect(errors).toEqual([]);
});
