# プリセット: ピラティス（ピラボード）

| | |
|---|---|
| リポジトリ | `kmunemoto/active-app-studio` |
| Lovable | `c841c1c0-7dfa-4dde-845e-4373b2221824` |
| 公開URL | https://active-app-studio.lovable.app |
| Supabase | 独自 `tlfyobddatpidykkmpci`（GymBoard とは別プロジェクト） |

想定業種はパーソナルピラティススタジオ（リフォーマー・マット）。

## ⚠️ このアプリだけ事情が違う: フォーク機構が生まれる前に分岐した

2026-05-31 に GymBoard から remix。**Phase 0（`brand.ts` / `vertical.ja.json` /
業種フラグ）が実装される前**に分岐したフォークなので、業種フォーク機構を
一切持たない。上流と共通の祖先も無い（セッコツボード型。
`git merge --allow-unrelated-histories` が必要）。

2026-08-01 時点の棚卸し（`kmunemoto/active-app-studio` の監査より）:

- PR #25 まで独自に進んでいる（上流は #224）。223コミット、117コミットは remix 直後の
  初期履歴に含まれる gpt-engineer-app[bot] のもの
- `src/` のファイル差分: 上流のみ58ファイル・ピラボードのみ15ファイル・
  同名ファイルの137が中身も相違
- テスト数: 19（ピラボード）対 48（上流）
- **`git log --oneline | tail -1` は shallow clone だと嘘の最初のコミットを返す。**
  `git fetch --unshallow` してから確認すること
  （`mem/ops/vertical-fork.md` の診断コマンドに追記済み）

### すでに独自にカスタマイズしている（merge で潰さないこと）

`src/lib/featureFlags.ts` は5フラグのみ（上流にある19フラグの大半が無い）:

```
STREAK_ENABLED = false          ← 意図的な変更（上流は true）
MONTHLY_REPORT_ENABLED = false  ← 意図的な変更（上流は true）
BILLING_ENABLED = true          ← コメントが "PilaBoard SaaS課金の…" に書き換え済み
SOCIAL_LOGIN_ENABLED = false    ← 上流の既定値と同じ（実質差分なし）
WAITLIST_ENABLED = true         ← 上流の既定値と同じ（実質差分なし）
```

`WORKOUT_LOG_ENABLED` 等の業種フラグ群は存在しない（Phase 0-B より前のため）。
merge 時は「上流にしか無いフラグを追加する」形になり、既存5フラグの値は
**上書きせず維持する**こと。

`src/locales/ja.json` はロケール自体は上流と88%バイト一致（264キー中232キー）だが、
21キーがピラティス向けに追加され、11キーが値だけ書き換わっている（詳細は
`kmunemoto/active-app-studio` 側の監査結果を参照）。**ジム→スタジオの言い換えは
`subscriptionBlock.customerBody` 等の一部にしか及んでおらず、
`home.training`・`booking.noPlanHelp`・`charts.trainingWeight` などにジム向け語彙が
17件残っている（未完了の途中状態）**。トレーナー→インストラクターの言い換えは
未着手。

**さらに、トレーニング記録の入力フォーム自体を Pilates 機材向けに作り替えている**
（`training.editSpring`＝スプリング設定、`training.equipmentReformer`／
`equipmentMat`＝機材選択、`training.editHold`＝キープ秒数、
`training.springPlaceholder`＝「例: 赤2＋青1」というスプリング色×本数の自由記述）。
**これは i18n オーバーレイの範囲を超えた、フォーム自体（入力欄の型・選択肢）の
コンポーネント改修**。下記のオーバーレイは語彙の言い換えに留めており、
このスプリング記法のUIそのものは再現していない（別途コンポーネント側の
移植が必要。詳細は「まだ決まっていない値」参照）。

## 語彙の方針（`pilates.vertical.ja.json`）

