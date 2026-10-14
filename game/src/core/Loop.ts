export class Loop {
  private frameId = 0;
  private lastTime = 0;
  private running = false;

  constructor(
    /** rawSeconds は打ち切り前の実時間(固定刻みで進めたいときに使う) */
    private readonly update: (deltaSeconds: number, elapsedSeconds: number, rawSeconds: number) => void,
    private readonly render: () => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.frameId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameId);
  }

  private readonly tick = (time: number) => {
    if (!this.running) return;
    const rawSeconds = (time - this.lastTime) / 1000;
    const deltaSeconds = Math.min(rawSeconds, 0.05);
    this.lastTime = time;
    this.update(deltaSeconds, time / 1000, rawSeconds);
    this.render();
    this.frameId = requestAnimationFrame(this.tick);
  };
}
