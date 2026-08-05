# 業種特化アプリ（兄弟アプリ）の作り方

> # ⚠️ この運用は 2026-08-03 に終了しました
>
> **「上流（ジムボード）で直して、兄弟が `git merge upstream/main` で取り込む」という
> 運用そのものをやめました。** 以後、各アプリは**その時点の状態からそれぞれ独立して**進みます。
>
> **やめたこと（プロセス）**
> - 兄弟アプリが上流を merge して追従すること
> - 上流で見つけた変更を `upstream-changelog.md` で下流に伝えること
> - 兄弟アプリのセッションからの報告を上流に集めて直すこと
> - 業種プリセット（`vertical-presets/`）を上流で維持すること
>
> **やめていないこと（コード）**
> - `src/lib/featureFlags.ts` / `src/lib/brand.ts` / `src/locales/vertical.ja.json` /
>   `src/test/helpers/upstream.ts` は**そのまま残してある**。
>   ジムボード単体でも普通に動いていて、消す実益が無いため
> - この文書も消していない。**もう一度フォークを作るなら、下の地雷リストは今でも有効**
>
> **この判断に伴う既知の未解決**
> - **ピラボードはメール確認とパスワード再設定が動いていません**
>   （`sanitizeAuthNext` ごと欠落。下の現況表を参照）。
>   merge をやめたので、**ピラボード側で個別に直す必要があります。**
> - 各アプリの現況表（末尾）は 2026-08-01〜03 時点のスナップショットで、以後更新されません
>
> **以下は当時の記録**として残します。事実として書かれている内容
> （地雷・Lovable の挙動・remix の癖）は今でも正しいので、参照する価値はあります。

---

GymBoard を複製して別業種向けアプリを出すときの手順書。
既存の兄弟: **セッコツボード**（接骨院）、**ストレッチボード**（パーソナルストレッチ）、
**ピラボード**（ピラティス）、**ゴルフボード**（ゴルフレッスン。2026-08-02 に remix で作成）。

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

## Lovable の複製と上流の関係は、**フォークごとに違う**（2026-08-01 に再訂正）

**まず自分のリポジトリで確かめること。思い込みで手順を選ばない。**

> **⚠️ 先に `git fetch --unshallow` すること。** claude.ai/code のクラウドセッションで
> 新規に開いたリポジトリは既定で shallow clone（浅いクローン）になっている。
> shallow のまま `git log --oneline | tail -1` を打つと、**実際の最初のコミットではなく
> 浅いクローンの取得境界にあるコミットを「最初のコミット」として返す**（ピラボードの
> 棚卸しで実際に踏んだ。`a788eba Enhance icon generation...` という偽の最初のコミットが
> 返り、正しくは `b976665 Initial commit from remix` だった）。
> 診断コマンドを打つ前に必ず `git fetch --unshallow` を実行すること。

```bash
git fetch --unshallow                    # 先に必須（上記）
git log --oneline | tail -1              # 最初のコミット
git remote -v                            # GitHub リモートの有無
git merge-base HEAD upstream/main        # 共通祖先があるか（要 git fetch upstream）
```

実測した3件が、それぞれ違う結果だった:

| | セッコツボード | ストレッチボード | ピラボード |
|---|---|---|---|
| 最初のコミット | `dd56aa6 Initial commit from remix` | 上流の履歴を引き継いでいる | `b976665 Initial commit from remix`（2026-05-31） |
| コミット数 | ― | ― | 223 |
| 上流との共通祖先 | **無し** | **あり**（`d0aa895` = 上流 #212） | **無し** |
| 必要な手順 | `--allow-unrelated-histories` | **普通の `git merge upstream/main` で衝突ゼロ** | `--allow-unrelated-histories` |

つまり「remix は必ず別系統の履歴になる」は**誤り**だった
（セッコツボード1件だけを見て一般化してしまっていた）。

- 共通祖先が**ある**なら、普通に `git merge upstream/main`。それで通る。
- 共通祖先が**無い**なら、`--allow-unrelated-histories` を足す。

どちらの場合も **GitHub 接続は手作業**（Lovable の画面から）。接続すると、
そのプロジェクトの現在の中身で新しい GitHub リポジトリが作られる。

### ⚠️ `-X theirs` を安易に使わない

以前この手順書は「カスタマイズが少ないフォークは `-X theirs` で丸ごと上流に揃えてよい」
と書いていたが、**これは危険なので撤回した**。

ストレッチボードで実際に起きかけたこと: 「まだ何もカスタマイズしていない」と判断して
`-X theirs` を勧めたが、remix 後の4コミットに**そのプロジェクト固有の Supabase 参照**
（`enablfwvguohfmaampgw`）が入っていた。`-X theirs` で上書きしていたら
`rrbfwitprzuevzytykrq`（**GymBoard 本番DB**）に戻り、
**兄弟アプリが別ジムの本番データベースを触る**状態になっていた。

