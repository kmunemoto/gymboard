# Web Push（VAPID）の鍵まわり

最終更新: 2026-08-05

## 3点セット

VAPID は「**同じ鍵ペア**を3箇所で使う」構成。どれか1つがズレると成立しない。

| # | 場所 | 中身 |
|---|---|---|
| 1 | `src/lib/brand.ts` の `VAPID_PUBLIC_KEY` | **唯一の宣言** |
| 2 | `supabase/functions/send-push-notification/index.ts` | 1 の写し（Deno は brand.ts を import できない） |
| 3 | Supabase Secrets の `VAPID_PRIVATE_KEY` | 1 と対になる秘密鍵 |

`src/test/pushVapidConfig.test.ts` が **1 と 2 の一致**を見張る。
**3 はリポジトリに無いので機械では見られない。** 実機で1通受け取るまで分からない。

連絡先（JWT の `sub`）も同じ形: `brand.ts` の `VAPID_CONTACT_EMAIL` が唯一の宣言。

## なぜ「無言で失敗する」のか

```
鍵がズレている
  → send-push-notification は 200 を返す（1件ずつ .catch で潰して続行するため）
  → プッシュサービスは 401 / 403
  → 購読が消えるのは 404 / 410 のときだけ  ←★
  → 消えないので毎回同じ失敗を繰り返す
  → 画面は「通知ON」のまま。永久に届かない
```

**FCM の `SENDER_ID_MISMATCH` とまったく同じ形**（`mem/features/android-ci.md`）。

2026-08-05 に、Web Push 側にも以下を入れた:

- 401 / 403 を `console.error` で出す（`console.warn` では埋もれる）
- **401 / 403 で購読を消さない。** これは「購読が無効」ではなく「こちらの鍵が違う」。
  消すと、鍵を直したときに戻ってくるはずの購読者まで失う
- レスポンスに `web.vapidRejected` / `fcm.configRejected` を足した。
  **0 でない間は誰にも届いていない**

## 鍵を変えると既存の購読が全部無効になる

購読はブラウザ側で**公開鍵に紐づいている**。鍵を変えると、

- `getSubscription()` は**古い購読をそのまま返す** → 画面は「ON」
- サーバは新しい鍵で署名 → 401 / 403
- 自動では直らない

2026-08-05 まで、`checkWebSubscription` は購読の**有無しか見ていなかった**。
つまり **鍵を変えられない状態にロックインされていた**（万一漏れても安全に交換できない）。

### 自己修復（2026-08-05 に追加）

`usePushSubscription` の `checkWebSubscription` が、購読の `applicationServerKey` を
現在の公開鍵と突き合わせ、違えば **解除 → DBから削除 → 作り直し** を行う。
利用者の再操作は要らない（次にアプリを開いたときに復帰する）。

判定は `src/lib/webPushKey.ts` の `isSameVapidKey`。**ここは本物のユニットテストがある**
（`src/test/webPushKey.test.ts`）。フックのままだと検査できないので切り出した。

> ⚠️ **`applicationServerKey` を返さないブラウザでは `true`（＝触らない）を返す。**
> 「取れない＝不一致」と扱うと、**正常に動いている購読を毎回作り直す**。
> `nativeAppIdentity` / `pushConfigGuards` で2度やった「検査できない構成を不合格にする」
> 誤検出と同じ形。**分からないときは触らない。**

### 許可ダイアログを勝手に出さない

作り直しの前に `Notification.permission === "granted"` を確認する。
`granted` でないまま `subscribe()` すると、**画面を開いただけで許可ダイアログが出る**。

## 兄弟アプリとの共有について（2026-08-05 時点の状況）

**remix した兄弟アプリは、ジムボードの公開鍵と `mailto:` をそのまま引き継いでいる。**

### 分離しないことのリスク評価

| 論点 | 評価 |
|---|---|
| 鍵が漏れたら全アプリに送られる | **誇張。** 送信には購読行（endpoint / p256dh / auth）も要り、それは各アプリの DB にある。DB を取られている時点で鍵の共有は些末 |
| ローテーションが全アプリ連動する | **これが本命。** 1つのアプリの都合で鍵を変えると、全アプリの購読が同時に無効になる |
| 評判・レート制限の連動 | 全アプリが同じ鍵・同じ `mailto:` で自己申告している。巻き込まれうるが、**実例は未確認（推測）** |

### 決めた順番

1. **先に自己修復と可視化を入れる**（2026-08-05 に実施。この文書の上半分）
   — 分離するかどうかに関係なく必要。入るまで鍵を変えられない
2. `VAPID_PUBLIC_KEY` / `VAPID_CONTACT_EMAIL` を `brand.ts` に集約し、テストで見張る（同上）
3. **これから出す兄弟アプリは最初から自分の鍵にする**（購読ゼロなので無痛）
4. 既存の兄弟は 1〜2 を取り込んでから分離する

**兄弟を全部ネイティブにすると Web Push の比重は下がる**（ネイティブは FCM で VAPID は無関係）。
ただしブラウザ利用者には効き続けるので、ゼロにはならない。

### 兄弟アプリが今どの状態か

`VAPID_PRIVATE_KEY` は各アプリの Supabase Secrets にあり、こちらからは見えない。3通り:

| 状態 | 症状 |
|---|---|
| 鍵を共有している | Web プッシュが**届く** |
| 別の秘密鍵を入れたが直書きは上流のまま | **401 で無言で届かない** |
| `VAPID_PRIVATE_KEY` 未設定 | 署名で例外 → ログに `web push error` |

**「ブラウザで通知を1通受け取れるか」を確認してもらうのが唯一の判定方法。**

## 分離するときの手順

```
1. 新しい鍵ペアを作る（web-push generate-vapid-keys 等）
2. src/lib/brand.ts の VAPID_PUBLIC_KEY を差し替える
3. supabase/functions/send-push-notification/index.ts の写しも差し替える
   （2 だけだと pushVapidConfig.test.ts が赤くなる）
4. Supabase Secrets の VAPID_PRIVATE_KEY を差し替える
5. VAPID_CONTACT_EMAIL を自分の運営者アドレスにする
6. デプロイ後、**ブラウザで1通受け取れることを確認する**
```

**4 を忘れると 401 で無言で止まる。** 2〜3 と 4 は別systemなので、片方だけ済ませやすい。

既存の購読者は、自己修復が入っていれば次にアプリを開いたときに復帰する。
**自己修復が入っていないバージョンを使っている利用者は復帰しない**ので、
先にクライアントを配ってから鍵を変えること。

## 参照

- `src/lib/webPushKey.ts` … 鍵の比較（ユニットテストあり）
- `src/test/webPushKey.test.ts` … 比較ロジックの検査
- `src/test/pushVapidConfig.test.ts` … 宣言の一致・自己修復・401/403 の扱い
- `mem/features/android-ci.md` … FCM 側の同じ形の事故（SENDER_ID_MISMATCH）
- `mem/ops/native-release-checklist.md` … 兄弟アプリがネイティブで出すときの手順
