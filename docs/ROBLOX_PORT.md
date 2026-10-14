# Roblox移植メモ

| Web版（src/main.js） | Roblox側の想定 |
|---|---|
| `K`（敵定義）/ `SP`（出現位置）/ `WV`（WAVE設定）/ `DIFF`（難易度） | ReplicatedStorage の共有 ModuleScript |
| `spawn` / `hitMon` / `kill` / `stageClear` | ServerScriptService のゲーム進行モジュール（判定・得点はサーバー確定） |
| `step(dt)` / `spStep(dt)` | `RunService.Heartbeat` |
| タップ → `RC.intersectObjects` | クライアントで `Raycast` → `RemoteEvent` → サーバーで距離・連射間隔を検証 |
| 出入り・飛びかかり・歩行 | `TweenService` / Animator |
| `BUILD.*`（手続き型モデル） | 3Dモデル（MeshPart）に置き換え |
| HUD・パワーアップ選択 | `ScreenGui` |
| 最終ステージ（奥スクロール） | カメラ固定＋地面テクスチャのスクロール、敵をZ方向に移動 |
| localStorage（難易度・ベスト） | `DataStoreService`（セッションロック・リトライ付き） |