| 上流（ジム） | このプリセット | 理由 |
|---|---|---|
| ジム | **スタジオ** | ピラボード自身が既に一部で使っている表記（`subscriptionBlock.customerBody`）を全体に広げた |
| ジムオーナー | **スタジオオーナー** | 同上 |
| トレーナー | **インストラクター** | Pilates業界の呼称に合わせる。ピラボード自身はまだ未着手だったので、このプリセットで初めて統一する |
| トレーニング（`home.training` 等の全般ラベル） | **レッスン** | セッション単位の呼び方 |
| トレーニング（`training.*` の記録画面内） | **エクササイズ** | 個々の種目を指す文脈。ピラボード自身の `training.equipmentReformer` 等の粒度に合わせる |
| 来店 | **来店**（変えない） | スタジオでも自然に使える |

86項目（`personal-stretch` の72項目・`sekkotsu` の相当分より少し多い）。

### 姿勢分析はこの業種でも中核機能。内容を全面的に書き直した

ピラティスはアライメント（姿勢の整列）指導が本質なので、`POSTURE_ENABLED` を
落とす理由が無い。骨格タイプ別の推奨内容を、上流の筋トレ種目
（プランク・ラットプルダウン・スクワット）から**リフォーマー／マットの
ピラティス種目**（フットワーク・ハンドレッド・スパインツイスト・
ペルビックカール等）に差し替えた。`postureExercises`（猫背・ストレートネック・
骨盤の傾き）も同様に差し替え、**`area` の文字列は上流と同一のまま**にしてある
（`TrainingRecommendationCard.tsx` が日本語リテラルをキーに引いているため。
`src/test/verticalPresets.test.ts` が自動検査する）。

### 自動置換では意味が壊れる箇所は手で書き直した

- `auth.appTagline` … 上流「パーソナルジム・ピラティス予約管理」の素直な置換だと
  「ピラティススタジオ・ピラティス予約管理」になってしまうので
  「ピラティススタジオ予約管理」にした
- `booking.shareText` … `{{gym}}トレーニング` → `{{gym}}レッスン`
- `onboarding.gymNamePlaceholder` … 上流「パーソナルジム○○」の直訳（機械的な
  「ピラティススタジオ○○」）ではなく「○○ピラティス」という実際の屋号らしい形にした
- `onboarding.businessPersonalGym`（業種選択リストの1項目「パーソナルジム」）は
  **あえて上書きしなかった**。オンボーディングの業種ピッカーがピラボードで
  実際にどう使われているか（全業種を選べるままにしているのか、ピラティス固定に
  改修済みなのか）が棚卸しから分からなかったため。ピラボード側で確認してから
  決めること（「まだ決まっていない値」参照）

## `src/lib/featureFlags.ts`（新規5フラグ・Phase 0-B/#221 で追加された分）

既存5フラグ（`STREAK_ENABLED` 等）はピラボード側の値をそのまま維持。
以下は Phase 0-B・#221 で upstream に増えた分の新規判断。

| フラグ | 値 | 理由 |
|---|---|---|
| `WORKOUT_LOG_ENABLED` | `true` | ピラボードが既にこの画面を機材向けに作り替えている実績があるので、素直にONで継続 |
| `POSTURE_ENABLED` | `true` | この業種の中核機能（上記） |
| `SKELETAL_DIAGNOSIS_ENABLED` | `true` | フィットネス文脈の体型分類で医療隣接業種ではない |
| `MUSCLE_RADAR_ENABLED` | `true` | `WORKOUT_LOG_ENABLED` がONなのでデータ源がある |
| `WORKOUT_SHARE_ENABLED` | `true` | レッスン内容のシェアは集客導線として自然 |
| `BODY_METRICS_ENABLED` | `true` | ボディメイク目的で通う会員も一定数いる業態のため。不要ならスタジオごとにOFFの検討余地あり |
| `MEALS_ENABLED` | `false` | 食事指導を売りにしないスタジオが大半という想定。栄養指導も行う場合は個別に見直す |
| `GOOGLE_REVIEW_ENABLED` | `true` | 柔道整復師法のような広告規制の対象業種ではない |
| `LANGUAGE_SWITCHER_ENABLED` | `false` | `ja.json` が上流とバイト一致でない（21項目追加・11項目変更）ため、他言語に切り替えるとジム向け語彙のまま出る箇所が生まれる。上流取り込み・オーバーレイ移行が終わるまでは日本語固定にする |
| `TRIAL_BOOKING_ENABLED` | `false` | 体験予約はジム特有の集客手法。ジムボード以外の兄弟アプリは全て無くす方針（2026-08-02決定）。false でも `trial_bookings` のデータ・Edge Functionは削除しない。既存の `trialBooking`/`trialCancel` オーバーレイキー（`pilates.vertical.ja.json`）は不可用時の案内文以外は出なくなるが、害はないのでそのまま残してよい。**OFFでも公開ページは残り「現在受け付けていません」の案内が実際にお客様の目に触れるので、`trialBooking.notAvailableTitle`／`notAvailableBody` をオーバーレイで差し替えること**（既定文は「ジムまでお問い合わせください」） |


