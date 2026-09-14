# 体験予約だけ「時間ブロック」を無視して受ける（店ごとON/OFF）

2026-09-14 宗本さんの要望:

> 体験予約はお店のブロックを無視して予約できるように設定できる、
> オンオフの機能を追加してほしい。……**時間ブロックです。**

---

## 🔴 用語（このアプリには「ブロック」が2つある）

| アプリ上の名前 | 実体 | 作る場所 | 体験予約への効き方 |
|---|---|---|---|
| **時間ブロック**（`schedule.blockTime`） | `blocked_slots` | 予定表 →「時間ブロック」 | **ここで扱うのはこちら** |
| 受付しない時間帯（`blockedWindows.section`） | `blocked_windows` | ジム設定 → 予約のルール | **元々効いていない** |

体験予約はすでに「1日の上限・ワンタップ受付停止（GB007）」と
「受付しない時間帯（GB006）」の例外になっている。塞いでいたのは時間ブロックだけだった。

## 宗本さんの決定（2026-09-14）

- **体験のみ。** ドロップインは対象外（同じ `trial_bookings` に同居しているが `booking_kind` で分ける）
- **店ごとに1つのトグル。** 枠ごとのフラグ（`blocked_slots.allow_trial`）は作らない

---

## 🔴 踏みやすい穴が2つある。どちらも「静かに壊れる」

### 穴1: 画面側 — ブロック行を数え上げから落とさないと、ONにしても何も変わらない

`TrialBooking.tsx` の `isSlotBlocked` は2段構え:

```ts
if (overlapping.some((b) => b.isBlock)) return true;          // ← 早期 return
return overlapping.length >= resolveSlotCapacity(...);        // ← 同時受入数
```

**早期 return だけを条件付きにしても効かない。** ブロックの行は `overlapping` に
残ったままなので、下の「`overlapping.length >= 同時受入数`」で1件として数えられる。

🔴 **本番は全20テナントが同時受入数 1**（`booking_capacity_windows` は0行）。
つまり落とさないと、**ONにしても誰の画面も1ミリも変わらない**。

正しいのは `filter` の中で先に落とすこと:

```ts
if (ignoreBlocks && b.isBlock) return false;   // 数え上げに入る前に落とす
```

（DB 側の `overlap_count` は `kind = 'booking'` しか数えていないので、
そちらは汚れていない。**この穴はクライアントだけの話**）

### 穴2: DB — 画面だけ直すと送信で100%落ちる

`trial_bookings` には `prevent_trial_booking_overlap`（BEFORE INSERT）が生きていて、
`check_booking_overlap()` の `IF blocked_count > 0 ... RAISE` に当たる。

**本番で実際に確かめた**（`BEGIN … ROLLBACK`）: ブロック枠へ体験予約を INSERT すると
service_role でも `P0001: この時間帯はすでに予約が入っています`。

しかも `TrialBooking.tsx` は `slot_taken` を受けると枠を取り直すが、UI はブロックを
無視しているので**同じ枠がまた「空き」として出る**。お客様は同じ操作を繰り返し、
店には1件も入らない。

⚠️ `supabase/migrations/20260822010000_blocked_slots_recurrence.sql:11` に
「DB 側にブロックの重なりを拒否するトリガーは無い」というコメントがあるが、
**この文脈では誤り**。`bookings` / `trial_bookings` 側の拒否は存在する。

### 🔴 `check_booking_overlap` は `bookings` と共用している

`prevent_booking_overlap`（`bookings`）も同じ関数を呼ぶ。緩める分岐は
**`TG_TABLE_NAME = 'trial_bookings'` で必ず限定する**。忘れると会員の自己予約も
店の代理予約も全テナントでブロック枠を素通りし、二重予約が起きる。

`bookings` には `booking_kind` 列が無いので、`NEW.booking_kind` と直接書かず
`to_jsonb(NEW) ->> 'booking_kind'` で読む（この関数の既存の作法）。

---

## 何を無視して、何を無視しないか

| | ON のとき |
|---|---|
| 時間ブロック（`blocked_slots`） | **無視する**（体験だけ） |
| 他の予約との重なり（同時受入数） | 効く |
| 担当者の重複（GB001） | 効く |
| 営業時間・定休日・予約の締切 | 効く |
| 会員予約・店の代理予約 | **一切変わらない** |
| ドロップイン | **一切変わらない** |

---

## 予定表の見え方（ここを直さないと機能が危ない）

週タイムラインのカードは全部 `absolute left-0.5 right-0.5` で、**重なりを想定していない**。
同じ時間に2枚あると後から描いた1枚が前の1枚を丸ごと覆う。
ブロックが体験を隠すと、店は**入っていること自体に気づけない**。

2つ当ててある:

