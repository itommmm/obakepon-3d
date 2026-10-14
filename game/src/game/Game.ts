import * as THREE from 'three';
import { InputController } from '../core/InputController';
import { Loop } from '../core/Loop';
import { createRenderer, resizeRenderer } from '../core/Renderer';
import { PostFX } from '../render/PostFX';
import { Fuse } from '../entities/Fuse';
import { Monster } from '../entities/Monster';
import { Dragontino } from '../entities/Dragontino';
import { Penguino } from '../entities/Penguino';
import { Wanini } from '../entities/Wanini';
import { Player } from '../entities/Player';
import { AudioSystem } from '../systems/AudioSystem';
import { DebugTools, type DebugTuning } from '../systems/DebugTools';
import { Hud, type AppState } from '../systems/Hud';
import { createSeededRandom } from '../utils/random';
import { Level } from '../world/Level';
import { CELL, EARLY_PATROL, type Cell } from '../world/levelData';

const CATCH_DISTANCE = 1.5;
const PICKUP_DISTANCE = 1.9;
const BREAKER_DISTANCE = 2.3;
const CAUGHT_DURATION = 3.4;
const FOG_DARK = 0.07;
const FOG_POWERED = 0.035;
const TARGET_FUSES = 3;

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly postfx: PostFX;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(72, 1, 0.05, 90);
  private readonly input: InputController;
  private readonly level: Level;
  private readonly player: Player;
  private readonly monster: Monster;
  private readonly penguino: Penguino;
  private readonly wanini: Wanini;
  private readonly dragontino: Dragontino;
  private alarms = 0;
  private readonly fuses: Fuse[] = [];
  private readonly audio = new AudioSystem();
  private readonly hud: Hud;
  private readonly hemisphere = new THREE.HemisphereLight('#5a6a8a', '#140c0c', 0.5);
  private readonly fog = new THREE.FogExp2('#050405', FOG_DARK);
  private readonly loop = new Loop(
    (delta, elapsed) => this.update(delta, elapsed),
    () => this.render(),
  );

  private readonly tuning: DebugTuning = {
    walkSpeed: 3.3,
    sprintSpeed: 5.6,
    acceleration: 11,
    mouseSensitivity: 0.0022,
    flashlightIntensity: 95,
    exposure: 1.1,
    maxDpr: 2,
  };

  private readonly debugTools: DebugTools;
  // Route ALL gameplay randomness through this.rng (never Math.random) so the
  // seed() test hook keeps screenshot baselines and bot playtests deterministic.
  private rng = createSeededRandom(1);
  private state: AppState = 'title';
  private frame = 0;
  /** ?lowfx: 影とポストエフェクトを省いた軽い描画(ボットのプレイテストや低スペック機向け) */
  private readonly lowFx = new URLSearchParams(window.location.search).has('lowfx');
  /** テスト用: ガブガブーノの行動を止める(呼び出しによる状態変化は受け付ける) */
  private monsterPaused = false;
  private renderClock = 0;
  private elapsed = 0;
  private carried = 0;
  private inserted = 0;
  private caughtCount = 0;
  private caughtTimer = 0;
  private powered = false;
  private enraged = false;
  private safe = false;
  private danger = 0;
  private prompt: string | null = null;
  private wasLocked = false;
  private pausedForScreenshot = false;
  private reducedMotion = false;
  private firstSighting = true;
  private readonly checkpoint = { position: new THREE.Vector3(), yaw: Math.PI };
  private readonly scratch = new THREE.Vector3();
  private readonly scratchB = new THREE.Vector3();

  private readonly onPointerLockChange = () => {
    const locked = this.input.isLocked();
    if (!locked && this.wasLocked && this.state === 'playing') this.setState('paused');
    this.wasLocked = locked;
  };

  private readonly onVisibility = () => {
    if (document.hidden && this.state === 'playing') this.setState('paused');
  };

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = createRenderer(canvas);
    this.renderer.toneMappingExposure = this.tuning.exposure;
    this.input = new InputController(canvas);
    this.level = new Level(createSeededRandom(7));
    this.player = new Player(this.camera, {
      onStep: (sprinting) => this.audio.playerStep(sprinting),
      onLightToggle: () => this.audio.flashlightClick(),
    });
    this.monster = new Monster(this.level, this.rng, {
      onNotice: () => {
        this.audio.noticeSting();
        if (this.state !== 'playing') return;
        this.hud.toast(this.firstSighting ? 'ガブガブーノに見つかった — 走れ!ライトを当てると怯む' : '見つかった!', {
          danger: true,
          seconds: this.firstSighting ? 4 : 2,
        });
        this.firstSighting = false;
      },
      onLost: () => {
        this.audio.lostSigh();
        if (this.state === 'playing') this.hud.toast('…見失ったようだ', { seconds: 2.5 });
      },
      onFootstep: (position, loudness) => this.audio.monsterFootstep(position, loudness),
      onChomp: (position) => this.audio.chomp(position),
    });
    // 図書室の奥(右上の角)に立つペンギーノ。最初は本棚の方を向いている。
    this.penguino = new Penguino(this.level, this.level.center({ col: 14, row: 1 }, new THREE.Vector3()), -Math.PI / 2, (position) =>
      this.audio.squeak(position),
    );
    // 1階廊下を巡回するチョーク・ワニーニ(光に反応する見張り)
    this.wanini = new Wanini(this.level, (at) => {
      this.audio.chalkScreech(this.wanini.position);
      this.callGabugabuno(at, 'キーーッ!チョーク・ワニーニに見つかった。ライトを消せ!');
    });
    // 理科準備室の入口で眠るうわばき・ドラゴンチーノ(音に反応する)
    this.dragontino = new Dragontino(this.level.center({ col: 17, row: 4 }, new THREE.Vector3()), -Math.PI / 2, {
      onWake: (at) => {
        this.audio.dragonRoar(this.dragontino.position);
        this.callGabugabuno(at, 'ドラゴンチーノが起きた!走ると起きる。そっと歩け');
      },
      onSnore: (at) => this.audio.snore(at),
    });
    this.hud = new Hud({
      onStart: () => this.startGame(),
      onResume: () => this.resumeGame(),
      onRestart: () => this.startGame(),
      onAgain: () => this.startGame(),
      onToggleMute: () => {
        this.audio.setMuted(!this.audio.isMuted());
        return this.audio.isMuted();
      },
      onSensitivity: (value) => {
        this.tuning.mouseSensitivity = value * 0.0016;
      },
    });
    this.debugTools = new DebugTools(this.tuning, () => {
      this.renderer.toneMappingExposure = this.tuning.exposure;
      this.resize();
    });

    this.createScene();
    this.postfx = new PostFX(this.renderer, this.scene, this.camera);
    if (this.lowFx) {
      this.renderer.shadowMap.enabled = false;
      this.player.flashlight.castShadow = false;
      this.tuning.maxDpr = 1;
    }
    this.resetRun();
    this.setState('title');
    this.resize();
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('visibilitychange', this.onVisibility);
    canvas.addEventListener('click', () => {
      if (this.state === 'playing') this.input.requestLock();
    });
    this.installTestHooks();
    this.publishDiagnostics();
  }

  start(): void {
    this.loop.start();
  }

  dispose(): void {
    this.loop.stop();
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.input.dispose();
    this.audio.dispose();
    this.debugTools.dispose();
    for (const fuse of this.fuses) fuse.dispose();
    this.monster.dispose();
    this.penguino.dispose();
    this.wanini.dispose();
    this.dragontino.dispose();
    this.player.beam.dispose();
    this.postfx.dispose();
    this.level.dispose();
    this.renderer.dispose();
    window.__THREE_GAME_DIAGNOSTICS__ = undefined;
    window.__THREE_GAME_TEST_HOOKS__ = undefined;
  }

  // ---------- 進行 ----------

  private startGame(): void {
    void this.audio.unlock();
    this.resetRun();
    this.setState('playing');
    this.input.requestLock();
    this.hud.toast('停電している。ヒューズを3本 探して分電盤へ', { seconds: 5 });
    window.setTimeout(() => this.audio.chime(null), 400);
  }

  private resumeGame(): void {
    this.input.requestLock();
    this.setState('playing');
  }

  private setState(state: AppState): void {
    this.state = state;
    this.hud.setState(state);
    this.input.clearPresses();
    if (state === 'paused' || state === 'title' || state === 'escaped') this.audio.suspend();
    else this.audio.resume();
    if (state === 'escaped') this.input.releaseLock();
  }

  private resetRun(): void {
    this.elapsed = 0;
    this.carried = 0;
    this.inserted = 0;
    this.caughtCount = 0;
    this.caughtTimer = 0;
    this.powered = false;
    this.enraged = false;
    this.danger = 0;
    this.firstSighting = true;
    for (const fuse of this.fuses) fuse.reset();
    this.level.setPower(false);
    this.level.setFuseLamps(0);
    this.level.resetDoor();
    this.applyLighting();
    this.level.center(this.level.playerStart, this.checkpoint.position);
    this.checkpoint.yaw = Math.PI;
    this.player.battery = 100;
    this.player.reset(this.checkpoint.position, this.checkpoint.yaw);
    this.monster.reset(this.level.monsterSpawn);
    this.penguino.reset(-Math.PI / 2);
    this.wanini.reset();
    this.dragontino.reset();
    this.alarms = 0;
    this.danger = 0;
    this.hud.clearToast();
  }

  private get stage(): number {
    return Math.min(TARGET_FUSES, this.carried + this.inserted);
  }

  private update(delta: number, elapsed: number): void {
    this.frame += 1;
    if (!this.reducedMotion) this.renderClock = elapsed;
    this.resize();
    if (this.pausedForScreenshot) {
      this.publishDiagnostics();
      return;
    }
    const animElapsed = this.reducedMotion ? 0 : elapsed;
    this.level.update(delta, animElapsed);
    for (const fuse of this.fuses) {
      if (this.reducedMotion) fuse.stabilize();
      else fuse.update(animElapsed);
    }

    if (this.state === 'title' && this.input.consumePress('Enter', 'Space')) this.startGame();
    if (this.state === 'paused' && this.input.consumePress('Enter')) this.resumeGame();
    if (this.state === 'playing') this.updatePlaying(delta, elapsed);
    else if (this.state === 'caught') this.updateCaught(delta, elapsed);

    this.audio.updateListener(this.camera);
    this.syncHud(delta);
    this.publishDiagnostics();
  }

  private syncHud(delta: number): void {
    this.hud.update(
      {
        inserted: this.inserted,
        carried: this.carried,
        battery: this.player.battery,
        stamina: this.player.stamina,
        exhausted: this.player.exhausted,
        lightOn: this.player.lightOn,
        safe: this.safe && this.state === 'playing',
        danger: this.state === 'playing' ? this.danger : 0,
        prompt: this.state === 'playing' ? this.prompt : null,
        objective: this.objectiveText(),
      },
      delta,
    );
  }

  private objectiveText(): string {
    if (this.powered) return '電源復旧!出口(右下)へ走れ';
    if (this.carried > 0) return '多目的ホールの分電盤にヒューズをはめろ';
    if (this.inserted > 0) return `残りのヒューズを探せ(あと${TARGET_FUSES - this.inserted}本)`;
    return 'ヒューズを探して分電盤にはめろ';
  }

  private updatePlaying(delta: number, elapsed: number): void {
    if (!this.input.isLocked() && this.input.consumePress('Escape', 'KeyP')) {
      this.setState('paused');
      return;
    }
    this.elapsed += delta;
    this.safe = this.level.isSafeZone(this.player.position);
    const lightOnMonster =
      this.player.illuminates(this.monster.headPosition(this.scratch), this.level) ||
      this.player.illuminates(this.scratch.copy(this.monster.position).setY(1.8), this.level);

    this.player.update(delta, this.input, this.level, this.tuning, { safe: this.safe, lightOnMonster });
    this.dragontino.pushOut(this.player.position);
    if (!this.monsterPaused) this.monster.update(delta, elapsed, {
      playerPosition: this.player.position,
      playerSafe: this.safe,
      noiseRadius: this.player.noiseRadius,
      lightOn: this.player.lightOn,
      litByFlashlight: lightOnMonster,
      stage: this.stage,
      enraged: this.enraged,
    });

    this.penguino.update(delta, this.camera);
    this.wanini.update(delta, elapsed, {
      position: this.player.position,
      eye: this.camera.position,
      lightOn: this.player.lightOn,
      safe: this.safe,
    });
    this.dragontino.update(delta, elapsed, {
      position: this.player.position,
      sprinting: this.player.sprinting,
      moving: this.player.noiseRadius > 0,
      safe: this.safe,
    });
    this.updateInteractions();
    if (this.state !== 'playing') return;

    const distance = Math.hypot(
      this.player.position.x - this.monster.position.x,
      this.player.position.z - this.monster.position.z,
    );
    if (distance < CATCH_DISTANCE && !this.safe && this.monster.state !== 'stunned') {
      this.startCaught();
      return;
    }
    // 出口
    if (this.powered && this.level.isExitOpen()) {
      const exitX = this.level.exitCell.col * CELL;
      const row = Math.floor(this.player.position.z / CELL);
      if (row === this.level.exitCell.row && this.player.position.x > exitX - 1.0) {
        this.escape();
        return;
      }
    }

    const chasing = this.monster.state === 'chase';
    const alert = this.monster.state === 'alert';
    const target = chasing
      ? 0.45 + Math.max(0, 1 - distance / 18) * 0.55
      : alert
        ? 0.55
        : Math.max(0, 1 - distance / 12) * 0.35;
    this.danger = THREE.MathUtils.damp(this.danger, this.safe ? 0 : target, 4, delta);
    this.audio.tick(this.danger, this.rng, this.player.position);
  }

  private updateInteractions(): void {
    this.prompt = null;
    const position = this.player.position;
    for (const fuse of this.fuses) {
      if (!fuse.active) continue;
      const d = Math.hypot(fuse.group.position.x - position.x, fuse.group.position.z - position.z);
      if (d < PICKUP_DISTANCE) {
        this.prompt = 'ヒューズを拾う';
        if (this.input.consumePress('KeyE')) this.collectFuse(fuse);
        return;
      }
    }
    const breakerDistance = Math.hypot(
      this.level.breakerFront.x - position.x,
      this.level.breakerFront.z - position.z,
    );
    if (breakerDistance < BREAKER_DISTANCE && !this.powered) {
      if (this.carried > 0) {
        this.prompt = `ヒューズをはめる(${this.carried}本)`;
        if (this.input.consumePress('KeyE')) this.insertFuses();
      } else {
        this.prompt = `分電盤 ${this.inserted}/${TARGET_FUSES} — ヒューズが足りない`;
      }
      return;
    }
    const exitDistance = Math.hypot(this.level.exitFront.x - position.x, this.level.exitFront.z - position.z);
    if (exitDistance < 2.5 && !this.powered) {
      this.prompt = '電気がないと 扉が開かない';
    }
    this.input.consumePress('KeyE');
  }

  /** 仲間に呼ばれたガブガブーノが、プレイヤーのいた場所へ駆けつける */
  private callGabugabuno(at: THREE.Vector3, message: string): void {
    this.alarms += 1;
    this.monster.summon(at);
    if (this.state === 'playing') this.hud.toast(message, { danger: true, seconds: 3.5 });
  }

  private collectFuse(fuse: Fuse): void {
    fuse.collect();
    this.carried += 1;
    this.audio.pickup();
    const total = this.carried + this.inserted;
    if (total === 1) this.hud.toast('…どこかで チャイムが鳴った。上履きの足音がする', { danger: true, seconds: 3.5 });
    else if (total === 2) this.hud.toast('「ガブ…ガブ…」 近づいてくる', { danger: true, seconds: 3 });
    else this.hud.toast('最後のヒューズだ。分電盤へ戻れ', { seconds: 3 });
  }

  private insertFuses(): void {
    this.inserted = Math.min(TARGET_FUSES, this.inserted + this.carried);
    this.carried = 0;
    this.level.setFuseLamps(this.inserted);
    this.audio.insertFuse(this.inserted);
    this.hud.flash(false, 0.25, 300);
    this.checkpoint.position.copy(this.level.breakerFront);
    this.checkpoint.yaw = -Math.PI / 2;
    if (this.inserted >= TARGET_FUSES) {
      this.powerOn();
    } else {
      this.hud.toast(`分電盤 ${this.inserted}/${TARGET_FUSES}`, { seconds: 2.5 });
    }
  }

  private powerOn(): void {
    this.powered = true;
    this.enraged = true;
    this.level.setPower(true);
    this.applyLighting();
    this.audio.powerOn();
    this.audio.doorOpen(this.level.exitFront);
    this.hud.flash(false, 0.6, 900);
    this.hud.toast('電気が戻った — ガブガブーノが怒っている。昇降口の出口へ走れ!', { danger: true, seconds: 5 });
    this.monster.stun(3.5);
  }

  private applyLighting(): void {
    this.hemisphere.intensity = this.powered ? 1.3 : 0.5;
    this.fog.density = this.powered ? FOG_POWERED : FOG_DARK;
  }

  private startCaught(): void {
    this.caughtCount += 1;
    this.caughtTimer = 0;
    this.setState('caught');
    this.audio.resume();
    this.audio.scream();
    this.hud.flash(true, 0.9, 700);
    this.monster.poseScare(this.camera, 0);
    this.player.flashlight.intensity = 4;
  }

  private updateCaught(delta: number, elapsed: number): void {
    this.caughtTimer += delta;
    const t = this.caughtTimer;
    const lunge = Math.min(1, t / 0.35);
    // 顔を見せる → 暗転
    this.player.lookAt(this.monster.headPosition(this.scratchB).setY(this.camera.position.y));
    this.monster.poseScare(this.camera, lunge);
    this.player.flashlight.intensity = 4;
    this.danger = Math.max(0, 1 - t / 1.5);
    const shake = Math.max(0, 1 - t / 1.2) * 0.06;
    this.camera.position.x += Math.sin(elapsed * 90) * shake;
    this.camera.position.y += Math.cos(elapsed * 77) * shake;
    if (t > 0.9 && t - delta <= 0.9) {
      this.hud.revealCaught(this.inserted > 0 ? '分電盤の前から再開します…' : '入口から再開します…');
    }
    if (t >= CAUGHT_DURATION) this.respawn();
  }

  private respawn(): void {
    this.player.reset(this.checkpoint.position, this.checkpoint.yaw);
    const farthest = this.farthestMonsterCell(this.checkpoint.position);
    this.monster.reset(farthest, this.enraged ? 2.5 : 5);
    if (this.enraged) this.monster.forceChase(this.player.position);
    this.danger = 0;
    this.setState('playing');
    this.input.requestLock();
    this.hud.toast('…もう一度', { seconds: 2 });
  }

  private farthestMonsterCell(from: THREE.Vector3): Cell {
    let best = this.level.monsterSpawn;
    let bestDistance = -1;
    for (const cell of [...EARLY_PATROL, this.level.monsterSpawn]) {
      const p = this.level.center(cell, this.scratch);
      const d = p.distanceTo(from);
      if (d > bestDistance) {
        bestDistance = d;
        best = cell;
      }
    }
    return best;
  }

  private escape(): void {
    this.setState('escaped');
    this.hud.showResults(this.elapsed, this.caughtCount);
  }

  private resize(): void {
    // postfx は構築前に呼ばれることがある(コンストラクタ内)
    if (resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr)) this.postfx?.setSize(this.renderer);
  }

  private render(): void {
    const intensity = this.player.lightOn ? this.player.flashlight.intensity / this.tuning.flashlightIntensity : 0;
    this.player.beam.update(this.camera, this.player.flashlight, Math.min(1, intensity), this.renderClock);
    if (this.lowFx) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.postfx.update(this.renderClock, this.state === 'playing' || this.state === 'caught' ? this.danger : 0);
    this.postfx.render();
  }

  private createScene(): void {
    this.scene.background = new THREE.Color('#050405');
    this.scene.fog = this.fog;
    this.scene.add(this.hemisphere);
    this.scene.add(this.level.group);
    this.scene.add(this.camera);
    this.scene.add(this.player.beam.dust);
    this.scene.add(this.monster.group);
    this.scene.add(this.penguino.group);
    this.scene.add(this.wanini.group);
    this.scene.add(this.dragontino.group);
    this.level.fuseCells.forEach((cell, index) => {
      const fuse = new Fuse(index, this.level.center(cell, new THREE.Vector3(), 0.55));
      this.fuses.push(fuse);
      this.scene.add(fuse.group);
    });
  }

  // ---------- テスト用フック ----------

  private placePlayer(cell: Cell, lookCell: Cell, lookY = 1.4): void {
    const position = this.level.center(cell, new THREE.Vector3());
    this.player.reset(position, 0);
    this.player.lookAt(this.level.center(lookCell, new THREE.Vector3(), lookY));
  }

  private installTestHooks(): void {
    // Deterministic hooks consumed by tests/visual-regression.template.ts and
    // bot playtests. Keep these real when evolving the game: silent no-op hooks
    // produce flaky screenshot baselines.
    window.__THREE_GAME_TEST_HOOKS__ = {
      seed: (value: number) => {
        this.rng = createSeededRandom(value);
        this.monster.setRng(this.rng);
      },
      setState: (name: string) => {
        const known = ['title', 'active-play', 'chase', 'showcase', 'penguino', 'wanini', 'dragontino', 'jumpscare', 'caught', 'finale', 'complete'];
        if (!known.includes(name)) throw new Error(`Unknown test state: ${name}`);
        this.resetRun();
        if (name === 'title') {
          this.setState('title');
        } else if (name === 'active-play') {
          this.setState('playing');
          // 多目的ホール: 分電盤と長机と学校目標が見える位置
          this.placePlayer({ col: 13, row: 12 }, { col: 9, row: 11 }, 1.3);
        } else if (name === 'chase') {
          this.setState('playing');
          this.carried = 1;
          this.placePlayer({ col: 12, row: 11 }, { col: 16, row: 11 }, 2.2);
          this.level.center({ col: 16, row: 11 }, this.monster.position);
          this.monster.forceChase(this.player.position);
          this.monster.snapFacing(this.player.position);
          this.monster.update(0.016, 0, {
            playerPosition: this.player.position,
            playerSafe: false,
            noiseRadius: 0,
            lightOn: true,
            litByFlashlight: true,
            stage: 1,
            enraged: false,
          });
          this.danger = 0.8;
        } else if (name === 'showcase') {
          // 電気の点いた多目的ホールで、ガブガブーノを斜め前から見る(モデル確認用)
          this.powered = true;
          this.level.setPower(true);
          this.applyLighting();
          this.setState('playing');
          this.placePlayer({ col: 14, row: 12 }, { col: 15, row: 10 }, 2.4);
          this.monster.reset({ col: 15, row: 10 }, 60);
          this.monster.position.x -= 0.3;
          this.monster.snapFacing(this.scratch.set(this.player.position.x - 1.2, 0, this.player.position.z));
        } else if (name === 'penguino') {
          // 図書室: 懐中電灯の先に、こちらを向いたペンギーノ
          this.setState('playing');
          this.placePlayer({ col: 11, row: 1 }, { col: 14, row: 1 }, 1.4);
          this.penguino.face(this.player.position);
        } else if (name === 'wanini') {
          // 1階廊下: ライトの先で、ワニーニがこちらに気づいて鳴いている
          this.setState('playing');
          this.placePlayer({ col: 7, row: 16 }, { col: 11, row: 16 }, 0.6);
          this.wanini.place(this.level.center({ col: 10, row: 16 }, new THREE.Vector3()), this.player.position);
          this.wanini.update(0.05, 0, { position: this.player.position, eye: this.camera.position, lightOn: true, safe: false });
        } else if (name === 'dragontino') {
          // 理科準備室の入口: 走ってしまい、ドラゴンチーノが目を覚ました
          this.setState('playing');
          this.placePlayer({ col: 17, row: 2 }, { col: 17, row: 4 }, 0.6);
          this.player.position.x -= 0.8;
          this.player.lookAt(this.scratch.copy(this.dragontino.position).setY(0.9));
          this.dragontino.forceAwake();
        } else if (name === 'jumpscare') {
          // 捕まった直後(暗転前)の顔
          this.placePlayer({ col: 13, row: 11 }, { col: 16, row: 11 });
          this.caughtCount = 1;
          this.setState('caught');
          this.caughtTimer = 0.4;
          this.player.lookAt(this.scratch.set(this.player.position.x + 5, 1.65, this.player.position.z));
          this.monster.poseScare(this.camera, 1);
          this.player.flashlight.intensity = 4;
        } else if (name === 'caught') {
          this.placePlayer({ col: 13, row: 11 }, { col: 16, row: 11 });
          this.caughtCount = 1;
          this.setState('caught');
          this.caughtTimer = 1.0;
          this.player.lookAt(this.scratch.set(this.player.position.x + 5, 1.65, this.player.position.z));
          this.monster.poseScare(this.camera, 1);
          this.player.flashlight.intensity = 4;
          this.hud.revealCaught('入口から再開します…');
        } else if (name === 'finale') {
          // 電源復旧直後: 出口へ向かう最後の直線(ガブガブーノは遠くで怯んでいる)
          this.inserted = TARGET_FUSES;
          this.level.setFuseLamps(TARGET_FUSES);
          this.powerOn();
          this.level.resetDoor();
          this.hud.clearToast();
          this.setState('playing');
          this.placePlayer({ col: 20, row: 18 }, { col: 25, row: 18 }, 2.0);
          this.level.center({ col: 1, row: 16 }, this.monster.position);
          this.monster.stun(6);
        } else if (name === 'complete') {
          this.inserted = TARGET_FUSES;
          this.level.setFuseLamps(TARGET_FUSES);
          this.powered = true;
          this.level.setPower(true);
          this.level.resetDoor();
          this.applyLighting();
          this.placePlayer({ col: 21, row: 18 }, { col: 25, row: 18 }, 2.2);
          this.elapsed = 312;
          this.caughtCount = 2;
          this.escape();
        }
        this.syncHud(0);
        this.render();
        this.publishDiagnostics();
        return { state: name };
      },
      setPausedForScreenshot: (paused: boolean) => {
        this.pausedForScreenshot = paused;
      },
      setReducedMotion: (enabled: boolean) => {
        this.reducedMotion = enabled;
        if (enabled) for (const fuse of this.fuses) fuse.stabilize();
        this.render();
        this.publishDiagnostics();
      },
      pauseMonster: (paused: boolean) => {
        this.monsterPaused = paused;
      },
      hideDebugUi: (hidden: boolean) => {
        this.debugTools.setHidden(hidden);
      },
    };
  }

  private publishDiagnostics(): void {
    const info = this.renderer.info;
    window.__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frame,
      elapsed: this.elapsed,
      score: this.inserted,
      targetScore: TARGET_FUSES,
      complete: this.state === 'escaped',
      state: this.state,
      fuses: { carried: this.carried, inserted: this.inserted, powered: this.powered },
      player: {
        position: {
          x: this.player.position.x,
          y: this.player.position.y,
          z: this.player.position.z,
        },
        speed: this.player.velocity.length(),
        yaw: this.player.yaw,
        stamina: this.player.stamina,
        battery: this.player.battery,
        lightOn: this.player.lightOn,
        safe: this.safe,
      },
      monster: {
        state: this.monster.state,
        distance: Math.hypot(
          this.player.position.x - this.monster.position.x,
          this.player.position.z - this.monster.position.z,
        ),
        position: { x: this.monster.position.x, z: this.monster.position.z },
      },
      caughtCount: this.caughtCount,
      allies: { alarms: this.alarms, waniniAlarmed: this.wanini.alarmed > 0, dragontinoAwake: this.dragontino.awake > 0 },
      renderer: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
      },
      canvas: {
        clientWidth: this.canvas.clientWidth,
        clientHeight: this.canvas.clientHeight,
        width: this.canvas.width,
        height: this.canvas.height,
        dpr: Math.min(window.devicePixelRatio || 1, this.tuning.maxDpr),
      },
    };
  }
}