「カスタマイズがゼロに見える」は当てにならない。**先に差分を実際に見ること。**

```bash
# remix 以降にフォークが触ったファイルを洗い出す
git log --oneline --name-only <最初のコミット>..HEAD | sort -u

# 特に Supabase プロジェクト参照は必ず確認する（取り違えると別ジムの本番DBを触る）
grep -rn "supabase.co\|VITE_SUPABASE" .env* src/integrations/supabase/ supabase/config.toml
```

衝突は `-X theirs` で一括処理せず、1件ずつ解決する。
**上流を採ってよいのは「上流と同じはずのファイル」だけ**で、
下記チェックリストに載っているものはフォーク側を残す。

> **もう1件、同じ理由の実例（ピラボード・2026-08-01）。** `src/lib/featureFlags.ts` の
> `STREAK_ENABLED` / `MONTHLY_REPORT_ENABLED` を独自に `false` へ変更し、
> `BILLING_ENABLED` のコメントも自社サービス名に書き換えていた。加えて
> フォーク独自のファイルが15、フォーク独自の Edge Function が2つある。
> これらは「上流と同じはずのファイル」ではなく**フォーク所有**。
> merge 時にこの5フラグの値を上書きしないこと、独自ファイル・独自 Edge Function を
> 上流に無いからといって削除しないこと。

### Lovable の再生成で消えるもの（取り込み後に必ず確認）

Lovable が自動生成し直したファイルから、手で足した設定が**黙って落ちる**ことがある。
ストレッチボードで実際に消えていた2件:

- `supabase/config.toml` の `[functions.*] verify_jwt = false`
  → この状態で deploy すると `trial-book`・LINEログイン・Stripe webhook が **401 で全滅**する
- `src/integrations/supabase/client.ts` の dev fixtures 切り替え

> **⚠️ ゴルフボードでは「一部が落ちる」ではなく `[functions]` ブロックが丸ごと消えていた**
> （2026-08-03）。`project_id` の1行だけになり、`verify_jwt = false` の指定が
> **14件すべて欠落**していた。remix 直後にこの状態なので、
> **「消えた差分を探す」のではなく「上流の全ブロックがあるか」を数えて確認すること。**
>
> ```bash
> # 上流と件数を突き合わせる（0 でなければ欠落している）
> echo $(( $(git show upstream/main:supabase/config.toml | grep -c verify_jwt) - $(grep -c verify_jwt supabase/config.toml) ))
> ```
>
> 復元するときは **`project_id` だけは自分の値のまま**にすること
> （上流のものに戻すと別プロジェクトを向く）。

取り込み後に `git diff upstream/main -- supabase/config.toml` で差分を確認すること。

### ⚠️ `deploy-functions.yml` の `PROJECT_REF` — remix が直してくれない

`.env` や `supabase/config.toml` の project ref は Lovable の remix が自分の値に直すが、
**`.github/workflows/deploy-functions.yml` の `PROJECT_REF` は上流の値のまま残る**
（ゴルフボードで実際に残っていた・2026-08-03）。

気づかずにこのワークフローを回すと、**そのフォークの Edge Function 5本が
ジムボード（Salute御所南）の本番プロジェクトに上書きデプロイされる。**
「別ジムの本番DBを触る」と同じ重さの事故で、しかも他人の環境を壊す。

**上流側で 2026-08-03 にプリフライトを入れた。** デプロイ手前で
`.env` の `VITE_SUPABASE_PROJECT_ID` と `PROJECT_REF` を突き合わせ、
食い違っていれば止める。merge すればフォークでも自動的に効く。

### ⚠️ `supabase/functions/mcp/index.ts` はビルド成果物で、ref が焼き込まれる

`src/lib/mcp/index.ts` は `import.meta.env.VITE_SUPABASE_PROJECT_ID` から読むが、
**コミットされているビルド成果物には Vite がビルド時に ref を文字列として埋め込む。**
フォークが `.env` を直しても、この1ファイルだけが上流のプロジェクトを向く
（＝別プロジェクトの issuer で OAuth 認証を要求する）。
**型もテストもビルドも全部通るので、実際に MCP を使うまで気づけない。**

**上流側で 2026-08-03 に実行時導出（`Deno.env.get("SUPABASE_URL")`）へ直した。**
`src/test/edgeFunctionProjectRef.test.ts` が `supabase/functions/**` 全体を走査して、
project ref の直書きが復活したら落ちる。**MCP の成果物を再生成すると手直しが消える**ので、
そのときはこのテストが教えてくれる。

### 追従が通ることの確認

```bash
git fetch upstream && git merge upstream/main
```

すんなり通るなら手順書は守れている。毎回同じファイルで衝突するなら、
そのファイルは「差分を値に追い出す」対象。

### ⚠️ merge したら `mem/ops/upstream-changelog.md` を読む

