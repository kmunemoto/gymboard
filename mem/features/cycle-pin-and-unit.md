# 起算日の固定（店の設定が最上位）＋利用期間の単位（2026-08-22）

宗本さんの要望2件への対応（利用期間の調査の続き。自動ルールの全体像は
`mem/features/plan-session-limit.md` と courseProgress.ts のコメント）:

1. **お店側で決める利用期間（起算日）が一番上の権限を持つ**。自動ルール
   （1回目の予約日への合わせ込み・使い切りロール・1回目起点の引き直し表示）は
   残すが、店が固定した起算日をそれらが動かしてはいけない。
2. **利用期間をヶ月だけでなく週・日でも設定できる**（うちは1ヶ月だが店によって違う）。

## (1) 起算日の固定 — `profiles.cycle_start_pinned`

🔴 **明示スイッチ**（カルテの「起算日を固定（自動調整しない）」）。店が日付を手で
入れただけでは固定しない（暗黙に変えると自動ルール前提の他テナントの挙動が変わる）。
日付なしでは ON にできず、日付を消すと固定も自動解除。

固定中のお客様:

- `shouldRebaseCycleStart` → 常に false（起算日の自動書き換えなし）。
  例外: 起算日が NULL の間だけは初回設定を許す（DB直書きでしか作れない状態の保険）
- `resolveEffectiveCycle` → 使い切りロールも anchorToFirstBooking の引き直しもしない
  ＝**起算日から暦どおりに進む純粋な窓**。DB（guard_booking_plan_limit）はもともと
  純粋な暦窓なので、固定中は DB と表示が完全に一致する
- `computePlanUsage` → `periodPending` を立てない（予約0件でも期限を出す。
  期間は店の設定で確定している）。push-period-reminder も同じ（固定＋予約0件でも
  期限リマインドが飛ぶ＝正しい挙動）
- DB（GB005 追記）: 本人は `cycle_start_pinned` を変更不可。**固定中は
  `cycle_start_date` も本人変更不可**（allow_overflow=true のプランでは従来
  本人が書き換え可能だった穴を塞ぐ）。店・サービスロールは素通し（従来どおり）

## (2) 利用期間の単位 — `tenant_plans.cycle_unit`

`cycle_months` は「単位数」として使い回す（列名は歴史的なもの）。
`cycle_unit` ∈ months / weeks / days、NULL は months。

🔴 **規則は非対称（互換性のため）**:

- **months** … 応当日ベース・**応当日を含む**（従来どおり。6/5開始→7/5まで、
  翌サイクルは 7/6 から）。既存プランの窓を1日も変えないため、この規則は変更しない
- **weeks / days** … **ちょうど N×7日 / N日** の連続窓 [start, start+span)。
  翌サイクルは end 当日から（応当日の概念が無いので最終日を共有しない）

DB は `plan_cycle_window(DATE,DATE,INT,TEXT)` の4引数オーバーロードを追加
（months は3引数版へ委譲・週日は整数除算の直接計算）。3引数版はそのまま残る。
`guard_booking_plan_limit` が `tp.cycle_unit` を読んで4引数版で窓を引く。

⚠️ **公開済みの旧クライアントは cycle_unit を知らない**。週・日のプランを
「cycle_months ヶ月」として誤表示する（例: 4週 → 4ヶ月）。DB の強制（GB004）と
push-period-reminder は正しい。単位を月以外にする店には新ビルド配布後に案内する。

## 触った場所

- migration `20260822020000_cycle_pin_and_unit.sql`（列2つ・plan_cycle_window
  4引数・guard_booking_plan_limit・guard_profile_plan_fields の再定義）
- `courseProgress.ts`（CycleUnit / resolveCycleUnit / getCycleWindow ほか全経路に
  cycleUnit・pinned を配線）、`planUsage.ts`（PlanUsageInput / periodPending /
  resolvePlanUsageInput 第4引数）
- Deno 移植 `supabase/functions/_shared/cycle.ts` ＋ push-period-reminder
  （🔴 **要 Lovable 再デプロイ**。cyclePortParity.test.ts がパリティを固定）
- useBookings（rebase に pinned/cycleUnit）、useProfile / useTenant / types.ts、
  PlanUsageCard、TrainerClientDetail（固定スイッチ）、TrainerPlanManager（単位セレクタ。
  months は null で保存）、顧客/トレーナー各画面の呼び出し元、ロケール×5
- テスト: cyclePinAndUnit.test.ts（21件・配線のソース固定込み）＋
  cyclePortParity に4シナリオ追加。**変異11種すべて赤→復旧緑**
  （pinned ゲート3箇所・periodPending・週span・floor→ceil・港側3種・
  resolvePlanUsageInput の単位落とし・GB005 規則除去）

## 追補: Deno 移植の月末クランプ修正（同日・調査ワークフローが検出）

利用期間の調査ワークフロー（84エージェント・反証付き）が、`_shared/cycle.ts` の
`addMonthsEpoch` が**月末をクランプしない**既存バグを確認した（1/31+1ヶ月 →
Date.UTC の繰り上げで 3/3。クライアントの date-fns と DB の Postgres interval は
両方 2/28 へクランプ）。影響は push-period-reminder（期限リマインド）だけで、
月末起算（29〜31日）のお客様の窓がクライアント表示とずれ、繰り上がりの累積で
丸ごと1サイクルずれるケースもあった。クランプ実装に修正し、cyclePortParity に
月末4シナリオ（1/31・8/31・数サイクル後・閏年）を追加。旧実装では4本とも赤。

## ⚠️ 変異検証で `git restore` を使わない（2026-08-22 に踏んだ）

変異を戻すときに `git restore <file>` を使うと、**未コミットの実装ごと消える**
（HEAD に戻るため）。実際に courseProgress.ts の実装を丸ごと飛ばして書き直した。
変異検証は「事前に cp でバックアップ → sed で変異 → cp で復旧」で行うこと。