1. **ブロックは必ず背面**（`b.isBlocked ? "z-0" : "z-[1]"`）
2. **ブロックと重なった予約に印**（`ring-2 ring-warning` ＋ `title` に併記）

判定は `src/lib/scheduleOverlap.ts` の `indexesOverlappingBlocks`。
表示している配列の中だけで完結させている（DB に「ブロックを無視して入った」印は持たない）。

⚠️ **PC の日別表（`TrainerSchedule.tsx` の `getSession`）は `find()` で1件しか出さない**ので、
重なると片方が消える。こちらは未対応。`TrainerSchedule.tsx` が行数の上限
（`qualityRatchet.test.ts` の 1300 行）まで残り4行しかなく、直すなら
ロジックを `src/lib/` へ切り出すところからになる。宗本さんが使っているのは
週タイムライン（既定ビュー）なので、そちらを先に手当てした。

---

## 置き場

| 何 | どこ |
|---|---|
| 設定列 | `tenants.trial_ignores_blocked_slots`（`BOOLEAN NOT NULL DEFAULT false`） |
| 公開ページへの受け渡し | `get_tenant_public`（DROP → CREATE → **GRANT 貼り直し**） |
| 最終判定 | `check_booking_overlap()` |
| 画面（お客様） | `src/pages/TrialBooking.tsx` |
| 画面（店） | `src/components/trainer/TrialIgnoreBlocksCard.tsx` |
| 重なり判定 | `src/lib/scheduleOverlap.ts` |

`/trial` はログイン不要なので `tenants` を直接読めない。**`get_tenant_public` 経由でしか
届かない**。返り値の型を変えるので `DROP` が要り、`DROP` すると `GRANT` が消える。

**未適用の間は安全側（＝ブロックが効く）。** 画面は `=== true` で見る
（`??` や truthy 判定にすると、列が読めない環境で緩んでしまう）。

---

## 本番へ適用した記録（2026-09-14）

3段構え。**5パターンすべて設計どおり**（`RAISE EXCEPTION` で全部ロールバック済み）。

```
1. 読み取り  col_exists=0 / rpc_has_col=false / trigger_has_branch=false（未適用）
2. 適用      列 + check_booking_overlap + get_tenant_public(DROP/CREATE/GRANT)
3. 実測（未来日にブロックを立てて INSERT を試す）
   (1) 体験 x OFF          = REJECTED（従来どおり）
   (2) 体験 x ON           = ACCEPTED   ← 効いている
   (3) ドロップイン x ON   = REJECTED（対象外）
   (4) 会員 x ON（対照）   = REJECTED   ← 共用関数の限定が効いている
   (5) 同時受入数 x ON     = REJECTED（1件入った直後の2件目）
   後始末  probe の行は0件・フラグは全20テナント false のまま
```

🔴 **Salute御所南でもまだ OFF。** 使うときに本番で個別に ON にする
（migration では誰の値も変えていない）。

```sql
UPDATE public.tenants SET trial_ignores_blocked_slots = true
 WHERE id = 'ceda19b0-d5e0-4928-ab2e-996a0b823af4';
```

---

## 番人（`src/test/trialIgnoreBlocks.test.ts`・35件）

変異6パターンが赤になることを確認済み:

| 変異 | 何が起きる実装か |
|---|---|
| `filter` で落とさず `some()` の条件付けにする | ONでも何も変わらない |
| `TG_TABLE_NAME` の限定を外す | 会員予約まで緩む |
| ドロップインの除外を外す | 訪日客の当日利用まで緩む |
| `GRANT` を貼り直し忘れる | 公開ページが RPC を呼べなくなる |
| 予定表の重ね順を外す | ブロックが体験を覆い隠す |
| `=== true` を truthy 判定にする | 列が未適用の環境で緩む |

### ⚠️ 番人を書くときの罠（3回踏んだ）

説明のコメントに `NEW.booking_kind` や `overlapping.length >=` と書いてあると、
素の `indexOf` / `toMatch` が**実コードを1行も見ないままコメントに当たる**。
このファイルの `stripComments` を通してから見ること
（`min_version` の番人・`dangerouslySetInnerHTML` の番人と同じ型の間違い）。

---

## やっていないこと（必要になったら）

- **PC の日別表の重なり表示**（上記のとおり行数の上限が先に来る）
- **Google カレンダー**には `blocked_slots` を同期していないので、外部カレンダー上では
  重なりがまったく見えない
- 「ブロックを無視して入った体験だ」という**印を DB に持つ**
  （いまは表示時に時間帯を突き合わせている。設定を OFF に戻しても、
   既に入っている予約には印が出続ける＝事実として正しい）
- 通知メール／プッシュの本文に「ブロックと重なっています」を足すこと