**コードは merge で降りてくるが、降りてきたことには気づけない。**
機能フラグは既定値のまま、新しい設定は既定値のまま、必要な作業は誰も知らないまま埋もれる。

実際にそうなった:

- `TRIAL_BOOKING_ENABLED` … 上流に入れたが、伝えるまで兄弟は誰も `false` にしていなかった
- `tenants.booking_capacity` … 入れた翌日に本番を見たら**14テナント全部が既定のまま**だった

`mem/ops/upstream-changelog.md` に「兄弟が判断すべき変更」だけを新しい順で並べてある。
**merge のたびに、前回以降の項目を上から読むこと。**

**上流側で作業する人・エージェントへ**: 兄弟が判断すべき変更を入れたら、
**PRと同じコミットで**その一覧に1件足すこと。判断が要らないもの（内部リファクタ・
上流だけのバグ修正・ドキュメント整理）は書かない。全部書くと読まれなくなる。

### すでに `ja.json` を直接書き換えてしまったフォークの直し方

セッコツボードがこの状態（`ja.json` の約1,569キーを接骨院の語彙に全面書き換え済み。
`ジム` / `トレーナー` / `トレーニング` は値に0件、`院` 69件・`患者` 82件・`施術` 71件）。

このまま上流を `-X theirs` で取り込むと**接骨院の語彙が全部消える**ので、順番が要る。

この抜き出しは `scripts/extract-vertical-overlay.mjs` に実装してある。

```bash
git remote add upstream https://github.com/kmunemoto/gymboard.git
git fetch upstream

# 1. 上流と値が違う葉だけを抜き出して vertical.ja.json にする
git show upstream/main:src/locales/ja.json > /tmp/upstream-ja.json
node scripts/extract-vertical-overlay.mjs \
  /tmp/upstream-ja.json src/locales/ja.json src/locales/vertical.ja.json

# 2. ja.json は上流のものに戻す（＝以後バイト一致させる）
git checkout upstream/main -- src/locales/ja.json

# 3. そのうえで上流を取り込む
git merge --allow-unrelated-histories upstream/main
```

> **⚠️ ブランド補間の葉に注意。** フォークの `ja.json` が Phase 0-A より前の世代だと、
> 製品名が**リテラル**で入っている（上流は `{{brandJa}}` に追い出し済み）。
> 値が違うので機械的には「フォークが変えた葉」に見えるが、これをオーバーレイに写すと
> **brand.ts からの注入が効かなくなる**（＝Phase 0-A が死ぬ）。
> スクリプトは自動で除外し、件数と内訳を報告する。
> セッコツボードでは26葉が該当した（2026-08-01）。
> `brandInterpolation.test.ts` がオーバーレイとプリセットも走査して最後の砦になる。

**スクリプトが出す警告は必ず読むこと。** オーバーレイは「上書き」しかできないので、
次の3つは自動では移せず、人間の判断が要る:

- フォークが**削除した**キー … 上流の文言がそのまま出るようになる
  （セッコツボードは 1,569キー vs 上流1,884キーなので、**300以上が該当する**）
- フォークが**追加した**キー … 上流に無いキーは i18next が黙って無視する
- **形が変わった**キー（文字列↔オブジェクト↔配列）

こうすると、以後 `ja.json` は上流所有・オーバーレイだけがフォーク所有になり、
上流が文言を足しても衝突しなくなる。**業種語彙の中身は
`mem/ops/vertical-presets/` にプリセットとして上流側に保管する**（下記）。

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

**対処**: 兄弟では `LEGACY_DEFAULT_TENANT_ID` / `DROP_IN_TENANT_ID` を **`null` にするだけ**。
上流のコードは `null` を渡されても壊れない形に揃えてある（2026-08-01）ので、
フォーク側でコードの形を変える必要は無い。

> #### ⚠️ `null` にしたとき `null === null` で**逆に有効になる**罠
>
> 素朴に `tenantId === DEFAULT_TENANT_ID` と書くと、両方 `null` のときに **true** になる。
> テナントID無しのURL（`/trial`・`/drop-in`）では `effectiveTenantId` も `null` になるため、
> **「無効化したつもりが、そのURLでだけ複製元専用の挙動が出る」**という逆の結果になる。
> エラーも警告も出ない。
>
> 上流では次の3箇所にガードを入れ済み（`src/test/forkTenantNullSafety.test.ts` が番人）:
> - `dropInTenant.ts` … `!!DROP_IN_TENANT_ID && tenantId === DROP_IN_TENANT_ID`
> - `TrialBooking.tsx` … 見出しの分岐に `DEFAULT_TENANT_ID !== null &&`
> - `TrialBooking.tsx` / `DropInBooking.tsx` … `if (!resolveId) return;` で RPC を呼ばない
>
> 上流を取り込んでいないフォークで自前で `null` 化した場合は、この3箇所を必ず確認すること。

