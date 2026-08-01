# 業種特化アプリ（兄弟アプリ）の作り方

GymBoard を複製して別業種向けアプリを出すときの手順書。
既存の兄弟: **ピラボード**（ピラティス）、**セッコツボード**（接骨院）、**パーソナルストレッチ版**（予定）。

## 前提: フォークは避けられない

Lovable は「1プロジェクト = 1 GitHubリポジトリ」なので、兄弟アプリごとにリポジトリが分かれる。
つまり**コードは物理的に複製される**。ここで何も決めずに複製すると、

- 上流（GymBoard）のバグ修正が兄弟に降りてこない
- 同じ修正を兄弟の数だけ手で繰り返す
- 兄弟ごとに少しずつ挙動が違う「別物」に育つ

という状態になる。それを防ぐのがこの手順書。

## 鉄則

1. **業種差分は「値」にする。コードの形を変えない。**
   文言・機能ON/OFF・ブランドは差し替えで済ませ、ロジックそのものは上流と同じ形に保つ。
2. **共通のバグは兄弟で直さず、上流（GymBoard）で直して merge で降ろす。**
   兄弟で直すと、次の merge で衝突するか、上書きで消える。
3. **フォークが編集するファイルを増やさない。**
   触るファイルが増えるほど merge 衝突が増える。「このファイルは上流所有」という線引きを守る。

## 上流を追従する（フォークリポジトリで最初にやる）

```bash
git remote add upstream https://github.com/kmunemoto/gymboard.git
git fetch upstream
git merge upstream/main        # 以後、定期的にこれを回す
```

`git merge upstream/main` が毎回すんなり通るなら、この手順書は守れている。
毎回同じファイルで衝突するなら、そのファイルは「差分を値に追い出す」対象。

---

## ⚠️ フォーク直後に必ず消す地雷

**放置すると静かに壊れる／別ジムのデータを触る**もの。優先度順。

### 1. 自社ジム（Salute御所南）の tenant UUID — 最優先

`ceda19b0-d5e0-4928-ab2e-996a0b823af4` が本番コードに直書きされている：

| ファイル | 放置したときの症状 |
|---|---|
| `src/lib/legacyDefaultTenant.ts` | `/trial`（テナントID無し）を踏んだお客様の体験予約が、**このIDのテナント宛に作られる** |
| `src/lib/dropInTenant.ts` | ドロップイン予約が同上 |
| `supabase/functions/trial-book/index.ts` | 「初回無料体験」表記の分岐が絶対に成立しない |
| `supabase/functions/drop-in-book/index.ts` | ドロップインが常に失敗 |
| `supabase/functions/send-trial-reminders/index.ts` | 体験リマインドが1件も飛ばない |
| `supabase/functions/line-booking-reminder/index.ts` | LINEリマインドが1件も飛ばない |

兄弟アプリが別 Supabase プロジェクトを使っている場合、このUUIDは**存在しないID**になるので
エラーにならず「何も起きない」形で壊れる。テストも通る。気づけない。

**対処**: `legacyDefaultTenantId` を `null` にできる形に変え、兄弟では `null`（＝「予約リンクが
正しくありません」を表示）にする。ドロップインは業種ごとに要否を判断（不要なら機能ごとOFF）。

> **既知**: 2026-08 時点で **セッコツボード にこのUUIDがそのまま残っている**（`src/lib/legacyDefaultTenant.ts`）。
> 兄弟側で先に潰すこと。

### 2. 課金が黙って sandbox になる

`src/lib/gymboardPlans.ts` の `STRIPE_LIVE_HOSTS` に新ドメインを足さないと、本番ドメインなのに
Stripe が sandbox 判定になる。**画面上は決済成功に見えて、実際には課金されない。**

### 3. ディープリンクが上流のドメイン／スキームを指す

- `src/lib/nativeBridge.ts` の `NATIVE_APP_SCHEME`（`app.gymboard.mobile:`）
  → 直さないとメール確認・OAuth からアプリに戻れない。**ビルドもテストも緑のまま壊れる。**
- 同 `PRODUCTION_WEB_ORIGIN`（`https://app.kyoto-salute.com`）
  → ネイティブアプリが配る招待リンク・体験予約リンクが全部 GymBoard 側を指す。

