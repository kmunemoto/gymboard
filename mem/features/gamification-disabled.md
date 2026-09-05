# ゲーミフィケーションの無効化 → 撤去（2026-07 フラグOFF / 2026-09 撤去開始）

> **2026-09-05 追記: 物理削除を始めた。** 宗本さんの指示で第1段（性別の引っ越し＋
> トリガー停止）まで完了。以下は当時の記録で、いまの状態は末尾の「撤去の進み方」を見ること。

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


---

# 撤去（2026-09-05〜）

宗本さんの指示で、フラグOFFのまま残していたものを物理削除する。

## 🔴 大前提: 予約と記録は1件も消さない

作業前の数字（毎段このあと突き合わせる）:

```
bookings 788 / workouts 2434 / trial_bookings 74 / profiles 73 / user_measurements 284
```

**ゲーム系テーブルを参照している外部キーは、すべて別のゲーム系テーブルから**であることを
確認済み。`bookings` / `workouts` / `profiles` から1本も張られていないので、
テーブルを落としても予約・記録に波及しない。

## 🔴 regex で選ばない（実際に危なかった）

`quest` で拾うと **`booking_questions`（予約のカスタム質問）**が混ざる。
`title` で拾うと `user_titles` 以外も当たる。**テーブルは手で仕分けること。**

残すもの（ゲームに見えるが実機能）:

| テーブル | 何 |
|---|---|
| `booking_questions` | 予約時のカスタム質問。**`quest` の部分一致で引っかかるだけ** |
| `weight_journey` | カルテの体重目標パネル（`BODY_METRICS_ENABLED`）。**生きている機能** |
| `user_measurements` | 体組成の記録（284件） |

（`weight_journey_milestones` は `coins_awarded` / `badge_key` を持つゲーム側なので落とす。
親の `weight_journey` は残す。子→親の向きなので順序の問題は起きない）

## 第1段（2026-09-05・完了）: 性別の引っ越し＋トリガー停止

`supabase/migrations/20260905010000_move_gender_to_profiles.sql`

**やったのは「列を足す」「値を写す」「トリガーを外す」の3つだけ。行は1つも消していない。**

### なぜ性別を先に動かすのか

保存先が `user_avatars.gender` しかなく、そこに**3つの実機能**がぶら下がっていた:

1. 顧客一覧の「男性 / 女性」タブと人数（`TrainerClientList`）
2. カルテの性別設定（`TrainerClientDetail`）
3. お客様の記録画面の筋肉図の出し分け（`CustomerTraining`）

⚠️ 撤去の検討を始めた時点では「筋肉図だけ」と誤って把握していた。**3か所だった。**

### 結果（本番で実測）

```
bookings 788→788 / workouts 2434→2434 / profiles 73→73     ← 1件も減っていない
profiles.gender = 8件（男4・女4）
workouts のトリガー 3本→1本（残るのはプラン上限のガードだけ）
在籍者のうち性別の取りこぼし = 0件
```

⚠️ `user_avatars` には性別つきが10件あったが、写せたのは8件。
**残り2件は `profiles` に行が無いアカウント**（在籍0・予約0・記録0。`auth.users` にだけ存在）。
どの画面にも出てこないので実害なし。

### 止まったもの

- `trg_grant_gacha_ticket` … 記録を保存するたびガチャ券を配布していた（**2026-09-05 にも発火していた**）
- `trg_quest_battle_on_workout` … 記録を保存するたびクエスト戦闘を実行していた
- `useAvatar` の呼び出し元が**0**になった。画面に何も出ないまま
  アバター行の作成・称号の付与・`check_collection_milestones` の呼び出しを続けていた

番人は `src/test/genderOnProfiles.test.ts`（17件）。
**マイグレーションに DELETE / TRUNCATE / DROP TABLE が現れたら落ちる。**

## 第2段a（2026-09-05・完了）: コードの削除

**3,536行を削除した。DBは触っていない**（テーブル削除は第2段b）。

### 🔴 監査で見つかった、危なかったもの

**① 予約画面がフラグの外で `raid_bosses` を叩いていた**

`CustomerBooking.tsx` が**マウントのたびに**レイドボスを読み、カレンダーに赤い帯と
剣アイコンを出す作りだった。`GAMIFICATION_ENABLED` の**外**にあり、フラグOFFの間も
本番で走り続けていた。テーブルを先に落としていたら、予約画面を開くたびに
失敗リクエストが飛ぶところだった（画面は落ちないので気づけない）。

**② `avatarSystem.ts` は丸ごと消せなかった**

`muscleMapIcon.ts` が `AVATAR_CDN_BASE` を import している。部位アイコン（記録一覧の
「使っている部位」の画像）は**生きた機能**。定数を `MUSCLE_ICON_CDN_BASE` として
`muscleMapIcon.ts` へ移してから削除した。

⚠️ この URL のホストは `clsvdhovzqrkojvkvekw` で、**ジムボード（`rrbfwitprzuevzytykrq`）
とは別の Supabase プロジェクト**。画像はそちらのストレージにある。URL を変えないこと。

⚠️ ジムボード側の `avatars` バケットは**消さないこと**。`Onboarding.tsx` が
プロフィール写真（`profiles.avatar_url`）の置き場に使っている。ドット絵とは別物。

**③ `check_weight_milestones` をゲームでない画面が2か所で呼んでいた**

`useMeasurements.ts`（体組成の保存時）と `TrainerWeightJourneyPanel.tsx`（体重目標の
保存時）。関数の中身は消す側のテーブルにしか書いていないので、呼び出しごと外した。

