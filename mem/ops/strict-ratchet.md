# 品質のラチェット（2026-08-26）

ロードマップのフェーズ1-⑧「品質負債」。

## 何をしたか（と、していないか）

| したこと | していないこと |
|---|---|
| `src/lib` だけ strict で CI に通す | 全体を strict にする |
| これ以上巨大にしないための上限を固定 | 1945行のカルテを分割する |
| `as any` の件数を上限で止める | 既存の `as any` を減らす |
| lib → components/hooks の依存を禁止 | 依存の向きを全部整理する |

**一気に良くするのは無理でも、悪くなるのは止められる。**
数を上限として固定し、増えたら CI を赤にする。減らしたら上限も下げる（それがラチェット）。

🔴 上限を上げて通すのは最後の手段。上げるときは PR に理由を書くこと。
   ここを何度も上げるなら、それは「返済していない」という記録になる。

## 1. strict は `src/lib` から

`tsconfig.strict.json`（`tsconfig.app.json` を継承し、`strict` /
`noImplicitAny` / `strictNullChecks` を足す）。対象は `src/lib/**/*.ts` だけ。

```bash
npm run typecheck:strict     # tsc --noEmit -p tsconfig.strict.json
```

CI では `Type check (strict, src/lib)` として `npm test` の前に回る。

なぜ lib から:
- 純粋なロジックが集まっていて、null の取り違えがそのまま計算の誤りになる
  （回数の消化、休眠判定、料金）
- 画面と違って JSX が無く、直すのが安全
- **全体を strict にすると数百件**出て、一度には直せない

### 🔴 やってみて分かったこと: 層の向きが逆だと、このゲートは意味を失う

最初に入れたときエラーが13件出た。中身は**画面のエラー**で、`src/lib` の
コードではなかった。原因は lib が上の層を import していたこと:

```
src/lib/gymDisplaySettings.ts → @/hooks/useTenant       （型 Tenant）
                              → @/components/trainer/TrainerView （型 TrainerTab）
src/lib/subscriptionStatus.ts → @/hooks/useTenant       （型 Tenant）
src/lib/messageQuote.ts       → @/hooks/useBookings     （SAME_DAY_FORFEIT_STATUS）
src/lib/missionRewards.ts     → @/hooks/useBookings
src/lib/dormancy.ts           → @/hooks/useProfile      （型 ProfileWithBooking）
```

**型だけの import でも同じ。** tsc はその先のファイルを読むので、
lib を検査するだけでコンポーネントの木まで引きずり込まれ、
無関係な画面のエラーで赤くなる。

直し方は「型・定数を下（lib）へ降ろし、元の場所は再エクスポートにする」:

| 移した先（新規） | 元の場所（再エクスポートを残した） |
|---|---|
| `src/lib/tenantTypes.ts` | `src/hooks/useTenant.ts` |
| `src/lib/trainerTabs.ts` | `src/components/trainer/TrainerView.tsx` |
| `src/lib/bookingStatus.ts` | `src/hooks/useBookings.ts` |

`dormancy.ts` だけは移さず、要る3列（`last_visit_date` / `created_at` /
`next_booking_date`）を `DormancyInput` としてその場で宣言した。
`ProfileWithBooking` はこの形を満たすので、呼び出し側は無改修。

再エクスポートを残したのは、**呼び出し側を1つも直さないため**。
`import { SAME_DAY_FORFEIT_STATUS } from "@/hooks/useBookings"` は今も動く。

この向きは `src/test/qualityRatchet.test.ts` が見張っている。

### strict で実際に出た型の問題（`courseProgress.ts`）

TS7022（循環参照で推論できず暗黙の any）が出た:

```
window → target → next → windowEnd → window
```

`let window` に型注釈が無いと、ループの中で `window` から推論した値を
また `window` に代入するため、TS が推論を打ち切る。明示的に書いて切った。

```ts
let window: CycleWindow | null = getCycleWindow(...);
...
const windowEnd: Date = window.end;              // クロージャの中で let は narrowing されない
const next: Date | undefined = activeDates.find((d) => d >= windowEnd);
const target: Date = next && next < refDay ? next : refDay;
```

**挙動は変えていない。** `courseProgress` / `planUsage` / `cyclePinAndUnit` /
`dormancy` の4本（92件）が変更前後で同じく緑なのを確認した。

## 2. ラチェットの見張り（`src/test/qualityRatchet.test.ts`）

| 見張っているもの | 上限（2026-08-26 の実測） |
|---|---|
| `src` 配下の `as any` | 128件 |
| 新しく900行を超えるファイル | 0件（既知の5本は除外） |
| 既知の巨大ファイルがさらに膨らむ | 各ファイルに個別の上限 |
| lib が components / hooks / pages を import | 0件 |
| strict のゲートが外されていないか | 設定と CI の両方を確認 |

既知の巨大ファイルと上限（現在の行数＋余裕50行）:

| ファイル | 上限 |
|---|---|
| `TrainerClientDetail.tsx` | 2000 |
| `TrainerGymSettings.tsx` | 1600 |
| `CustomerBooking.tsx` | 1490 |
| `TrainerSchedule.tsx` | 1300 |
| `useBookings.ts` | 1150 |

最後の「ゲートが外されていないか」は自分自身への見張り。
`tsconfig.strict.json` の `strict` を false にしたり、`include` から
`src/lib/**/*.ts` を外したり、CI から `npm run typecheck:strict` を消すと
テストが落ちる。**回していないゲートは無いのと同じ**なので、
設定ファイルだけでなく `.github/workflows/ci.yml` の中身も見ている。

## 次にやるなら

- **分割**: `TrainerClientDetail.tsx`（1945行）。タブごとに切り出す
  （`clientDetail/` に MemberTimeline / MemberInviteCard の前例がある）
- **strict の範囲を広げる**: 次は `src/hooks`。ただし lib と同じで、
  先に「hooks が pages を import していないか」を見ること
- **`as any` を減らす**: 多くは Supabase のクエリビルダ相手。
  `.from(table as never)` の形が要るのは動的なテーブル名のときだけ