### 4. お客様に届くメールが「ジムボード」と名乗る

`supabase/functions/send-transactional-email/index.ts` の `BRAND_NAME`、および
`supabase/functions/_shared/transactional-email-templates/*` の各テンプレート。
**Edge Function はフロントの設定を読まない**ので、ここは別途直す必要がある。
認証メール（`auth-email-hook`）の件名も同様。

### 5. iOSビルドの sed が無言でスキップする

`.github/workflows/ios-build.yml` の bundle id 置換（`PRODUCT_BUNDLE_IDENTIFIER = app.gymboard.mobile`）は、
IDが一致しないと**何も置換せずに成功扱いで進む**。結果 `aps-environment` が入らず、
**プッシュ通知だけが動かないアプリ**が出荷される。

### 6. Lovable の MCP マニフェスト

`.lovable/mcp/manifest.json` に `salute-gosho-minami-mcp` / `パーソナルジムSalute御所南 MCP` が入っている。
自動生成物だが、リポジトリにコミットされているのでフォークに付いてくる。

---

## ブランド差し替えチェックリスト

出荷前に全部埋まっているか確認する。

### ✅ `src/lib/brand.ts` … まずここを書き換える（2026-08-01〜）

製品名・URLスキーム・本番ドメイン・Stripe liveホスト・LP URL・運営者連絡先は
**`src/lib/brand.ts` 1ファイルに集約済み**。フォークはここを書き換えるだけでよい。

特に **`src/locales/*.json` からは製品名の文字列が完全に消えている**
（`{{brandJa}}` / `{{brandEn}}` / `{{brandApp}}` の補間に置き換え、`brand.ts` から注入）。
つまり **5言語のロケールファイルは上流とバイト一致のまま**にでき、
かつては最大のコンフリクト源だったロケールが merge で衝突しなくなった。
`src/test/brandInterpolation.test.ts` が「ロケールに製品名を書き戻す」のを検出する。

**アプリ識別**（brand.ts の外に残るもの）
- [ ] `capacitor.config.ts` … `appId` / `appName` — **`brand.ts` の `NATIVE_APP_SCHEME` と必ず一致させる**
- [ ] `.github/workflows/ios-build.yml` … bundle id・プロビジョニングプロファイル・`MARKETING_VERSION`
- [ ] Firebase プロジェクト … `GoogleService-Info.plist` / `google-services.json` / Web VAPID鍵
- [ ] Supabase プロジェクト … `.env` / `supabase/config.toml` / `deploy-functions.yml` の project ref

**見た目**
- [ ] `index.html`（title / description / OGP）
- [ ] `public/manifest.json`（name / theme_color）
- [ ] アイコン・スプラッシュ一式（`npx @capacitor/assets@3 generate` — `mem/features/app-icon-splash-assets.md`）
- [ ] `src/index.css` のテーマ色

**文言**
- [ ] 法務3ページの本文（利用規約 / プライバシー / 特商法）— 事業者情報そのものは差し替えが要る
- [ ] Edge Function 側のブランド文字列（上記「地雷4」。**ここはまだ brand.ts の外**）

**課金**
- [ ] Stripe の商品と lookup key（`mem/features/gymboard-saas-plans.md`）
- [ ] 特商法ページの価格表

## 業種ごとに決めること（機能のON/OFF）

GymBoard は「パーソナルジム全部盛り」なので、他業種では不要な機能が出っぱなしになる。

**お客様アプリの機能は `src/lib/featureFlags.ts` のフラグで落とせる（2026-08-01〜）。**
フォークではここを `false` にするだけでよい。ビルド時定数なので Vite が false 側を
丸ごと落とす（姿勢分析は TensorFlow.js 約580KB を引くため、使わない業種では効果が大きい）。