### 🔴 前置き一致でロケールのキーを消して、実機能を消しかけた

`mission|raid|event|exp|badge` で始まるキーを消そうとしたら、
**`clientDetail.expiry` / `expiryPending` / `expiryConsumed`（契約の有効期限）**まで
巻き込んだ。テストは通ってしまう（誰も参照を検査していない）ので、
気づいたのは目視。**キーは1つずつ手で挙げること。**

同じ罠を、テーブル選定でも一度踏みかけている（`booking_questions` が `quest` に当たる）。

### 消したもの

| | |
|---|---|
| `src/lib/` | avatarSystem / avatarRewards / titleSystem / missionSystem / missionRewards / raidUtils / rankPerks / comboSystem |
| `src/hooks/` | useAvatar / useSeasonEvents |
| `src/components/customer/` | BadgeIcon / SessionExpSummaryDialog / MilestoneAchievedDialog |
| Edge Function | `payments-webhook` / `create-checkout`（どちらもコイン購入専用。`coin_purchases` は0件で購入UIも無い） |
| `src/index.css` | 117行（`.pixel-avatar` / `.raid-band` / `.rainbow-frame` / `.golden-frame` / クエストの演出一式） |
| ロケール | 5言語 × 13キー（`titles` / `sessionExp` / `ranks` / `milestoneDialog` / `clientDetail.mission*|raid*|event*`）＋ golf プリセットの `sessionExp` |
| フラグ | `GAMIFICATION_ENABLED` ごと削除 |

ラチェットも下げた（減ったら上限も下げる）:
`as any` 128→102 ／ TrainerClientDetail 2000→1900 ／ CustomerBooking 1490→1450

`rpcCallerCheck.test.ts` のしきい値も 3 → 2 に下げた
（user_id 付きで呼ぶ RPC が8本→2本に減ったため）。

## 第2段b（2026-09-05・完了）: テーブル50個・関数55本を削除

🔴 **ここから戻せない。** `supabase/migrations/20260905020000_drop_gamification.sql`

### 監査の反証が1本実行されなかったので、実測で埋めた

3つの観点で反証させたうち、**よりによって「予約と記録が減らないか」が
安全フィルタで実行されなかった**。机上の確認が取れないので、
**本番で丸ごと落として数を数えてから ROLLBACK する**予行演習を2回やった。

```
予行演習1（テーブルだけ）
  bookings 788->788 / workouts 2434->2434 / trial_bookings 74->74
  profiles 73->73 / messages 82->82 / user_measurements 284->284
  weight_journey 0->0 / booking_questions 0->0

予行演習2（テーブル＋関数）
  bookings 788->788 / workouts 2434->2434
  public の関数 141->86（55本減）
  get_tenant_booked_slots は生存（83件返る）

本適用のあと
  すべて予行演習どおり。ゲーム系テーブルの残り 0
  テーブル 101->51 ／ 関数 141->86
```

**エージェントに反証させるより、本番で実際に落として戻すほうが強い証拠になる。**
次に戻せない作業をするときも、この形（DROP → 数える → ROLLBACK）を先にやること。

### 🔴 CASCADE を使わない

1文にまとめれば、ゲーム系どうしの外部キーはその中で解決される。
CASCADE は「何を巻き込んだか分からない」ので、この種の作業では使わない。

### 残した宿題

`profiles.game_mode_enabled` と `tenants.gamification_enabled` の**列は残してある**。
`schemaDrift.test.ts` のパーサが `DROP COLUMN` を解釈しないため、落とすならそちらが先
（列が1つ余るだけで実害は無い）。`updateGameMode`（未使用の分割代入だった）は削除済み。

### 番人

`src/test/gamificationRemoved.test.ts`（25件）。

- 消したテーブル・関数を `.from()` / `.rpc()` で呼んでいないか
  （**types.ts には Lovable が再生成するまで型が残るので、TS は通ってしまう**）
- 実機能（`booking_questions` / `weight_journey` / `user_measurements`）が
  削除の一覧に入っていないか
- `clientDetail.expiry`（契約の有効期限）が5言語とも残っているか
- マイグレーションが CASCADE を使っていないか

⚠️ 変異検証で**この番人自身の穴が見つかった**。`DROP TABLE` の一覧を
カンマで割っただけだと、末尾に `CASCADE` が付いた項目が
`"booking_questions CASCADE"` になり、「実機能が混ざっていないか」の検査を
すり抜けた。空白で切って先頭だけ取るように直してある。

- コード約2,100行（`avatarSystem` / `avatarRewards` / `titleSystem` / `missionSystem` /
  `missionRewards` / `raidUtils` / `rankPerks` / `useAvatar` / `useSeasonEvents` /
  `BadgeIcon` / `SessionExpSummaryDialog` / `MilestoneAchievedDialog`）
- `payments-webhook` のコイン加算（`coin_purchases` は**0件**、購入UIも無い）
- `WorkoutShareModal` の `featured_badges` 参照（該当0人）
- `profiles.game_mode_enabled` 列と `updateGameMode`
- DBのテーブル50個と関数39本

🔴 **ここから戻せない。** 第1段のあとしばらく様子を見てから進めること。

### 影響しないと確認済み（紛らわしいので記録）

- `notify_booking_created` が `quest` に引っかかるのは **`http_re**quest**_id`** の部分一致。予約通知は無関係
- `handle_new_user_avatar` は**関数だけ残っていてトリガーが付いていない**。新規登録に影響しない
- `delete_my_account` / `delete_my_gym` はゲーム系テーブルを**1つも参照していない**
