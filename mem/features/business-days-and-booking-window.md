# 曜日別の営業時間・定休日 と 受付開始時期（2026-08-20）

エアリザーブ（リクルート）の店側機能をジムボードと突き合わせた結果、
**いちばん実害が大きかった2件**。どちらも「予約を受ける範囲」の設定で、
設定画面でも隣り合って出る。

---

## 1. 曜日別の営業時間・定休日

### 何が無かったか

`tenants.operating_hours` は **全曜日共通の開始・終了1組だけ**で、定休日の概念が無かった。

- 「土日は短縮」「水曜定休」が表現できない
- 休みは**手でブロック枠を置く**しかない（毎週やる必要がある）

### 🔴 列は増やしていない

`operating_hours` は既に jsonb なので、**中身に `days` を足しただけ**。

```jsonc
{
  "start": "09:00",          // ← 開いている曜日を通した「いちばん早い開店」
  "end":   "23:00",          // ← 開いている曜日を通した「いちばん遅い閉店」
  "days": {
    "0": null,                                  // 日曜=定休日
    "1": { "start": "10:00", "end": "21:00" },  // 月曜
    "6": { "start": "09:00", "end": "23:00" }   // 土曜
  }
}
```

| `days` の状態 | 解釈 |
|---|---|
| キーが無い／`days` 自体が無い | `start`/`end` を使う（＝**従来どおり**） |
| キーがあって値が `null` | **定休日** |
| キーがあって時刻が壊れている・逆転している | `start`/`end` に倒す（**定休日にはしない**） |

最後の行が重要。設定ミスで店が丸ごと予約不能になるほうが実害が大きいので、
壊れた値は「閉める」ではなく「広いほうへ」倒す。

### 🔴🔴 `start`/`end` には必ず「包絡線」を書く

**これがこの機能でいちばん壊れやすい点。**

ネイティブアプリなので、`days` を知らない版が端末に**何ヶ月も残る**。
その版は `start`/`end` しか読まない。だから保存時に、
`start`/`end` には**開いている曜日全体を包む最小の範囲**を入れる
（`envelopeFromDays()`）。

- 包絡線を入れる → 古い版では「広めに出る」だけ。取れる枠は減らない
- 月曜の時間だけを入れる → **土曜に取れるはずの枠が古い版から消える**

`src/test/businessDays.test.ts` の「設定画面が包絡線を書いている」がこれを見張る。

副次的な利点として、`get_tenant_public` は `operating_hours` を jsonb 丸ごと返すので、
**公開ページ用のマイグレーションが要らない**（列を増やしていないため）。

### 🔴 曜日は JST の暦日で決める

```ts
// ✗ CI(UTC) と端末(JST) で答えが変わる
new Date(`${dateKey}T00:00:00+09:00`).getDay()

// ✓ 数字をそのまま UTC に置いて読む（タイムゾーン非依存）
new Date(Date.UTC(y, mo - 1, d)).getUTCDay()
```

日付キー（`"yyyy-MM-dd"`）は既に「JSTの暦日」であってタイムゾーンを持たない。
`getDay()` を使うと「CIは緑なのに実機で定休日が1日ずれる」になる。
`businessDays.test.ts` は `process.env.TZ` を4つ切り替えて同じ答えになることを見る。

### 曜日を渡す場所・渡さない場所

| 場所 | 曜日 | なぜ |
|---|---|---|
| お客様の予約・体験・ドロップイン・代理予約の枠 | **渡す** | 日付が1つに決まっている |
| 週表示の行（`timeSlots`） | 渡さない | 7日ぶんを1枚に描くので、狭めると他の曜日が描けない |
| 週タイムラインの時間軸 | 渡さない | 同上。行の高さが曜日ごとに変わると読めない |
| ブロック枠の開始・終了 | 渡さない | **定休日にも置けるようにする**（棚卸し・研修の予定を書きたい） |
| 稼働率ヒートマップの軸 | 渡さない | 曜日×時間の表なので軸は包絡線。定休日の**セルだけ**空欄にする |

---

## 2. 受付開始時期（`tenants.booking_window_days`）

### 何が無かったか

締切（`booking_cutoff_type` / `booking_cutoff_hours`）は「**手前**の締め」しか決められない。
その対になる「**先**の上限」は設定がどこにも無く、**画面ごとに違う数字が直書き**されていた。

| 画面 | 直書き | 実際の上限 |
|---|---|---|
| お客様の予約 | `addMonths(today, 1)` | 1ヶ月先 |
| 体験予約 | `TRIAL_BOOKING_MAX_DAYS_AHEAD = 10` | 10日先 |
| ドロップイン | `DROP_IN_BOOKING_MAX_DAYS_AHEAD = 10` | 10日先 |
| 予約を追加（店側） | 無し | **無制限** |

