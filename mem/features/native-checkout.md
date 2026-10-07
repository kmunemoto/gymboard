# ネイティブアプリからの Stripe Checkout 直行（2026-08-06）

## 何を変えたか

ネイティブアプリの請求画面で、プランを選ぶと**そのまま Stripe の決済ページ**へ行く。

```
旧: [Webでプランに申し込む] → gymboard.lovable.app のトップ
      → **ログイン画面**（アプリのセッションは引き継がれない）
      → 自力で 設定 → 請求 まで辿る
      → プライベートブラウズだと保存パスワードも効かず、ほぼ詰む

新: [このプランにする] → アプリ内で create-checkout を叩く（JWT は持っている）
      → 返ってきた Checkout URL をシステムブラウザで開く
      → 決済 → /billing/return → app.gymboard.mobile://billing?status=success
      → アプリに戻る
```

**Stripe Checkout は自前のログイン状態を必要としない**（状態は URL の `cs_...` に入る）。
つまり**プライベートブラウズでも動く。** 旧経路だけがプライベートで壊れていた。

「Webでプランに申し込む」ボタンは残してある（副次的な導線に降格）。

## 🔴 一番危ない罠: ネイティブは hostname が `localhost`

ネイティブの `window.location` は `capacitor://localhost`（Android は `https://localhost`）。
**`detectStripeEnvironment(window.location.hostname)` をそのまま呼ぶと `sandbox` が返る。**

**sandbox の Checkout は、本物のカードを入れても「成功」して課金されない。**
ジムオーナーからは契約できたように見え、売上は立たない。**エラーは一切出ない。**

同種の事故は 2026-07 に一度起きている（`app.kyoto-salute.com` が `LIVE_HOSTS` に
無く sandbox に落ちていた）。

対策: `checkoutWebOrigin(isNative, windowOrigin)` が**ネイティブでは
`PRODUCTION_WEB_ORIGIN` に読み替える。** 環境判定も戻り先URLもこのオリジンから作る。

`src/test/nativeCheckout.test.ts` が見張る（変異4種で検証済み）。
とくに「プレビューは sandbox のまま」を別途検査して、
**「常に live を返す」実装で通らない**ようにしてある。

## 戻り先に中継ページを挟む理由

`gymboard-create-checkout` は `success_url` / `cancel_url` のホストを
**自分のドメインだけに制限している。** カスタムスキーム（`app.gymboard.mobile://`）は通らない。

**この制限は緩めないこと。** 任意のアプリへ飛ばせる穴になる。

代わりに `https://<本番ドメイン>/billing/return` を挟み、そこからディープリンクで戻す。
ディープリンクが効かない場合（プライベートブラウズ等）でも、
**「決済は完了している」ことが画面から読める。** 黙って白い画面を出すと二重申し込みを招く。

**中継ページで契約状態を書き換えないこと。** 反映は webhook の仕事。
ここで書き換えると、URLを直接開くだけでプランを書き換えられる。

## 🔴 2026-10-07: iOS 1.8.0 (167) が 3.1.1 で却下 → iPhone の購入導線を止めた

8/7 に通った同じ導線が、1.8.0 の審査で**ガイドライン 3.1.1 で却下された**（審査員による差）。
指摘は「アプリの機能を有料で開放するならアプリ内課金を使え。外部決済への
ボタン・リンク・案内も置くな」。対象は**お店がジムボードに払う月額プラン**だけで、
お客様がジムに払う会費・回数券（店舗で受けるサービス）は関係ない。

宗本さん「一旦アプリから課金への案内の導線をけしてください。
システムは消さずにまたいつでも戻せる様にして」。

**`featureFlags.ts` の `IOS_BILLING_GUIDANCE_ENABLED = false`**（判定は `src/lib/appBillingGuidance.ts`）。
iPhone だけで、次の3か所が消える:

| 場所 | iPhone での表示 |
|---|---|
| 設定 → プラン・お支払い（`TrainerBilling`） | **いまのプランの名前と顧客上限だけ**。料金・一覧・「このプランにする」・「Webでプランに申し込む」・Web の案内文は出さない |
| プラン上限の警告バナー（`PlanLimitBanner`） | 「プランの変更はWebサイトから行えます」を抜いた `planLimit.overDescApp` |
| ヘルプ（`TrainerHelpGuide`） | 「5. プランのご契約方法」の節ごと出さない |