> **トレーナー側**: 上記の顧客側フラグは `TrainerClientDetail`（カルテの記録/食事タブ・体重パネル・レーダー）と `CustomerMonthlyReport`（体重・記録・食事セクション）にも同じ値が効く。フォークでお客様側だけ OFF にしたとき、トレーナー画面が上流のまま残らない。

## `src/lib/brand.ts`（新規作成）

監査で判明済みの値。未確認のものは「まだ決まっていない値」に残す。

| 定数 | 値 | 根拠 |
|---|---|---|
| `BRAND.ja` | `ピラボード` | Lovable プロジェクト名・想定アプリ名より |
| `BRAND.en` | `PilaBoard` | `featureFlags.ts` の `BILLING_ENABLED` コメント「PilaBoard SaaS課金の…」より確認済み |
| `BRAND.app` | `pilaboard` | `capacitor.config.ts` の `appId`＝`app.pilaboard.mobile` より確認済み |
| `NATIVE_APP_SCHEME` | `app.pilaboard.mobile:` | `capacitor.config.ts` の `appId` と `nativeBridge.ts` のスキームが一致していることを監査で確認済み |
| `PRODUCTION_WEB_ORIGIN` | `https://active-app-studio.lovable.app` | 公開URL（本表冒頭）。独自ドメインへ切り替えたら要更新 |
| `BRAND_FALLBACK_GYM_NAME` | `BRAND.ja` | 他プリセットと同じ方針 |
| `POWERED_BY_LABEL` | `` `Powered by ${BRAND.en}` `` | 他プリセットと同じ方針 |
| `SUPPORT_EMAIL` | `k.munemoto@kyoto-salute.com` | ピラボード側セッションが確認（`Privacy.tsx` 等4ファイルで既に使われている実装値。2026-08-02） |

## `STRIPE_LIVE_HOSTS` は対応不要と判明（当初「地雷2」として警告していたが撤回）

ピラボードは `src/lib/gymboardPlans.ts` に**上流の `STRIPE_LIVE_HOSTS` とは別の独自実装
（`LIVE_HOSTNAMES`）を持っており**、`active-app-studio.lovable.app` は既にそこに登録済み
（ピラボード側セッションが確認・2026-08-02）。監査時点では上流の仕組みが無いことしか
見えておらず「未設定＝リスク」と判断していたが誤りだった。**merge 時は、上流の
`STRIPE_LIVE_HOSTS` 方式とピラボード独自の `LIVE_HOSTNAMES` 方式のどちらに統一するかを
決める作業になる**（値の穴埋めではなく、実装の突き合わせ）。

## まだ決まっていない値（出荷前・merge後に埋める）

- [ ] **DBスキーマの追従（merge完了の必須条件・2026-08-02 追加）** — 上流の
      migration ファイル自体は取り込まない方針で正しいが、merge したフロントは
      `get_tenant_booked_slots`（お客様の予約画面の中核RPC）・`booking_waitlist`・
      `tenant_muscle_groups`・`tenants.booking_capacity` など14個以上のDBオブジェクトを
      実行時に参照する。**適用しないと予約画面が動かない。**
      上流の `types.ts` を仕様書に、追従 migration を1本手で書くこと
      （詳細は `mem/ops/vertical-fork.md` の「supabase/migrations/ は取り込まない。
      ただしスキーマ追従は必須」）
- [ ] スプリング記法の入力フォーム — 語彙オーバーレイでは再現できない
      コンポーネント改修。ピラボード側の既存実装（`training.editSpring` 等）を
      upstream の最新版の記録フォームに移植し直す必要がある