### 🔴 NULL は「未設定」＝画面ごとの従来の上限

列を足しただけで既存店の見え方が変わってはいけないので、既定値をこのライブラリが
1つ持つのではなく、**呼び出し側が「自分の従来の既定」を `fallback` として渡す**。

```ts
// お客様の予約
bookingWindowEnd(tenant?.booking_window_days, { months: LEGACY_MEMBER_WINDOW_MONTHS })
// 公開ページ
isBeyondBookingWindow(dateKey, tenant?.booking_window_days ?? null, { days: LEGACY_GUEST_WINDOW_DAYS })
```

数字は `src/lib/bookingWindow.ts` の `LEGACY_*` に集めてあるので、直書きは残っていない。

### 🔴 0 は「当日のみ」ではなく未設定

`0` を「当日しか取れない」と解釈すると、**設定ミス1つで店の予約が全部止まる**。
`normalizeBookingWindowDays()` が 0・負・範囲外（1〜365 の外）を `null` に倒す。
止めたいなら定休日か締切で止めるのが筋。

### 🔴 比較は日付キーの文字列で行う

`getJSTNow()` が返すのは「ローカルのゲッターが JST の壁時計を返す」**プロキシ**で、
`.getTime()` は実時刻ではない（`src/lib/timezone.ts` の IMPORTANT）。
ここで実時刻同士の引き算をすると端末のタイムゾーン次第で1日ズレる。
`"yyyy-MM-dd"` は辞書順＝時系列順なので、文字列比較で足りる。

定期予約の上限（`maxRepeatWeeksFor`）にも同じ範囲を渡している。
渡し忘れると4回目だけ範囲外に作られる。

### 店側の代理予約には**かけていない**（意図的）

「何日先まで受け付けるか」は**お客様に向けた受付の制限**であって、
店が自分で入れる予約の制限ではない。
「会員から電話で3ヶ月先を押さえたい」と言われたら店は入れられるべきなので、
`TrainerSchedule` の代理予約カレンダーは**従来どおり無制限**のままにしてある
（定休日とスタッフのシフトは、実際に営業していない・出勤していないので塞ぐ）。

見落としではないので、後から「代理予約にも効かせ忘れている」と直さないこと。

---

## 触った場所

| ファイル | 役割 |
|---|---|
| `src/lib/businessHours.ts` | 営業時間の唯一の解釈者。曜日解決・包絡線・曜日算出 |
| `src/lib/bookingWindow.ts` | 受付の先の上限の唯一の解釈者 |
| `src/components/trainer/TrainerGymSettings.tsx` | 曜日別トグル・定休日・受付日数の設定UI |
| `CustomerBooking / TrialBooking / DropInBooking / TrainerSchedule` | 枠生成・カレンダーの選択可否 |
| `TrainerUtilizationHeatmap` | 自前の `parseHour` を廃止し lib に寄せた。定休日は空欄 |
| `supabase/migrations/20260820010000_*.sql` | `booking_window_days` ＋ `get_tenant_public` 作り直し |

## テスト

- `src/test/businessDays.test.ts`（24件）… 後方互換・包絡線・曜日のTZ非依存・配線
- `src/test/bookingWindow.test.ts`（20件）… 未設定時の従来値・境界・直書きが戻っていないこと

変異検証は 2026-08-20 に 11件（businessDays 6 / bookingWindow 5）実施し、
**すべて赤になることを確認**した。詳細は各テストファイル冒頭のコメント。

## ⚠️ types.ts のテストで `| null` を固定しない（2026-08-20 に踏んだ）

`bookingWindow.test.ts` に

```ts
expect(block).toMatch(/booking_window_days: number \| null/);
```

と書いたら、**Lovable が本番DBから types.ts を再生成した直後に CI が落ちた**。
生成器は `RETURNS TABLE` の列に nullability を付けない
（既存の `address: string` / `trial_price_yen: number` も同じく非 null）。
手で書いた形を固定すると、再生成のたびに落ちる。

**列の有無だけを見ること。** 実際の NULL 可能性は公開ページ側の
`PublicTenant` が `| null` で受けているので、そちらで守られている。

## 本番適用（2026-08-20）

適用済み。3段構えで検証:
1. 読み取りで適用前の状態を確認（列・表・関数がまだ無いこと）
2. 実行
3. **anon を演じて** `get_tenant_public` が `operating_hours` と
   `booking_window_days` を返すことを実際に確認

適用後、**全テナントで `booking_window_days IS NULL` / `operating_hours ? 'days'` が 0件**。
つまり**どの店の挙動も変わっていない**（設定した店だけが新しい挙動になる）。