> **状況**: セッコツボード・ストレッチボードとも 2026-08-01 に除去済み。
> ストレッチボードでは `counseling_responses.tenant_id` の**列 DEFAULT** にも
> 同じ UUID が残っていたため `DROP DEFAULT` するマイグレーションを追加している。
> **コード内の grep だけでは足りない**（DB のデフォルト値・制約も見ること）。

### 2. 課金が黙って sandbox になる

`src/lib/gymboardPlans.ts` の `STRIPE_LIVE_HOSTS` に新ドメインを足さないと、本番ドメインなのに
Stripe が sandbox 判定になる。**画面上は決済成功に見えて、実際には課金されない。**

### 3. ディープリンクが上流のドメイン／スキームを指す

- `src/lib/nativeBridge.ts` の `NATIVE_APP_SCHEME`（`app.gymboard.mobile:`）
  → 直さないとメール確認・OAuth からアプリに戻れない。**ビルドもテストも緑のまま壊れる。**
- 同 `PRODUCTION_WEB_ORIGIN`（`https://app.kyoto-salute.com`）
  → ネイティブアプリが配る招待リンク・体験予約リンクが全部 GymBoard 側を指す。
- `supabase/functions/trial-book/index.ts` の `dashboardUrl`
  → **Edge Function は `brand.ts` を読まない**ので、ここは別に直す必要がある。
  体験予約のスタッフ宛メールの「ダッシュボードを開く」が上流アプリに飛ぶ。

さらに `capacitor.config.ts` の `appId` も `app.gymboard.mobile` のままなので、
**兄弟アプリと GymBoard が同じ bundle ID になる**。App Store / Play では同一IDのアプリを
2本出せず、両方入った端末では `app.gymboard.mobile://auth/callback` が
どちらのアプリに解決されるか不定になる。`appId` / `NATIVE_APP_SCHEME` /
`ios-build.yml` の bundle ID は**必ず3つとも同じ値に揃える**こと。

命名は `app.<英字ブランド>.mobile` で統一する（例: `app.gymboard.mobile` →
セッコツボードは `app.sekkotsuboard.mobile`）。**App Store に初回提出したら二度と変えられない**
ので、提出前に確定させること。

新しいスキームは、その兄弟の **Supabase の Auth → URL Configuration →
Additional Redirect URLs** にも追加が要る（登録しないとメール確認・OAuth の戻りが弾かれる）。

### 4. お客様に届くメールが「ジムボード」と名乗る

`supabase/functions/send-transactional-email/index.ts` の `BRAND_NAME`、および
`supabase/functions/_shared/transactional-email-templates/*` の各テンプレート。
**Edge Function はフロントの設定を読まない**ので、ここは別途直す必要がある。
認証メール（`auth-email-hook`）の件名も同様。

### 5. iOSビルドの sed が無言でスキップする

`.github/workflows/ios-build.yml` の bundle id 置換（`PRODUCT_BUNDLE_IDENTIFIER = app.gymboard.mobile`）は、
IDが一致しないと**何も置換せずに成功扱いで進む**。結果 `aps-environment` が入らず、
**プッシュ通知だけが動かないアプリ**が出荷される。

`capacitor.config.ts` の `appId` を変えたら、`ios-build.yml` 側の bundle id も必ず同時に直す。
直すのは3箇所（sed のパターンと置換文字列で2回＋`ExportOptions.plist` の
`provisioningProfiles` のキー）。

### 5-b. GymBoard の Firebase 設定がワークフローに直書きされている

`ios-build.yml` の `Inject GoogleService-Info.plist` ステップは、**GymBoard の Firebase
プロジェクト（`gymboard-bc7f3`）の API_KEY / GCM_SENDER_ID / GOOGLE_APP_ID / BUNDLE_ID を
ヒアドキュメントで直書き**している（`.gitignore` されているのは生成物の方だけで、
この注入元はリポジトリに入っている）。

直さないと、**兄弟アプリのプッシュ通知が GymBoard の Firebase プロジェクトにぶら下がる**。
`PROVISIONING_PROFILE_SPECIFIER = "GymBoard App Store"` も同様。
兄弟ごとに Firebase プロジェクトとプロビジョニングプロファイルを作って差し替えること
（Android の `google-services.json`・Web の VAPID鍵も同じ）。

### 6. Lovable の MCP マニフェスト

`.lovable/mcp/manifest.json` に `salute-gosho-minami-mcp` / `パーソナルジムSalute御所南 MCP` が入っている。
自動生成物だが、リポジトリにコミットされているのでフォークに付いてくる。

### 7. `public/manifest.json` がジムボードのまま