| 機能 | フラグ | ジム以外で残すか |
|---|---|---|
| トレーニング記録（種目×重量×回数・成長グラフ・体の変化写真） | `WORKOUT_LOG_ENABLED` | 筋トレ以外はほぼ不要。記録は `bookings.trainer_note`（予約ごとのカルテ）で代替できる |
| AI食事記録 | `MEALS_ENABLED` | 減量が売りでなければ不要 |
| 姿勢分析 | `POSTURE_ENABLED` | 施術系なら相性が良い（残す価値あり）。ただし推奨内容が筋トレ種目なので要差し替え |
| 部位別レーダー | `MUSCLE_RADAR_ENABLED` | 部位マスタ（`tenant_muscle_groups`）を業種の部位に差し替えれば使える |
| 体重・体脂肪の記録 | `BODY_METRICS_ENABLED` | ボディメイク文脈でなければ不要 |
| SNSシェアカード | `WORKOUT_SHARE_ENABLED` | 記録を切るなら一緒に切る |
| 月次レポート | `MONTHLY_REPORT_ENABLED` | 中身が筋トレ/減量指標なので、記録を切るなら一緒に切る |
| ゲーミフィケーション | `GAMIFICATION_ENABLED` | 既定OFF |
| ドロップイン予約 | （フラグ無し） | 自社ジム専用機能。通常は不要 |
| 体験予約・キャンセル待ち・定期予約 | — | 業種を問わず有用。残す |

**ホーム・予約・設定タブは落とせない**（消すとアプリが操作不能になるため）。
`src/test/customerFeatureGates.test.tsx` がこれを見張っている。

## 多言語対応の方針

**兄弟アプリは当面「日本語のみ」でよい。5言語（ja/en/ko/zh-CN/zh-TW）を維持するのは
ジムボード本体だけ**（2026-08-01 決定）。

そのため兄弟側では:
- 業種語彙の翻訳は ja だけ用意すればよい（en/ko/zh の再翻訳コストは発生しない）
- 言語切替UIを残すかは任意。残す場合、未翻訳の言語は ja にフォールバックする
  （`src/lib/i18n.ts` の `fallbackLng: "ja"`）ので壊れはしないが、
  業種語彙だけ日本語のまま混ざる点に注意

なお `src/locales/*.json` は Phase 0-A で製品名を追い出したため、
**5言語ぶん全部が上流とバイト一致のまま保てる**。兄弟が翻訳を減らす必要はなく、
「触らない」のが最も安全で、上流の文言追加もそのまま流入する。

## 出荷前の検査

- [ ] `ceda19b0-d5e0-4928-ab2e-996a0b823af4` がコードに残っていない
- [ ] 「ジムボード」「GymBoard」が意図しない場所に残っていない（**Edge Function とメールを特に**）
- [ ] `npx tsc --noEmit -p tsconfig.app.json` / `npm test` / `npm run build`
- [ ] 実機で: プッシュ通知・メールの差出人名・体験予約リンク・課金導線（sandbox/live判定）

## 現状の限界（正直なところ）

**ブランドは `src/lib/brand.ts` に集約済み**（ロケールJSONも上流とバイト一致にできる）。
一方、**まだ集約できていないもの**が残っている:

| 残っているもの | 状況 |
|---|---|
| `capacitor.config.ts` / `index.html` / `public/manifest.json` | ビルド設定側なので `brand.ts` から読めていない。フォークごとに手で書き換える |
| `.github/workflows/ios-build.yml` | 同上 |
| `supabase/functions/**` のブランド文字列 | **Edge Function はフロントの設定を読まない**ため別管理。メール本文・件名がここ |
| 業種語彙（ジム／トレーナー／トレーニング…約320キー） | i18n オーバーレイ層が未実装。次の工事 |
| 顧客側アプリの機能ON/OFF | 仕組み自体が無い（`show_*` はトレーナー画面専用）。次の工事 |

**merge 時の解決方針**: 上の表のファイルで衝突したら「兄弟側を優先」でよい
（＝ブランド設定は上流から降ろさない）。それ以外のファイルで衝突したら
「業種差分をコードに書いてしまっている」サインなので、値に追い出せないか検討すること。

## 関連

- `mem/features/gymboard-saas-plans.md` … SaaS料金プランの二重定義とデプロイの注意
- `mem/features/app-icon-splash-assets.md` … アイコン・スプラッシュ生成
- `mem/features/capacitor-8-upgrade.md` … Android/iOS ビルド手順
- `mem/ops/schema-drift.md` … マイグレーション適用と types.ts
