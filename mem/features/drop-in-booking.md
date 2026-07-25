# ドロップイン予約（¥8,000・単発）

Salute御所南 が訪日観光客向けに始めた単発セッションの予約ページ。`/drop-in/:tenantId`。

## 提供しているのは1ジムだけ（2026-07 に明示的な制限を追加）

**この機能は他のジムには提供していない。** 以下がすべて固定値で、ジムごとに変える仕組みが
無いため:

- 料金 ¥8,000
- 画面が英語のみ（訪日観光客向けという前提）
- 現地決済（オンライン決済の導線が無い）

そのため、提供ジム以外のIDで `/drop-in/:tenantId` を開いても予約できないようにしてある。

| 層 | 実装 |
|---|---|
| 画面 | `src/lib/dropInTenant.ts` の `isDropInAvailable()`。対象外なら「Drop-in booking is not available」を表示 |
| サーバー | `supabase/functions/drop-in-book/index.ts` で `tenantId` を検査し `not_available` で拒否 |

**両方に入れているのは、画面を経由せず直接APIを叩ける経路があるため。**
画面側だけだと、URLを知っていれば他ジムのテナントIDで予約を作れてしまう。

## 他のジムにも提供するときは

`tenants` に「ドロップインの提供有無」「料金」「通貨」の列を足し、
`DROP_IN_TENANT_ID` による判定をその設定の参照に置き換える。
画面の英語固定も、i18n に載せ替える必要がある。

## 体験予約との関係

同じ `trial_bookings` テーブルを共有し、`booking_kind` で区別する
（`trial` = 無料体験、`drop_in` = ドロップイン）。
枠の重複判定や空き枠計算を体験予約・会員予約と共通化するための設計。

`booking_kind` は 2026-07-25 まで本番DBに未適用で、**ドロップイン予約が作成不能だった**
（詳細: `mem/ops/schema-drift.md`）。

## 関連

- `src/pages/DropInBooking.tsx` — 画面（英語のみ、意図的に i18next を使っていない）
- `supabase/functions/drop-in-book/index.ts` — 予約作成API（`trial-book` の複製）
- `src/lib/dropInTenant.ts` — 提供ジムの定義
