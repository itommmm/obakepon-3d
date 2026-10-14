# Claude を使ったバイブコーディングによるゲーム開発の調査(2026年10月)と、その反映

## 調べたこと(SNS・ブログ・ニュース)

| 事例 | ポイント |
|---|---|
| **Claude of Duty**(Matt Shumer、Opus 5) | Three.js のブラウザFPS。約5.5万行で、外部アセットはゼロ(3Dモデル、HDRI、画像、音声ファイルを使わない)。メッシュ、テクスチャ、音をすべて実行時にコードで生成している。1回のプロンプトで完成させたのではなく、エージェントにループを回させて作り込んでいる。 |
| **Opus 5 のワンプロンプト3Dゲームの流行**(2026年7〜8月) | シューター、潜水艦、カート、Minecraft風など。物理演算や音楽まで生成した例がある。カートは127エージェント×11ラウンド、Minecraft風は2500万トークンを使っていて、数を回す反復が品質の源になっている。 |
| **Vibe Jam 2026**(@levelsio 主催、Tripo ほか協賛) | ダウンロード不要のブラウザゲーム限定で、コードの90%以上をAIが書くことが条件。主催者は「今年は去年よりずっと良い」と評価している。 |
| **国内のブログ** | 「コードを1行も書かず、アセットも買わず、2日で3Dゲーム」という事例がある。Claude Opus はマップやキャラクターなど見た目の部分の作り込みが強い、という比較もある。 |
| **3Dアセットのバイブ生成** | Blender MCP(Claude が Blender を操作する。Hunyuan3D や Rodin と連携)、Tripo などの text-to-3D。 |
| **注意点** | Three.js は2026年だけで4回リリースがあり、API名の変更が多い(例: r183 で PostProcessing → RenderPipeline)。バージョンを固定し、最新のドキュメントを渡すのが定石。 |

### 情報源
- [Claude Opus 5 pushes prompt-to-game AI from rough color blocks to full 3D prototypes(The Decoder)](https://the-decoder.com/claude-opus-5-pushes-prompt-to-game-ai-from-rough-color-blocks-to-full-3d-prototypes-with-physics-and-music/)
- [Claude of Duty — Opus 5 Procedural FPS(explainx)](https://www.explainx.ai/blog/claude-of-duty-opus-5-procedural-fps-july-2026)
- [Vibe Jam 2026 winners(@levelsio on X)](https://x.com/levelsio/status/2067364066193203333?lang=en)
- [Vibe Jam 2026 winners and how the games are getting close to real production quality(levels.io)](https://levels.io/vibe-jam-2026-winners-quality)
- [Claude Code に要望を伝え続けたら数時間で3Dゲームが完成した話](https://blog.usize-tech.com/claudecode-3dgame-developing/)
- [FPS、マインスイーパ、3Dダンジョンゲームも:バイブコーディングによるゲーム開発事例紹介(モリカトロン)](https://morikatron.ai/2026/01/vibecording_gamediv/)
- [BlenderMCP(DEV Community)](https://dev.to/githubopensource/blendermcp-unleash-the-power-of-ai-in-your-3d-modeling-workflow-1ooa)
- [Three.js r183 render pipeline(cinevva)](https://app.cinevva.com/news/2026-03-18-threejs-r183-render-pipeline)

注: The Decoder 以外はコミュニティの投稿やまとめ記事が中心で、品質の評価は本人の申告です。

## このゲームへの反映

| トレンド | おばけポンでやったこと |
|---|---|
| 外部アセットゼロ。すべてコードで生成する | 3Dモデル、テクスチャ、音、UIアートをすべてコードで生成している(外部ファイルは0) |
| **3Dグラフィックもバイブで** | 新しく **SDF スカルプト**(`src/render/sdf.ts`)を導入した。距離関数をなめらかに足したり削ったりして形を彫り、Surface Nets でメッシュ化する。ガブガブーノ(ひれが体から生える、歯が口の縁から伸びる、上履きの足)とペンギーノを、プリミティブの寄せ集めから有機的な一体モデルに作り直した |
| シェーダで質感と演出を出す | ポストエフェクトを追加した(`src/render/PostFX.ts`: ブルーム、危険度で強まる色収差、周辺減光、赤い脈動、フィルムグレイン)。懐中電灯の光の筋と、光の中だけに浮かぶチリも、すべてシェーダで描いている(`src/render/FlashlightBeam.ts`) |
| スクリーンショットで確認し、直すループ | テスト用フックで9つの状態を撮影する。全体の検査は10回まわし、その間の一点確認もあわせて、発光が強すぎる、パーツが体に埋まっている、ひれが線にしか見えない、などを直した |
| 実際に遊んで確かめる | 実キー入力のボット(拾う → はめる → 捕まる → 再開、出口へ脱出 → もう一度)で動作を確認する |
| Three.js のバージョン固定 | r184 に固定。WebGPU / RenderPipeline への移行はせず、安定した WebGL の EffectComposer を使う |

## 今後の候補(外部サービスが使える場合)
- Tripo / Hunyuan3D でガブガブーノの高精細版を作り、SDF 版と見比べる
- Blender MCP でリギングとアニメーションを付ける
- ElevenLabs で「ガブガブーノ…」の声を収録する