`index.html` の `<title>` はブランド変更時に気づきやすいが、**PWA マニフェストは見落とす**。
`name` / `short_name` がジムボードのままだと、**ホーム画面に追加したときのアプリ名が
「ジムボード」になる**。セッコツボードは 2026-08-01 時点でこの状態だった
（`index.html` は「セッコツボード」なのに `manifest.json` は「ジムボード」）。

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
- [ ] Firebase プロジェクト … `GoogleService-Info.plist` / `google-services.json`
- [ ] Web Push の VAPID鍵 … `brand.ts` の `VAPID_PUBLIC_KEY` / `VAPID_CONTACT_EMAIL`、
      `send-push-notification/index.ts` の写し、Supabase Secrets の `VAPID_PRIVATE_KEY` の**3点セット**。
      **1つでもズレると 401/403 で無言で止まる。** 手順と判断の経緯は `mem/features/web-push-vapid.md`
      （`src/test/pushVapidConfig.test.ts` が brand.ts と Edge Function の一致を見張るが、
      **Secrets は見られない**ので実機で1通受け取るまで確認できない）
- [ ] `.github/workflows/android-build.yml` … **使うかどうかは各アプリが判断する（任意）**。
      使わないなら `workflow_dispatch` のみなので放置してよい。使うなら
      `packageName`（`app.gymboard.mobile` の箇所）を `appId` に合わせる
      - **ジムボード本体は使っていない**（2026-08-03。Secrets 6種の準備コストが
        見合わず、Android Studio での手作業リリースを継続。`mem/features/android-ci.md`）
      - ただし**ピラボードのように Android のリリース経路自体が無いアプリには作る価値がある**。
        「上流がやめたから兄弟もやめる」ではなく、自分の状況で決めること
      - 使う場合、フォークごとに新規の GitHub Secrets が6種要る:
  - [ ] `GOOGLE_SERVICES_JSON_BASE64` … そのアプリ専用の Firebase プロジェクトのもの
  - [ ] `ANDROID_KEYSTORE_BASE64` / `ANDROID_KEYSTORE_PASSWORD` / `ANDROID_KEY_ALIAS` /
        `ANDROID_KEY_PASSWORD` … **必ずアプリごとに新規生成する。GymBoardのキーストアを
        使い回さない**（Play Store の署名は原則変更不可）
  - [ ] `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` … そのアプリの Play Console から発行した
        サービスアカウント（手順は `mem/features/android-ci.md`）
- [ ] Supabase プロジェクト（project ref）… **5箇所。1つでも漏れると別プロジェクトを向く**
  - [ ] `.env` の `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`
  - [ ] `supabase/config.toml` の `project_id`
  - [ ] `.github/workflows/deploy-functions.yml` の `--project-ref`
  - [ ] **`supabase/functions/mcp/index.ts` の `projectRef`** ← 見落としやすい。
        MCPサーバーの OAuth issuer になるので、間違っていると
        **別プロジェクトの issuer で認証を要求する**。型もテストも通る
  - [ ] `.lovable/mcp/manifest.json`（自動生成物だがコミットされている）

  > **merge で戻る。** これらは上流にジムボードの値が入っているので、
  > 取り込みのたびに `rrbfwitprzuevzytykrq` に戻りうる。セッコツボードでは
  > 実際に `mcp/index.ts` が戻っていた（2026-08-01）。
  > 取り込み後に必ず `grep -rn rrbfwitprzuevzytykrq --include='*.ts' --include='*.toml' --include='*.yml' --include='*.json' .`
  > で確認すること（`supabase/migrations/` の過去分と `mem/` は履歴なのでそのままでよい）。

**見た目**
- [ ] `index.html`（title / description / OGP）
- [ ] `public/manifest.json`（name / theme_color）
- [ ] アイコン・スプラッシュ一式（`npx @capacitor/assets@3 generate` — `mem/features/app-icon-splash-assets.md`）
- [ ] `src/index.css` のテーマ色

**文言**
- [ ] **業種語彙は `src/locales/vertical.ja.json` に書く**（下記）
- [ ] 法務3ページの本文（利用規約 / プライバシー / 特商法）— 事業者情報そのものは差し替えが要る
- [ ] Edge Function 側のブランド文字列（上記「地雷4」。**ここはまだ brand.ts の外**）

### ✅ 業種語彙は `src/locales/vertical.ja.json` に書く（2026-08-01〜）

「ジム→サロン」「トレーナー→セラピスト」「トレーニング→施術」のような業種語彙は、
**`src/locales/ja.json` を書き換えず**、`src/locales/vertical.ja.json` に
**変えたいキーだけ**を同じ入れ子構造で書く。深いマージで base に重なる。

```json
{
  "nav": { "training": "施術記録" },
  "booking": { "title": "施術のご予約" }
}
```

GymBoard 本体ではこのファイルは `{}`（何も上書きしない）。

`ja.json` は約1,900キーあり、フォークが直接書き換えると**上流が文言を1つ足すたびに衝突**し、
解決のたびに新しい文言を取りこぼす危険がある。オーバーレイなら
**フォークが触るのはこの1ファイルだけ**で、上流の文言追加はそのまま流入する。

他言語も差し替えたくなったら `vertical.<lng>.json` を足して
`src/locales/vertical.ts` のマップに登録すれば同じ仕組みで効く。
登録しない言語は base（＝ジム向けの語彙）がそのまま出る。

