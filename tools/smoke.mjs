// ヘッドレスChromiumで起動し、各ステージを短縮して進め、実行時エラーがないか確認する
import { chromium } from 'playwright';
const file = 'file://' + process.argv[2];
const b = await chromium.launch({ executablePath:process.env.CHROME_PATH || undefined, args:['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const errs = [];
for (const vp of [{ width:1280, height:720 }, { width:844, height:390, isMobile:true, hasTouch:true }]) {
  const pg = await b.newPage({ viewport:{ width:vp.width, height:vp.height }, isMobile:vp.isMobile, hasTouch:vp.hasTouch });
  pg.on('pageerror', e => errs.push(vp.width + ': ' + e.message));
  pg.on('console', m => m.type() === 'error' && errs.push(vp.width + ' console: ' + m.text()));
  await pg.goto(file); await pg.waitForTimeout(1500);
  await pg.click('#st .go'); await pg.waitForTimeout(1200);
  for (let i = 0; i < 40; i++) { await pg.mouse.click(vp.width * (.2 + .6 * Math.random()), vp.height * (.3 + .4 * Math.random())); await pg.waitForTimeout(60); }
  await pg.keyboard.press('z'); await pg.keyboard.press('x');
  await pg.screenshot({ path:`/tmp/claude-0/shot_${vp.width}_s1.png` });
  // ステージ1→2→3を強制的に進める
  for (const st of [0, 1]) {
    await pg.evaluate(() => { G.hold = false; G.kills = G.k0 + 4 * G.kpw; }); await pg.waitForTimeout(800);
    await pg.evaluate(() => { const c = document.querySelector('#cards .card'); c && c.click(); }); await pg.waitForTimeout(1500);
    await pg.evaluate(() => { const b = mon.find(m => m.k.boss); if (b) { b.hp = 1; hitMon(b, b.g.position); } }); await pg.waitForTimeout(500);
    await pg.evaluate(() => { const b = document.querySelector('#scb .go'); b && b.click(); }); await pg.waitForTimeout(800);
    await pg.evaluate(() => { const c = document.querySelector('#cards .card'); c && c.click(); }); await pg.waitForTimeout(1500);
    await pg.screenshot({ path:`/tmp/claude-0/shot_${vp.width}_s${st + 2}.png` });
  }
  await pg.evaluate(() => { G.hp = 99; G.left = 999; G.stt = 49.5; }); await pg.waitForTimeout(3000);
  await pg.screenshot({ path:`/tmp/claude-0/shot_${vp.width}_boss.png` });
  const st = await pg.evaluate(() => ({ space:G.space, stage:G.stage, boss:!!G.sboss, se:SE.length, run:G.run }));
  console.log(vp.width, JSON.stringify(st));
  await pg.evaluate(() => { G.sboss.hp = 1; sHit(G.sboss); }); await pg.waitForTimeout(800);
  console.log(vp.width, 'ended:', await pg.evaluate(() => document.querySelector('#et').textContent));
  await pg.close();
}
await b.close();
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'NO_ERRORS');