- [ ] `onboarding` の業種ピッカーの扱い（ピラティス固定にするか、選択式のまま残すか）
- [ ] `capacitor.config.ts` に `PushNotifications` プラグイン設定ブロックが無い
      （上流にはある）。iOS のプッシュ通知が正しく初期化されない可能性がある
- [ ] `STRIPE_LIVE_HOSTS` 方式と `LIVE_HOSTNAMES`（ピラボード独自実装）方式の統一（上記参照）
- [ ] Firebase / プロビジョニングプロファイル / アイコン・スプラッシュ
- [ ] 法務3ページの事業者情報
- [ ] Supabase の Additional Redirect URLs に
      `app.pilaboard.mobile://auth/callback` の登録状況を確認
      （`appId` 自体は既に `app.pilaboard.mobile` で正しい）

## 済んでいること（棚卸しで確認済み）

- `capacitor.config.ts` の `appId` = `app.pilaboard.mobile`、`nativeBridge.ts` の
  スキームとも一致（上流の「不一致でも気づけない」地雷には該当しない）
- Supabase は独自プロジェクトで完全分離。GymBoard の project ref の混入なし
- Salute の tenant UUID は現状1件のみ（マイグレーション内の空振り UPDATE 文）。
  ただし **merge すると `legacyDefaultTenant.ts` / `dropInTenant.ts` の2ファイルに
  実UUIDが流入する**ので、merge 後に `null` へ差し替えること
  （`isDropInAvailable` の null 比較は上流側で既にガード済み。
  `mem/ops/vertical-fork.md` 地雷1参照）
- `SUPPORT_EMAIL` = `k.munemoto@kyoto-salute.com`（ピラボード側セッションが確認）
- `STRIPE_LIVE_HOSTS` は対応不要と判明（独自 `LIVE_HOSTNAMES` 方式が既にある。上記参照）
- `sanitizeAuthNext`（オープンリダイレクト対策）は commit `b14934e` で
  **`AuthCallback.tsx`／`nativeBridge.ts` の該当ロジックのみ単体移植**して先行対応済み
  （2026-08-02。テスト189件・build確認済み）。**ただし本来のフルmergeの代替ではない
  応急処置**であることに注意。上流でこのロジックが入ったのは commit `574ecf7`
  （2026-07-30「認証まわりの6件の不具合をまとめて直す」）と比較的最近のため、
  フルmerge実施時に `AuthCallback.tsx`／`nativeBridge.ts` で**単体移植分と衝突する**。
  上流側の実装（より完全な形）を正として突き合わせて解消すること。

## 適用状況: 未着手（フルmergeが前提。段階的merge戦略を検討中）

2026-08-02、ピラボード側セッションが実際に差分を計測: **137ファイル中107ファイルが相違・
約22,300行**（予約・課金・テナント設定の中核ロジックを含む）。1セッションでの
一括 `--allow-unrelated-histories` mergeはリスクが高いと判断し、まず最優先の
`sanitizeAuthNext` のみ単体移植で先行対応（上記）。フルmergeは着手待ち。

上流側で該当区間を計測したところ、fork時点（2026-05-31）から現在（`main` HEAD）までに
**upstream/mainだけで418コミット（約2ヶ月分の日次開発）、`src`/`supabase` だけで
327ファイル・38,134行の差分**があった。特定のコミット境界（例: Phase 0 開始前後）で
2分割しても偏りが大きく（Phase 0 以前だけで314ファイル・36,756行）、素朴な2段階分割は
あまり効果が無いことも確認済み。**現実的な対処は、upstream/main の実コミット履歴上に
2〜3週間おきの中間チェックポイントを複数取り、各チェックポイントごとに
`git merge --allow-unrelated-histories`（1回目のみ）→ 以降は通常の `git merge` を
1回のセッションで完了・コミット・pushする**という反復。コンフリクト解消の順序は
ピラボード側の提案どおり ロケール → lib/hooks → components → pages のボトムアップが
妥当（ロケールは構造的なJSONマージで衝突が読みやすく、hooksが土台、componentsは
hooksの上に乗り、pagesは最上位の組み立てのため）。
