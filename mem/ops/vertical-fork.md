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

**アプリ識別**
- [ ] `capacitor.config.ts` … `appId` / `appName`
- [ ] `src/lib/nativeBridge.ts` … `NATIVE_APP_SCHEME`（appId と一致させる）／ `PRODUCTION_WEB_ORIGIN`
- [ ] `.github/workflows/ios-build.yml` … bundle id・プロビジョニングプロファイル・`MARKETING_VERSION`
- [ ] Firebase プロジェクト … `GoogleService-Info.plist` / `google-services.json` / Web VAPID鍵
- [ ] Supabase プロジェクト … `.env` / `supabase/config.toml` / `deploy-functions.yml` の project ref

**見た目**
- [ ] `index.html`（title / description / OGP）
- [ ] `public/manifest.json`（name / theme_color）
- [ ] アイコン・スプラッシュ一式（`npx @capacitor/assets@3 generate` — `mem/features/app-icon-splash-assets.md`）
- [ ] `src/index.css` のテーマ色

**文言**
- [ ] `src/locales/*.json` の製品名（5言語）
- [ ] 法務3ページ（利用規約 / プライバシー / 特商法）と `src/lib/marketing.ts`
- [ ] Edge Function 側のブランド文字列（上記「地雷4」）

**課金**
- [ ] `STRIPE_LIVE_HOSTS`
- [ ] Stripe の商品と lookup key（`mem/features/gymboard-saas-plans.md`）
- [ ] 特商法ページの価格表

## 業種ごとに決めること（機能のON/OFF）

GymBoard は「パーソナルジム全部盛り」なので、他業種では不要な機能が出っぱなしになる。
最低限、業種に合わないものは消す。

| 機能 | ジム以外で残すか |
|---|---|
| トレーニング記録（種目×重量×回数） | 筋トレ以外はほぼ不要。記録は `bookings.trainer_note`（予約ごとのカルテ）で代替できる |
| AI食事記録 | 減量が売りでなければ不要 |
| 姿勢分析 | 施術系なら相性が良い（残す価値あり）。ただし推奨内容が筋トレ種目なので要差し替え |
| 部位別レーダー | 部位マスタ（`tenant_muscle_groups`）を業種の部位に差し替えれば使える |
| ゲーミフィケーション | 既定OFF（`featureFlags.ts`） |
| ドロップイン予約 | 自社ジム専用機能。通常は不要 |
| 体験予約・キャンセル待ち・定期予約 | 業種を問わず有用。残す |

## 出荷前の検査

- [ ] `ceda19b0-d5e0-4928-ab2e-996a0b823af4` がコードに残っていない
- [ ] 「ジムボード」「GymBoard」が意図しない場所に残っていない（**Edge Function とメールを特に**）
- [ ] `npx tsc --noEmit -p tsconfig.app.json` / `npm test` / `npm run build`
- [ ] 実機で: プッシュ通知・メールの差出人名・体験予約リンク・課金導線（sandbox/live判定）

## 現状の限界（正直なところ）

**業種差分を1ファイルに集約する preset 層は、まだ無い。** 上のチェックリストは現時点では手作業。
そのため、フォーク直後に上流と衝突しやすいファイルは次の通り:

`capacitor.config.ts` / `index.html` / `public/manifest.json` / `src/locales/*.json` /
`.github/workflows/ios-build.yml` / `supabase/functions/_shared/*`

上流側でこれらを「1つの設定ファイルから読む」形に寄せるのが次の工事。
それが入るまでは、**merge 時にこれらのファイルは「兄弟側を優先」で解決**してよい
（＝ブランド設定は上流から降ろさない）。逆に、それ以外のファイルで衝突したら
「業種差分をコードに書いてしまっている」サインなので、値に追い出せないか検討すること。

## 関連

- `mem/features/gymboard-saas-plans.md` … SaaS料金プランの二重定義とデプロイの注意
- `mem/features/app-icon-splash-assets.md` … アイコン・スプラッシュ生成
- `mem/features/capacitor-8-upgrade.md` … Android/iOS ビルド手順
- `mem/ops/schema-drift.md` … マイグレーション適用と types.ts
