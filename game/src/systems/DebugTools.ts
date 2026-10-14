import GUI from 'lil-gui';
import type { PlayerTuning } from '../entities/Player';

export type DebugTuning = PlayerTuning & {
  exposure: number;
  maxDpr: number;
};

export class DebugTools {
  private gui: GUI | null = null;

  constructor(tuning: DebugTuning, onChange: () => void) {
    const enabled = new URLSearchParams(window.location.search).has('debug');
    if (!enabled) return;

    this.gui = new GUI({ title: 'チューニング' });
    this.gui.add(tuning, 'walkSpeed', 1, 8, 0.1);
    this.gui.add(tuning, 'sprintSpeed', 2, 12, 0.1);
    this.gui.add(tuning, 'acceleration', 4, 22, 0.1);
    this.gui.add(tuning, 'mouseSensitivity', 0.0005, 0.006, 0.0001);
    this.gui.add(tuning, 'flashlightIntensity', 0, 200, 1);
    this.gui.add(tuning, 'maxDpr', 1, 2, 0.25).onChange(onChange);
    this.gui.add(tuning, 'exposure', 0.6, 1.8, 0.01).onChange(onChange);
  }

  setHidden(hidden: boolean): void {
    if (!this.gui) return;
    if (hidden) this.gui.hide();
    else this.gui.show();
  }

  dispose(): void {
    this.gui?.destroy();
    this.gui = null;
  }
}
