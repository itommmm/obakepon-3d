export type AppState = 'title' | 'playing' | 'paused' | 'caught' | 'escaped';

export type HudView = {
  inserted: number;
  carried: number;
  battery: number;
  stamina: number;
  exhausted: boolean;
  lightOn: boolean;
  safe: boolean;
  danger: number;
  prompt: string | null;
  objective: string;
};

export type HudActions = {
  onStart(): void;
  onResume(): void;
  onRestart(): void;
  onAgain(): void;
  onToggleMute(): boolean;
  onSensitivity(value: number): void;
};

export class Hud {
  private readonly app = this.get('#app');
  private readonly objectiveText = this.get('#objective-text');
  private readonly slots = [...document.querySelectorAll<HTMLElement>('.fuse-slot')];
  private readonly carry = this.get('#carry-count');
  private readonly carryValue = this.get('#carry-value');
  private readonly batteryMeter = this.get('#battery-meter');
  private readonly batteryCells = [...document.querySelectorAll<HTMLElement>('.battery-cells i')];
  private readonly staminaMeter = this.get('#stamina-meter');
  private readonly staminaFill = this.get('#stamina-fill');
  private readonly prompt = this.get('#prompt');
  private readonly promptText = this.get('#prompt-text');
  private readonly toastEl = this.get('#toast');
  private readonly safeBadge = this.get('#safe-badge');
  private readonly flashEl = this.get('#fx-flash');
  private readonly titleScreen = this.get('#title-screen');
  private readonly pauseScreen = this.get('#pause-screen');
  private readonly caughtScreen = this.get('#caught-screen');
  private readonly winScreen = this.get('#win-screen');
  private readonly muteButton = this.get('#mute-button');
  private toastTimer = 0;
  private last = { inserted: -1, carried: -1, batteryCells: -1, prompt: '' as string | null, objective: '' };

  constructor(actions: HudActions) {
    this.get('#start-button').addEventListener('click', () => actions.onStart());
    this.get('#resume-button').addEventListener('click', () => actions.onResume());
    this.get('#restart-button').addEventListener('click', () => actions.onRestart());
    this.get('#again-button').addEventListener('click', () => actions.onAgain());
    this.muteButton.addEventListener('click', () => {
      const muted = actions.onToggleMute();
      this.muteButton.textContent = muted ? '音: オフ' : '音: オン';
      this.muteButton.setAttribute('aria-pressed', String(muted));
    });
    const slider = this.get('#sensitivity') as HTMLInputElement;
    slider.addEventListener('input', () => actions.onSensitivity(Number(slider.value)));
  }

  setState(state: AppState): void {
    this.app.dataset.state = state;
    this.titleScreen.hidden = state !== 'title';
    this.pauseScreen.hidden = state !== 'paused';
    this.caughtScreen.hidden = state !== 'caught';
    this.winScreen.hidden = state !== 'escaped';
    if (state !== 'caught') this.caughtScreen.classList.remove('reveal');
    if (state === 'paused') (this.get('#resume-button') as HTMLButtonElement).focus();
    if (state === 'title') (this.get('#start-button') as HTMLButtonElement).focus();
  }

  revealCaught(subText: string): void {
    this.get('#caught-sub').textContent = subText;
    this.caughtScreen.classList.add('reveal');
  }

  showResults(seconds: number, caught: number): void {
    this.get('#result-time').textContent = formatTime(seconds);
    this.get('#result-caught').textContent = String(caught);
    (this.get('#again-button') as HTMLButtonElement).focus();
  }

  update(view: HudView, delta: number): void {
    if (view.inserted !== this.last.inserted) {
      this.slots.forEach((slot, index) => slot.classList.toggle('filled', index < view.inserted));
      this.last.inserted = view.inserted;
    }
    if (view.carried !== this.last.carried) {
      this.carryValue.textContent = String(view.carried);
      if (view.carried > this.last.carried && this.last.carried >= 0) {
        this.carry.classList.remove('pulse');
        void this.carry.offsetWidth;
        this.carry.classList.add('pulse');
      }
      this.last.carried = view.carried;
    }
    if (view.objective !== this.last.objective) {
      this.objectiveText.textContent = view.objective;
      this.last.objective = view.objective;
    }
    const cells = Math.ceil(view.battery / 10);
    if (cells !== this.last.batteryCells) {
      this.batteryCells.forEach((cell, index) => cell.classList.toggle('on', index < cells));
      this.last.batteryCells = cells;
    }
    this.batteryMeter.classList.toggle('low', view.battery < 20);
    this.batteryMeter.classList.toggle('off', !view.lightOn);
    this.staminaFill.style.transform = `scaleX(${(view.stamina / 100).toFixed(3)})`;
    this.staminaMeter.classList.toggle('exhausted', view.exhausted);
    if (view.prompt !== this.last.prompt) {
      this.prompt.hidden = !view.prompt;
      if (view.prompt) this.promptText.textContent = view.prompt;
      this.last.prompt = view.prompt;
    }
    this.safeBadge.hidden = !view.safe;
    this.app.style.setProperty('--danger-level', view.danger.toFixed(3));

    if (this.toastTimer > 0) {
      this.toastTimer -= delta;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }
  }

  toast(text: string, options: { danger?: boolean; seconds?: number } = {}): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.toggle('danger', !!options.danger);
    this.toastEl.classList.add('show');
    this.toastTimer = options.seconds ?? 3;
  }

  clearToast(): void {
    this.toastTimer = 0;
    this.toastEl.classList.remove('show');
  }

  flash(red = false, peak = 0.85, duration = 500): void {
    this.flashEl.classList.toggle('red', red);
    this.flashEl.animate([{ opacity: peak }, { opacity: 0 }], { duration, easing: 'ease-out' });
  }

  private get(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing HUD element: ${selector}`);
    return element;
  }
}

export function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const rest = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${rest}`;
}