- **「Webで契約できます」と書くだけでも誘導になる**（日本のストア）。言い換えて残さないこと
- 延滞バナー（`SubscriptionBlockedBanner`）は元々ネイティブでボタンを出しておらず、
  文言も「お支払い状況をご確認ください」だけなので触っていない
- **課金の仕組みは止めていない。** Web の契約・Stripe・webhook・席数上限・延滞判定・
  `/billing/return`・ディープリンクの戻りはそのまま。契約済みのお店は何も変わらない
- **Android は止めていない**（指摘されていない）。Play で同じ指摘を受けたら
  `ANDROID_BILLING_GUIDANCE_ENABLED = false`
- 版数は **1.8.0 のまま**出し直す（却下された版は未公開なので同じ版数で新しいビルドを付けられる。
  ビルド番号は `run_number` なので 167 より大きくなる）

**戻し方: `IOS_BILLING_GUIDANCE_ENABLED = true` にするだけ。**
`src/test/appBillingGuidance.test.tsx` はフラグの値を断言しない（戻すときにテストを直さなくてよい）。
true / false の両方を差し込んで「消える」「戻る」「Android・Web は変わらない」を見ている
（各ゲートを外す変異4種で赤になることを確認済み）。

戻す前に考えること: 3.1.1 を正面から満たすには、アプリ内課金（手数料 15〜30%）か、
日本の新法（スマホ新法）に基づく外部決済の申請（Apple の許可が要る）のどちらかが要る。
単に true に戻すと、また却下される可能性が高い。

## Apple の審査 — ✅ **通過した（2026-08-07）**（⚠️ 10/7 に却下。上の節）

**iOS・Android とも審査を通り、決済ページへの直行が本番で動いている。**
懸念していたガイドライン 3.1.1（外部決済への誘導）の指摘は**無かった**。

実装時の想定は次のとおりだった。**結果として杞憂だったが、判断の記録として残す。**

- 旧の「Webでプランに申し込む」も外部リンクアウトで、そちらは審査を通っていた
- ただし**Webのトップに飛ばす**のと**決済ページに直行させる**のとで見え方が変わりうる、と考えた
- **Android から先に出す**方針にしていた（Play のほうが戻しやすいため）

`featureFlags.ts` の `NATIVE_DIRECT_CHECKOUT` は**フラグとして残してある。**
通ったからといって消さないこと。Apple はガイドラインの運用を変えることがあり、
**次の審査で指摘されたときに1行で旧の形へ戻せる**という価値は消えていない。
サーバ側は何も変えなくてよい。

## ついでに直したこと

`webPlansUrl` に `https://gymboard.lovable.app/?tab=billing` が**直書き**されていた。
`brand.ts` を経由していないので、**兄弟アプリのジムオーナーが押すと上流の課金画面に飛ぶ。**
そこには自分のアカウントが無いので行き止まりになるか、
**上流側に契約を作ってしまう**可能性があった。

`edgeFunctionOrigin.test.ts` は `supabase/functions/` しか見ないので、
**`src/` の直書きは検査に掛かっていなかった。**
`nativeCheckout.test.ts` に「課金導線に上流ドメインが直書きされていないこと」を入れた。

> `src/components/trainer/TrainerHelpGuide.tsx:185` にも同じ直書きが残っている。
> ヘルプの案内文なので実害は小さいが、次に触るときに直すこと。

## 兄弟アプリへ — **配布可（2026-08-07 解禁）**

> 以前ここには「**ジムボードで審査が通ってから配る。通らなければ配らない**」と書いていた。
> **2026-08-07 に iOS・Android とも通過したので、この条件は満たされた。**
> 配布して構わない。

配るときに**必ず**確認すること。**片方だけ直すと sandbox に落ちる**（`nativeCheckout.test.ts` が検出する）。

```
1. PRODUCTION_WEB_ORIGIN のホスト  ∈  STRIPE_LIVE_HOSTS
2. <PRODUCTION_WEB_ORIGIN>/billing/return  が  create-checkout の
   allowedSuffixes を通る（通らないと「URL not allowed」で決済に進めない）
3. NATIVE_APP_SCHEME が自分のもの（app.gymboard.mobile: が残っていないか）
4. 課金導線に上流のドメインが直書きされていないか
```

**フラグは `true` で出してよい。** ジムボードが両ストアの審査を通っているので、
「上流が未検証だから false で入れる」という理由はもう無い。

配布用の手順書は `scratchpad` ではなく、この節と
`src/test/nativeCheckout.test.ts` を正とすること（コードが唯一の正）。
