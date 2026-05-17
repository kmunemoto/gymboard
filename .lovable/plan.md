# ジムボード変換プラン

このプロジェクトを「パーソナルジムSalute御所南」から汎用パーソナルジム向けSaaS「ジムボード」に変換します。作業は **3フェーズ** に分けて進めます。

---

## フェーズ1: ゲーミフィケーション機能の削除

### 顧客画面（CustomerHome.tsx）
以下のカード/import/関連state/hooksを全削除:
- AvatarCard, AvatarGenderSetupDialog
- LoginBonusBanner, LoginBonusDialog, useLoginBonus
- DailyMissionCard, RaidBossCard, GachaCard
- SeasonEventCard, DungeonCard, LuminasChronicleCard
- WeightJourneyMapCard
- useNextMilestone とマイルストーンバナーJSX

**残すもの**: StreakCard, ProgressCharts, WorkoutShareModal, 次回予約, 統計カード, サイクルレポート, 体重・体脂肪率カード

### CustomerView.tsx
- `CustomerTab` 型から `"quest" | "dungeon" | "chronicle"` を削除
- 対応するタブレンダリングと import を削除

### CustomerTraining.tsx
- 「ランキング」タブを削除（タブは「トレーニング」「写真」の2つに）

### CustomerSettings.tsx
- `game_mode_enabled` トグルがあれば削除

### トレーナー管理画面
- TrainerRaidManager / TrainerQuestManager / TrainerRivalBattleManager / TrainerClientAvatarTab を削除
- TrainerEventManager のゲーム関連部分を削除（お知らせ管理は残す）
- TrainerSidebar からゲーム系メニューを削除

**残すメニュー**: ダッシュボード / 顧客一覧 / スケジュール / 種目管理 / お知らせ管理 / 通知設定 / ジム設定

---

## フェーズ2: ブランディング変更

### 文字列置換ルール
| 変更前 | 変更後 |
|---|---|
| パーソナルジムSalute御所南 / Salute御所南 / Salute 御所南 / Salute | ジムボード |
| 御所南（ジム名一部） | 削除 |
| kyoto-salute | gymboard |
| 京都市中京区毘沙門町533-1 プラザ御所南2階 | 削除（または「（ジム設定に依存）」） |
| k.munemoto@kyoto-salute.com | info@gymboard.app |
| https://app.kyoto-salute.com/auth/callback | デプロイURL + /auth/callback |

### 対象ファイル（一覧記載のもの全て）
index.html, public/manifest.json, src/pages/Auth.tsx, Privacy.tsx, Terms.tsx, TrialBooking.tsx, CustomerView.tsx, CustomerBooking.tsx, BookingCompleteDialog.tsx, WorkoutShareCard.tsx, WorkoutShareModal.tsx, TrainerView.tsx, useMessages.ts, useBookings.ts, workoutShare.ts, googleCalendar.ts, progressPhotoShare.ts

### Canvas描画簡略化
- `WorkoutShareModal.tsx` の `drawSaluteTitle` を「ジムボード」1色描画にリネーム/簡略化
- `workoutShare.ts` フッターの2色描画も1色化

### コメント削除
「⚠️ DO NOT change this app name」等のSalute固定指示コメントを全削除

---

## フェーズ3: 検証

- ビルドエラーなし（未使用import / 削除コンポーネント参照なし）
- ホーム画面に削除カードが表示されない、残すカードは正常表示
- BottomNav 5タブ正常動作
- 記録画面タブが2つのみ
- トレーナーサイドバーにゲーム系メニューなし
- 各画面ヘッダー/通知/規約に「ジムボード」表示

---

## 技術メモ

- 削除対象コンポーネントファイル自体（src/components/customer/Avatar*.tsx 等）はimport元から外すのみとし、ファイル削除は最終段でビルドエラーがないことを確認してから実施
- `EMAIL_CALLBACK_URL` は実際のデプロイ先URLが必要。**現在のLovableプレビューURL** (`https://id-preview--69ac2641-45d8-44e0-b60d-4e002a4f9c1c.lovable.app/auth/callback`) を仮で設定し、公開ドメイン確定後に差し替える方針で問題ないか確認します
- メモリ（mem://branding/app-identity 等）も「ジムボード」へ更新

---

## 確認事項

1. **EMAIL_CALLBACK_URL**: 現時点のプレビューURLで仮設定してよいか？ それとも別の公開ドメイン予定がありますか？
2. **メールアドレス info@gymboard.app**: このドメインはまだ存在しない可能性がありますが、文字列としてそのまま入れる想定でOKですか？
3. 削除するコンポーネントの **物理ファイル削除**(rm)まで行いますか？（importを外すだけでも動作はします）

承認いただければ実装に入ります。