**中身は毎回考え直さず、`mem/ops/vertical-presets/` のプリセットを使う。**
業種ごとの語彙・機能ON/OFF・ブランド値を1セットにして上流に置いてある。
`src/test/verticalPresets.test.ts` が、プリセットのキーが `ja.json` に実在することを
検査しているので、上流がキーをリネームすればプリセット側が落ちて気づける。

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
| ドロップイン予約 | （フラグ無し。`DROP_IN_TENANT_ID` を `null` にすれば自動的に無効化される） | 自社ジム専用機能。通常は不要 |
| 体験予約（公開の予約フォーム・確認/キャンセルページ・トレーナー側のリンク発行・案内文編集・体験フォロー管理タブ） | `TRIAL_BOOKING_ENABLED` | **ジムボード以外の兄弟アプリは全て `false` にする**（2026-08-02決定）。ジム特有の集客手法のため |
| キャンセル待ち・定期予約 | — | 業種を問わず有用。残す |

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

## 上流のテストがフォークで落ちないようにする

上流のテストが「ジムボードの値」を断言していると、フォークで CI が恒常的に赤くなる。
するとフォークが上流のテストを編集せざるを得ず、**鉄則3に反して毎回の merge 衝突源になる**。

| 書き方 | 直し方 |
|---|---|
| UI文言のリテラル（`getByText("記録")`） | `i18n.t("nav.training")` から引く。フォークは語彙を差し替える |
| ブランド値のリテラル（`"app.gymboard.mobile"`） | `brand.ts` から引く |
| フラグの既定値（`expect(FLAG).toBe(true)`） | 挙動は `vi.doMock` で固定してから見る。既定値そのものは `upstreamOnly` へ |
| テナントUUIDが truthy | フォークは `null` にする。`upstreamOnly` へ |
| `vertical.ja.json` が `{}` | 同上 |
| ジムボード固有の設定値（プラン上限・Stripe lookup key） | 弱めず `upstreamOnly` で囲う |

`src/test/helpers/upstream.ts` の `upstreamOnly` は、`BRAND.app` を見て
フォークでは describe ごと skip する。**上流にとって意味のある回帰テストを弱めずに**
フォークを緑に保つための逃がし口。使い分けの基準はそのファイルのコメントに書いてある。

### フォーク構成での確認のしかた

上流で緑でも、フォークで落ちるかは分からない。**値をフォーク相当に差し替えて回す**のが確実:

```bash
# brand.ts / featureFlags.ts / dropInTenant.ts / legacyDefaultTenant.ts /
# vertical.ja.json を兄弟アプリの値に一時的に書き換えてから
npm test -- --run
git checkout -- src/lib/brand.ts src/lib/featureFlags.ts \
  src/lib/dropInTenant.ts src/lib/legacyDefaultTenant.ts src/locales/vertical.ja.json
```

2026-08-01 にこの手順で、静的な監査では見つからなかった2件
（`verticalOverlay.test.ts` の深いマージ検証がオーバーレイの漏れで落ちる／
`recoveryEmail.test.ts` の文字化け検証がブランド名に依存していた）を発見した。
**テストを読むだけでは足りない。実際にフォークの値で回すこと。**

## 出荷前の検査

- [ ] `ceda19b0-d5e0-4928-ab2e-996a0b823af4` がコードに残っていない
- [ ] 「ジムボード」「GymBoard」が意図しない場所に残っていない（**Edge Function とメールを特に**）
- [ ] `npx tsc --noEmit -p tsconfig.app.json` / `npm test` / `npm run build`
- [ ] **実DBのスキーマが上流の `types.ts` に追いついている**（上記「スキーマ追従は必須」）。
      **tsc もテストもビルドも全部緑のまま素通りする**ので、ここだけは実DBを見るしかない。
      最低限、予約画面を実際に開いて `get_tenant_booked_slots` が 404 にならないこと
- [ ] 実機で: プッシュ通知・メールの差出人名・体験予約リンク・課金導線（sandbox/live判定）

## 現状の限界（正直なところ）

**ブランドは `src/lib/brand.ts` に集約済み**（ロケールJSONも上流とバイト一致にできる）。
一方、**まだ集約できていないもの**が残っている:

| 残っているもの | 状況 |
|---|---|
| `capacitor.config.ts` / `index.html` / `public/manifest.json` | ビルド設定側なので `brand.ts` から読めていない。フォークごとに手で書き換える |
| `.github/workflows/ios-build.yml` | 同上 |
| `supabase/functions/**` のブランド文字列 | **Edge Function はフロントの設定を読まない**ため別管理。メール本文・件名がここ |
| `CLAUDE.md` | project ref・テナントID・アプリ名が必ず食い違う。**フォーク所有**（下記） |
| `supabase/migrations/**` | DBが別プロジェクトで履歴も別。**フォーク所有**（下記） |

