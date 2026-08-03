# 予約の締切（tenants.booking_cutoff_type / booking_cutoff_hours）

## 2026-08-03 まで、この設定は**一度も読まれていなかった**

オンボーディングの step2 で店に「いつまで予約を受けるか」を聞いて保存していたのに、
予約ロジックが `booking_cutoff_type` / `booking_cutoff_hours` を一度も参照していなかった。

締切の判定は3画面に**同じコードが複製**されていて、中身は全部これだった:

```ts
const bookingDayStart = new Date(`${date}T00:00:00+09:00`).getTime();
return Date.now() >= bookingDayStart;   // = 当日以降は問答無用で締切
```

つまり **どの店も当日予約を一切受けられなかった。**
店が「2時間前まで」と答えていても無視されていた。

**気づけなかった理由**: 列は存在し、保存も成功し、型もテストもビルドも全部通る。
「設定したのに効かない」は例外もログも出さない。実際に当日予約を試すまで分からない。

## 仕様

| `booking_cutoff_type` | 意味 |
|---|---|
| `prev_day`（既定） | 予約日の 0:00 JST を過ぎたら、その日は全部締切 |
| `hours_before` | **枠の開始時刻**の `booking_cutoff_hours` 時間前を過ぎたら、その枠だけ締切 |

`hours_before` かつ `hours = 0` は「開始時刻まで受け付ける」（オンボーディングの「制限なし」）。

**`hours_before` は枠ごとに効く。** 9:00 時点で「2時間前締切」なら、
10:00 の枠は締切済みだが 18:00 の枠はまだ取れる。**日単位ではない**のがポイントで、
ここを日単位に戻すと元のバグが再発する。

### 値が読めないときは `prev_day` に倒す

列が無い環境・未ログイン・読み込み中では `prev_day` 扱いになる。
**これは 2026-08-03 以前の挙動と完全に一致する**ので、既存の店の挙動は変わらない
（`tenantColumns.ts` が capacity を 1 にフォールバックさせるのと同じ考え方）。

## 実装

- **ロジック**: `src/lib/bookingCutoff.ts`
  - `isSlotPastCutoff(dateKey, time, cutoff)` … 枠ごと。予約可否の本体
  - `isDayPastCutoff(dateKey, cutoff, now, dayEndMinutes)` … カレンダーの日付を落とす用。
    最終枠が締切を過ぎて初めて日全体を閉じる。最終枠が不明なら 24:00 とみなして**日を残す側**に倒す
    （個々の枠は `isSlotPastCutoff` が落とすので、予約が通ってしまうことは無い）
- **画面**: `CustomerBooking.tsx` / `TrialBooking.tsx` / `DropInBooking.tsx`
- **公開ページ用 RPC**: `get_tenant_public` に2列を追加
  （`supabase/migrations/20260803000000_booking_cutoff_and_capacity_prompt.sql`）。
  **これを適用するまで、未ログインの体験予約・ドロップインだけ `prev_day` 固定のまま**（安全側）

## 落とし穴

- **DB 側に締切の強制は無い。** これは事前チェックのUXでしかなく、
  ここを通り抜けた予約は成立する。二重予約を実際に防いでいる
  `check_booking_overlap` トリガーとは別物
- **日単位に戻さないこと。** `isSlotPastCutoff` に定数や `"00:00"` を渡すと
  `hours_before` が死に、元のバグに戻る。
  `src/test/bookingCutoffWiring.test.ts` が枠生成ループの呼び出しを直接見張っている
  （ファイル内に1つでも該当があればOK、という緩い検査では
  `handleBook` 側の呼び出しに当たってすり抜けた。実際に一度すり抜けさせた）

## 回帰テスト

| ファイル | 見張るもの |
|---|---|
| `src/test/bookingCutoff.test.ts` | ロジック（19件）。境界・既定へのフォールバック・壊れた値 |
| `src/test/bookingCutoffWiring.test.ts` | **配線**。3画面が実際に設定を読んでいるか、ベタ書きが復活していないか |

「設定はあるのに誰も読んでいない」は型では防げないので、**配線そのものをテストで見張る**。
