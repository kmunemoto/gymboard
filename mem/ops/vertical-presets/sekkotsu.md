# プリセット: 接骨院（セッコツボード）

| | |
|---|---|
| Lovable | `fd707295-8a46-4917-b4d5-ff0bc8490b2c` |
| GitHub | `kmunemoto/project-fd707295-8a46-4917-b4d5-ff0bc8490b2c` |
| 公開URL | https://fit-client-coach.lovable.app |
| Supabase | 独自（GymBoard とは別プロジェクト） |

想定業種は接骨院・整骨院。**他の兄弟と違い、文言はすでにほぼ仕上がっている。**

## ⚠️ このアプリだけ事情が違う: `ja.json` を直接書き換えてある

2026-08-01 の実測:

- `ja.json` の葉は **1,569キー**（上流は 1,884キー ＝ **315キーが削除されている**）
- 値に含まれる語: `ジム` **0件** / `トレーナー` **0件** / `トレーニング` **0件**
- 一方 `院` 69件 / `患者` 82件 / `施術` 71件 / `来院` 14件
- **他言語（en / ko / zh-CN / zh-TW）は削除済み**。`src/lib/i18n.ts` は ja 固定で、
  `src/test/singleLocale.test.ts` が言語追加を禁止している

つまり `mem/ops/vertical-fork.md` の
「すでに `ja.json` を直接書き換えてしまったフォークの直し方」の対象。
**上流を素直に取り込むと接骨院の語彙が全部消える。**

`scripts/extract-vertical-overlay.mjs` で先にオーバーレイへ逃がすこと。
削除された315キーはオーバーレイでは表現できないので、スクリプトの警告を読んで
1件ずつ「上流の文言が出てしまってよいか」を判断する。

## 語彙の方針（すでに適用済みの実績値）

| 上流（ジム） | セッコツボード |
|---|---|
| ジム | 院 |
| ジムオーナー | 院オーナー |
| お客様 | 患者 |
| トレーナー | 施術者 |
| トレーニング | 施術 |
| 来店 | 来院（**9件やり残しあり**） |

## 済んでいること ✅

- `ja.json` の接骨院語彙化（上記）
- Salute御所南の tenant UUID 除去（`legacyDefaultTenant.ts` を `null` に、
  `trial-book` / `send-trial-reminders` の `SALUTE_TENANT_ID` 撤去）
- `capacitor.config.ts` の `appId` = `app.sekkotsuboard.mobile` / `appName` = セッコツボード
- `nativeBridge.ts` の認証コールバック = `app.sekkotsuboard.mobile://auth/callback`
- 同 `PRODUCTION_WEB_ORIGIN` = `https://fit-client-coach.lovable.app`
- `ios-build.yml` の bundle ID 3箇所
- `trial-book` の `dashboardUrl`
- `index.html` の title / description / OGP
- Edge Function のブランド: `send-transactional-email` の `BRAND_NAME` / `SITE_NAME`、
  `auth-email-hook` の件名（全て `【セッコツボード】`）

## 残っていること ❌

| 項目 | 現状 | 影響 |
|---|---|---|
| `public/manifest.json` | `name` / `short_name` = **ジムボード** | ホーム画面に追加するとアプリ名が「ジムボード」 |
| `src/lib/gymboardPlans.ts` の `STRIPE_LIVE_HOSTS` | `["gymboard.lovable.app", "app.kyoto-salute.com"]` | **本番なのに sandbox 判定。決済成功に見えて課金されない**（地雷2） |
| `auth.appTagline` | 「パーソナル院・**ピラティス**予約管理」 | ジム→院 の機械置換で「ピラティス」が残った |
| `来店` 9件 | `home.visitsCount` / `report.visited` / `report.advicePaceWeekly` ほか | → `来院` |
| ハードコードの日本語5件 | 下記 | 翻訳キーを通っていないので語彙置換から漏れた |
| `GymLogo` | `src/components/GymLogo.tsx` + GBマーク | ロゴは別途対応（2026-08-01 時点で対象外の指示） |

ハードコード5件:

- `src/pages/OAuthConsent.tsx:118` … `gymName || "ご利用中のジム"`
- `src/lib/gymboardPlans.ts:40` … `"小規模ジム向け"`
- `src/lib/gymboardPlans.ts:51` … `"中規模ジム向け"`
- `src/lib/gymboardPlans.ts:62` … `"大規模ジム・無制限プラン"`
- `src/lib/googleCalendar.ts:18` … `予約プラン：${planName || "パーソナルトレーニング"}`

## 上流からの遅れ（未搭載）

- `src/lib/brand.ts`（Phase 0-A）
- `src/locales/vertical.ts` / `vertical.ja.json`（Phase 0-C）
- `featureFlags.ts` の `WORKOUT_LOG_ENABLED` / `MEALS_ENABLED` / `POSTURE_ENABLED` ほか（Phase 0-B）
- **`sanitizeAuthNext`（認証コールバックのオープンリダイレクト対策）** ← 最優先
- `tenants.booking_capacity`（同時予約可能数）と `tenant_plans.slot_duration_minutes`

## `src/lib/brand.ts`（取り込み後に設定する値）

| 定数 | 値 |
|---|---|
| `BRAND.ja` | `セッコツボード` |
| `BRAND.en` | `SekkotsuBoard` |
| `BRAND.app` | `sekkotsuboard` |
| `NATIVE_APP_SCHEME` | `app.sekkotsuboard.mobile:` |
| `PRODUCTION_WEB_ORIGIN` | `https://fit-client-coach.lovable.app`（独自ドメイン取得後に差し替え） |
| `STRIPE_LIVE_HOSTS` | `["fit-client-coach.lovable.app"]` ＋ 独自ドメイン |

## 機能のON/OFF（**未確定 — 実装前に必ず確認すること**）

接骨院向けの妥当な出発点。まだオーナーの確認を取っていないので、勝手に確定させないこと。

| フラグ | 提案 | 根拠 |
|---|---|---|
| `POSTURE_ENABLED` | `true` | 姿勢分析は施術系と相性が良い。ただし推奨内容が筋トレ種目なので要差し替え |
| `WORKOUT_LOG_ENABLED` | `false`? | 接骨院で種目×重量×回数は使わない。ただし**施術記録の置き場を別に用意する必要がある** |
| `MEALS_ENABLED` | `false`? | 減量が売りではない |
| `BODY_METRICS_ENABLED` | `false`? | ボディメイク文脈の指標 |
| `MUSCLE_RADAR_ENABLED` | `false` | `WORKOUT_LOG_ENABLED` を切ると集計元が消えるので道連れ |
| `WORKOUT_SHARE_ENABLED` | `false`? | |

`ja.json` で `home.training` を「施術」に読み替えている以上、
**記録タブを単純に消すと施術記録の導線ごと無くなる**。ここは要設計。

## まだ決まっていない値（出荷前に埋める）

- [ ] 独自ドメイン
- [ ] Firebase プロジェクト（`ios-build.yml` の Firebase 設定はジムボードの `gymboard-bc7f3` のまま）
- [ ] プロビジョニングプロファイル（`"GymBoard App Store"` のまま）
- [ ] アイコン・スプラッシュ・ロゴ
- [ ] 法務3ページの事業者情報
- [ ] Supabase の Additional Redirect URLs に `app.sekkotsuboard.mobile://auth/callback`