（業種語彙の i18n オーバーレイと顧客側アプリの機能ON/OFF は Phase 0-B / 0-C で実装済み。
それぞれ `src/locales/vertical.ja.json` と `src/lib/featureFlags.ts` に集約されている）

**merge 時の解決方針**: 上の表のファイルで衝突したら「兄弟側を優先」でよい
（＝ブランド設定は上流から降ろさない）。それ以外のファイルで衝突したら
「業種差分をコードに書いてしまっている」サインなので、値に追い出せないか検討すること。

### `CLAUDE.md` はフォーク所有にする

「上流版を取り込んでから自分の値に書き換える」をやると、**次回以降の merge で毎回衝突する**
（project ref・テナントID・アプリ名は永久に食い違うため）。最初からフォーク所有と線引きし、
上流版は参考にするだけにすれば、以後は機械的に「フォーク側を残す」で済む。

### ⚠️ `supabase/migrations/` は取り込まない。**ただしスキーマ追従は必須**

ここは2つの別の問いが混ざりやすい。**分けて考えること。**

| 問い | 答え |
|---|---|
| 上流の migration **ファイル**をリポジトリに取り込むか | **No**（フォーク所有） |
| フォークの**DBにスキーマを適用**するか | **Yes・merge完了の必須条件** |

**ファイルを取り込んではいけない理由**（実際に上流の migration に入っているもの）:

- `ALTER COLUMN tenant_id SET DEFAULT 'ceda19b0-…'`（Salute の UUID を列既定値に焼き込む。
  `20260625100000_security_counseling_and_booking_source.sql`。ストレッチボードが実際に踏んだ）
- `IF NOT EXISTS` の無い裸の `CREATE TABLE`（フォークに同名テーブルがあると失敗する）
- 撤去済みテーブルへの `ALTER`、Salute 限定の `UPDATE`／トリガー
- 適用順序の問題（フォークが独自に進めた migration より古い日付で入ってくる）

**しかし「取り込まない」だけで終わらせると、merge したコードが動かない。**
上流のフロントは merge 後、これらのDBオブジェクトを実行時に必ず参照する:

| 依存先 | 呼んでいる場所 | 由来 migration |
|---|---|---|
| `get_tenant_booked_slots`（RPC） | **CustomerBooking.tsx / TrialBooking.tsx（予約画面の中核）** | `20260704130000` |
| `booking_waitlist`（テーブル） | CustomerBooking.tsx | `20260624120000` |
| `tenant_muscle_groups`（テーブル） | MuscleBalanceRadar.tsx | `20260723080000` |
| `tenants.booking_capacity` | CustomerBooking.tsx | `20260801000000` |
| `tenants.booking_buffer_minutes` | CustomerBooking.tsx | `20260721000000` |
| `tenants.same_day_cancel_penalty_enabled` | CustomerBooking.tsx | `20260712010000` |
| `tenants.line_url` | CustomerView.tsx | `20260718000000` |
| `tenants.google_review_url` | CustomerHome.tsx | `20260721050000` |
| `tenants.daily_summary_enabled` | TrainerGymSettings.tsx | `20260721030000` |
| `tenants.show_*`（表示ON/OFF群） | TrainerDashboard / TrainerSidebar | `20260721060000` / `20260723100000` |
| `bookings.trainer_note` | TrainerClientDetail.tsx | `20260721040000` |
| `profiles.milestone_goal` | CustomerHome.tsx | `20260708150000` |
| `tenant_plans.slot_duration_minutes` | useBookings.ts | `20260730120000` |
| `trial_bookings.follow_up_status` | TrainerTrialFollowUps.tsx | `20260721020000` |

**やり方**: 上流の `src/integrations/supabase/types.ts` が上流DBの完全なスキーマ定義なので、
**これを仕様書にしてフォーク用の追従 migration を1本手で書く**。

- 既存テーブルへの追加は `ADD COLUMN IF NOT EXISTS`
- 新規テーブルは `CREATE TABLE IF NOT EXISTS`
- 関数・RPC は `CREATE OR REPLACE FUNCTION`
- **Salute の UUID は一切含めない**（列 DEFAULT も、`WHERE tenant_id =` も）

> **「migration を書いた＝適用済み」ではない。** `mem/ops/schema-drift.md` の教訓。
> 上流でも一度「types.ts に有れば適用済み」という前提で検出テストを書いて誤り、
> 実DBを直接照会したら未適用が6件見つかった（types.ts の方が本番DBより先行しうる）。
> **適用の確認は実DBを見る以外に方法がない。**

**確認は `scripts/check-schema-applied.mjs` で自動化してある**（フォークでもそのまま使える）:

```bash
node scripts/check-schema-applied.mjs > /tmp/check.sql
# /tmp/check.sql を Supabase ダッシュボード → SQL Editor に貼って実行
# 0行なら適用漏れ無し。行が返ったらそれが足りないもの（影響の大きい順）
```

