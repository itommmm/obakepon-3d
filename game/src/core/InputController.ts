import * as THREE from 'three';

/**
 * 一人称用の入力。マウス視点(Pointer Lock)、WASD移動、ワンショットの操作キー。
 * Pointer Lock が使えない環境(ヘッドレスブラウザ等)では矢印キーで視点を回せる。
 */
export class InputController {
  private readonly keys = new Set<string>();
  private readonly pressed = new Set<string>();
  private lookX = 0;
  private lookY = 0;

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (!event.repeat) this.pressed.add(event.code);
    this.keys.add(event.code);
    if (event.code.startsWith('Arrow') || event.code === 'Space') event.preventDefault();
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
  };

  private readonly onMouseMove = (event: MouseEvent) => {
    if (!this.isLocked()) return;
    this.lookX += event.movementX;
    this.lookY += event.movementY;
  };

  private readonly onMouseDown = (event: MouseEvent) => {
    if (event.button === 2) this.pressed.add('MouseRight');
    if (event.button === 0) this.pressed.add('MouseLeft');
  };

  private readonly onContextMenu = (event: Event) => event.preventDefault();

  private readonly onBlur = () => this.keys.clear();

  constructor(private readonly element: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('mousemove', this.onMouseMove);
    element.addEventListener('mousedown', this.onMouseDown);
    element.addEventListener('contextmenu', this.onContextMenu);
  }

  isLocked(): boolean {
    return document.pointerLockElement === this.element;
  }

  requestLock(): void {
    if (this.isLocked() || !this.element.requestPointerLock) return;
    try {
      const result = this.element.requestPointerLock() as unknown;
      if (result instanceof Promise) result.catch(() => undefined);
    } catch {
      // Pointer Lock 非対応でも矢印キーで遊べる
    }
  }

  releaseLock(): void {
    if (this.isLocked()) document.exitPointerLock();
  }

  /** x = 右方向、y = 前方向 */
  readMovement(target: THREE.Vector2): THREE.Vector2 {
    target.set(0, 0);
    if (this.keys.has('KeyA')) target.x -= 1;
    if (this.keys.has('KeyD')) target.x += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) target.y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) target.y -= 1;
    if (target.lengthSq() > 1) target.normalize();
    return target;
  }

  /** テスト用: マウス移動と同じ経路で視点を動かす(Pointer Lock が無くても効く) */
  addLook(dx: number, dy = 0): void {
    this.lookX += dx;
    this.lookY += dy;
  }

  /** 前回呼び出しからのマウス移動量(px)と、矢印キーによる回転量(rad/s の符号) */
  consumeLook(): { dx: number; dy: number; turn: number } {
    const dx = this.lookX;
    const dy = this.lookY;
    this.lookX = 0;
    this.lookY = 0;
    let turn = 0;
    if (this.keys.has('ArrowLeft')) turn -= 1;
    if (this.keys.has('ArrowRight')) turn += 1;
    return { dx, dy, turn };
  }

  isSprintHeld(): boolean {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  /** 1回押しの判定(押された瞬間だけ true、読むと消える) */
  consumePress(...codes: string[]): boolean {
    let hit = false;
    for (const code of codes) {
      if (this.pressed.delete(code)) hit = true;
    }
    return hit;
  }

  clearPresses(): void {
    this.pressed.clear();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('mousemove', this.onMouseMove);
    this.element.removeEventListener('mousedown', this.onMouseDown);
    this.element.removeEventListener('contextmenu', this.onContextMenu);
  }
}
