# ゲーミフィケーションの無効化（2026-07）

## 背景
「パーソナルジムの管理ツール」として機能を絞る方針のため、アバター・EXP/レベル・称号・
バッジ・ミッション・レイドボス・シーズンイベントといったゲーム要素をアプリから外した。

## やり方: フラグOFF（コードもデータも消していない）
`src/lib/featureFlags.ts` の **`GAMIFICATION_ENABLED = false`**。
既存の `BILLING_ENABLED` と同じ方針で、`true` に戻すだけで元どおり復活する。
獲得済みのバッジ・EXP・アバターといった**お客様のデータも一切消していない**。

削除ではなくフラグにした理由:
- ゲーム要素は `workouts` の AFTER INSERT トリガーやテーブル多数（`user_avatars` /
  `quest_bosses` / `avatar_achievements` 等）まで及び、一括削除は取り返しがつかない。
- 「まずアプリから消える」ことが目的なので、可逆な方法で先に効果を出す方が安全。

## OFFで消えるもの
トレーニング記録の保存後に出ていた獲得系の演出（`TrainerClientDetail` の保存処理内）:
- ミッション達成トースト（`evaluateAndAwardMissions`）
- セッションEXPダイアログ（`processSessionRewards` → `SessionExpSummaryDialog`）
- マイルストーン獲得ダイアログ（`checkTrainingMilestones` → `MilestoneAchievedDialog`）
- レイド撃破トースト（`applyRaidDamage`）
- シーズンイベント達成トースト（`updateEventProgress`）

加えて、SNSシェアカードの獲得バッジ表示（`WorkoutShareModal` が `featured_badges` を
取得しなくなり、`WorkoutShareCard` はバッジ行を描画しない）。

**トレーニング記録の保存自体は不変**。演出ブロックだけを `if (GAMIFICATION_ENABLED)` で
囲んでおり、フォームのリセット等はフラグの外に置いている。

## 紛らわしい点（触ってはいけないもの）
- **「目標」(`profiles.milestone_goal` / `MilestoneGoal`) はゲーム要素ではない**。
  トレーナーが設定するコーチング用のテキストで、このフラグの対象外。
  `raidUtils` の `checkTrainingMilestones`（累計セッション数の報酬）と名前が似ているだけ。
- `CustomerTraining` の `useAvatar()` は**性別の取得にだけ使っている**
  （筋肉アイコン画像の男女出し分け）。ゲームUIは出さないのでフラグ対象外。
  ただし **`gender` の保存先は `user_avatars` しかない**ため、将来アバター系を物理削除する
  なら、先に `profiles` などへ性別を移す必要がある。

## 残っているもの（完全削除する場合の宿題）
- `workouts` の AFTER INSERT トリガー（ガチャ券付与・クエストダメージ）はDB側の処理のため
  このフラグでは止まらない。対応するUIが無いので利用者からは見えないが、書き込みは続く。
  止めるならトリガー削除のマイグレーションが必要。
- `src/lib/{avatarSystem,avatarRewards,titleSystem,missionSystem,missionRewards,raidUtils}.ts`、
  `src/hooks/{useAvatar,useSeasonEvents}.ts`、`BadgeIcon` / `SessionExpSummaryDialog` /
  `MilestoneAchievedDialog` は残置（未使用ではなくフラグで分岐しているだけ）。
- 上記を物理削除するとバンドルは軽くなる。本番でしばらく様子を見て、取りこぼしが無いと
  確認できてから別PRで消すのが安全。