読み取り専用。フォーク独自のテーブル・カラム・関数は誤検出しない。
**クラウドセッションからは `*.supabase.co` が遮断されていてエージェントは実DBを見に行けない**ので、
「SQLを生成する側」と「実行する側」を分けてある（＝認証情報をエージェントに渡さなくてよい）。

## 兄弟アプリの現況（2026-08-01）

| | セッコツボード | ストレッチボード | ピラボード |
|---|---|---|---|
| Lovable | `fd707295-…` | `26210a2c-…` | `c841c1c0-…` |
| Supabase | 独自 | 独自 `enablfwvguohfmaampgw` | 独自 `tlfyobddatpidykkmpci` |
| GitHub 接続 | あり ✅ | あり ✅ | あり ✅ |
| リポジトリ | `project-fd707295-…` | `project-26210a2c-…` | `active-app-studio` |
| 上流との共通祖先 | **無し**（remix） | **あり**（`d0aa895`） | **無し**（remix） |
| 上流の取り込み | 済み ✅（PR #222まで） | 済み ✅（PR #1） | **未**（PR #25独自止まり。上流は#224） |
| `ja.json` | 接骨院語彙に**直接書き換え済み**（1,569キー・他言語は削除） | 上流のまま＋`vertical.ja.json` ✅ | 上流と88%バイト一致・21キー追加＋11キー変更の中途半端な状態 |
| `brand.ts` / `vertical.ja.json` | 無し（直接書き換え方式のまま） | あり ✅ | 無し |
| Phase 0-B の機能フラグ | あり ✅（`SKELETAL_DIAGNOSIS`/`GOOGLE_REVIEW`/`LANGUAGE_SWITCHER` を`false`に設定） | あり ✅（姿勢分析のみON） | 無し（独自5フラグのみ。上流の業種フラグ群は無い） |
| `sanitizeAuthNext`（認証の脆弱性修正） | あり ✅ | あり ✅ | **無し。`verifyOtp`／ハッシュ分岐／recovery導線ごと欠落**（機能欠落。merge以外に直しようがない） |
| `booking_capacity` | 未確認 | あり ✅ | 未確認 |
| Salute の tenant UUID | 除去済み ✅ | 除去済み ✅（列 DEFAULT も） | 実質空振り1件のみ（別Supabaseのため）。**merge後に2ファイル分流入するので null化が必要** |
| bundle ID / URLスキーム | `app.sekkotsuboard.mobile` ✅ | `app.stretchboard.mobile` ✅ | `app.pilaboard.mobile` ✅（既に正しい） |
| `public/manifest.json` | ジムボードのまま ❌ | 未確認 | 未確認 |
| `STRIPE_LIVE_HOSTS` | 上流のまま ❌ | 空（＝常に sandbox）⚠️ | 未確認 |
| `PRODUCTION_WEB_ORIGIN` | 自ドメイン ✅ | **上流のまま** ❌ | 未確認 |
| Firebase / プロビジョニング | ジムボードのまま ❌ | ジムボードのまま ❌ | 未確認 |
| その他 | — | — | `PushNotifications` プラグイン設定が `capacitor.config.ts` に無い（上流にはある） |

ピラボードの詳細は `mem/ops/vertical-presets/pilates.md`。他の2つより**フォークされたのが最も古く**
（2026-05-31、業種フォーク機構が実装される前）、上流との乖離が3兄弟で最大。
特に認証コールバックの機能欠落は「セキュリティ対策が無い」以上に
「メール確認・パスワード再設定そのものが動いていない」実害があるため、
業種対応より merge を優先すべき状態。

ストレッチボードの `PRODUCTION_WEB_ORIGIN` が上流のままなのは、
**まだ公開していなくて自分のURLが無い**ため。ネイティブアプリを出すまでは
表面化しないが、出した瞬間に招待・体験予約リンクが全部ジムボードを指す。
Lovable で Publish して `<slug>.lovable.app` を得たら、
`PRODUCTION_WEB_ORIGIN` と `STRIPE_LIVE_HOSTS` を**同時に**埋めること。

## 関連

- `mem/features/gymboard-saas-plans.md` … SaaS料金プランの二重定義とデプロイの注意
- `mem/features/app-icon-splash-assets.md` … アイコン・スプラッシュ生成
- `mem/features/capacitor-8-upgrade.md` … Android/iOS ビルド手順
- `mem/ops/schema-drift.md` … マイグレーション適用と types.ts
- `mem/ops/upstream-changelog.md` … **兄弟が判断すべき上流の変更の一覧。merge のたびに読む**
- `mem/ops/vertical-presets/` … 業種ごとに流し込む値の束（語彙・機能ON/OFF・ブランド）
- `mem/ops/ai-agent-sessions.md` … AIエージェントでこの作業を進めるときの取り決め
  （トークン消費・セッションの切り方・引き継ぎ文書の型・複数AIの分担）
