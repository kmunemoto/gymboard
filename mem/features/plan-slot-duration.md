# プランごとの予約枠の間隔（tenant_plans.slot_duration_minutes）

## 概要（2026-07-30〜）
`tenants.slot_duration_minutes`（ジム全体の既定の1セッション長）はジム設定「営業時間」
セクションで変更できる（`mem/features/business-hours-settings.md` 参照）が、それだけでは
「同じジムに60分プランと30分プランを混在させる」ことができなかった（例:「月4回」と
「月4回(30分)」を別プランとして作っても、両方とも常に60分として扱われていた）。

`tenant_plans.slot_duration_minutes`（`20260730120000_tenant_plans_slot_duration.sql`）を
追加し、**プラン単位で1セッションの長さを上書きできる**ようにした。null/未設定のプランは
従来どおりジムの既定値（`tenants.slot_duration_minutes`）を継承する（`cycle_months`/
`grace_days` と同じ「null=継承」の作法）。

## どこで設定するか
トレーナー画面「プラン管理」（`TrainerPlanManager.tsx`）のプラン編集ダイアログに
「予約枠の間隔」セレクトを追加。`plan_type`（サブスク/回数券/期間）を問わず全プランで
設定可能（`cycle_months`/`grace_days` と違い、セッションの長さはサブスク固有の概念では
ないため、`showCycleMonths` 等の条件分岐に入れず常に表示）。選択肢はジム設定「営業時間」
の `BUSINESS_SLOT_OPTIONS` と同じ `[30, 45, 60, 90, 120]`（`PLAN_SLOT_OPTIONS`）。
プランカードの詳細行にも設定値を表示する。

## 解決ロジック: `resolvePlanSlotMinutes`（`src/lib/planSlotDuration.ts`）
```
resolvePlanSlotMinutes(planName, tenantPlans, tenantDefaultMinutes)
```
`tenantPlans` から `plan_name === planName` の行を探し、`slot_duration_minutes` があれば
それを、無ければ（未設定 / プランが見つからない＝削除済み・体験予約など）
`tenantDefaultMinutes` を返す。DB側（後述）も同じロジックを権威的に計算する。

## 予約の「占有時間」に反映した箇所（`booking_buffer_minutes`/`slot_duration_minutes` の
全箇所を洗い出した `business-hours-settings.md` の手順に倣い、同じ箇所を全て対応させた）

- **`check_booking_overlap` トリガー（DB・最終防衛）**: `NEW.tenant_id` + `NEW.booking_type`
  で `tenant_plans` を引き、無ければ `tenants.slot_duration_minutes`、それも無ければ60分。
  既存予約側（`bookings`/`trial_bookings`/`blocked_slots`）の重複判定も同様に
  `booking_type` ごとに解決してから比較する。**実際の二重予約を防ぐのはこのトリガーのみ**。
- **`get_tenant_booked_slots` RPC**: 同じロジックで `end_booking_date` を計算
  （`bookings` 側のみプラン別。`trial_bookings` は従来どおりジム既定値のまま——体験予約は
  `tenant_plans` に紐づかないため対象外）。
- **`useBookings.ts`**: `parseBooking` が `resolvePlanSlotMinutes(row.booking_type, ...)`
  で行ごとに解決（`useMyBookings`/`useAllBookings` が `tenantPlans`（`useTenant().plans`）を
  渡す）。`sendCancelEmailNotification` はキャンセルメールの表示時間帯用に
  `tenant_plans` を都度クエリして解決。`checkSlotBlocked` 自体は無改修
  （常に各予約の既に計算済みの `endTime` と比較するだけのため、呼び出し側が渡す
  候補の `sessionMinutes` だけがプラン別になればよい）。
- **`CustomerBooking.tsx`**: お客様は契約プランが1つ（`profile.plan`）なので、
  画面全体で使う `slotMinutes` を `resolvePlanSlotMinutes(profile?.plan, tenantPlans, ...)`
  に置き換えるだけで、枠グリッド・重複チェック・予約確定・確認表示の全てに伝播する。
- **`TrainerSchedule.tsx`**: 代理予約の候補プラン（`proxyBookingType`）用に
  `proxySessionMinutes` を別で持つ。トレーナーの手動「枠をブロックする」フローは
  プランと無関係なので、そちらは従来どおりジム既定値（`sessionMinutes`）のまま。
- **`TrainerClientDetail.tsx`**: 予約履歴の各行を `row.booking_type` ごとに
  `resolvePlanSlotMinutes` で解決（お客様のプランが履歴の途中で変わっていても、
  各予約時点のプラン名で正しい終了時刻を出せる）。
- **`calendar-feed` Edge Function**（個人のiCal購読リンク）: `tenant_id` と `booking_type`
  の組でプラン別に解決してDTENDを計算。
- **`google-calendar-sync` Edge Function**: `create`/`sync_all` 両方とも `booking_type`
  でプラン別に解決。体験予約（`trial_bookings`）は対象外（ジム既定値のまま）。

## 対象外（意図的にプラン非依存のまま）
- `DropInBooking.tsx` / `TrialBooking.tsx`: ドロップイン・体験予約は固定種別で
  `tenant_plans` に紐づかないため、ジムの既定値のまま。
- `Onboarding.tsx`: 初期設定はジム全体の既定値のみを扱う画面のため対象外。
- `TrainerUtilizationHeatmap.tsx`: `slot_duration_minutes` はコメント上の言及のみで
  実コードでは未使用。

## 落とし穴
- `bookings.booking_type` は**プラン名の自由入力文字列**であり `tenant_plans` への
  外部キーではない（予約作成時点の `selectedPlan`/`proxyBookingType` をそのまま保存）。
  そのためプラン名を変更（リネーム）すると、過去の予約行は新しいプラン設定を拾えず
  ジムの既定値にフォールバックする（`cycle_months`/`grace_days` と同じ既知の制約）。
- プラン削除後や体験予約（`booking_type` が `tenant_plans` に存在しない）は、常に
  ジムの既定値にフォールバックする（DB・クライアント双方で同じ優先順位）。
- 新しく「予約の占有時間」に関わる機能を書くときは、`tenants.slot_duration_minutes` を
  そのまま使わず、必ず `resolvePlanSlotMinutes`（クライアント）/ 同等のプラン別解決
  （DB・Edge Function）を経由すること。

## 適用状況
`20260730120000_tenant_plans_slot_duration.sql` は **2026-08-01 に本番DBへ適用済み**
（Lovable MCP 経由）。types.ts にも `tenant_plans.slot_duration_minutes` を反映し、
`KNOWN_STALE` のエントリと、型を迂回するために入れていたキャスト
（`TrainerPlanManager.tsx` / `useTenant.ts` / `useBookings.ts`）も外した。
`useBookings.ts` の `sendCancelEmailNotification` は型が効くようになったので
`select("*")` を `select("slot_duration_minutes")` に戻してある。

Edge Function（`google-calendar-sync` / `calendar-feed`）は Deno 側で types.ts を
使わないため、こちらのキャストは types.ts とは無関係にそのまま。

手順は `mem/ops/schema-drift.md` の「types.ts の追従」を参照。
