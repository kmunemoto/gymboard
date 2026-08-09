# ソーシャルログイン（Apple / Google）

## いちばん大事なこと: **実装はもとから全部入っていた**

2026-08-08 に「Apple と Google でログインできるようにしたい」という依頼を受けたが、
**調べたらコードは一式そろっていた。** `SOCIAL_LOGIN_ENABLED = false` で隠れていただけ。

| ファイル | 役割 |
|---|---|
| `src/components/SocialAuthButtons.tsx` | Apple / Google のボタン（ロゴSVG込み） |
| `src/lib/oauth.ts` | Web＝フルリダイレクト / ネイティブ＝アプリ内ブラウザ |
| `src/pages/AuthCallback.tsx` | コード交換・`postAuthRedirect` 復帰・トレーナーロール付与 |
| `src/main.tsx` | `app.gymboard.mobile://auth/callback` を受けてブラウザを閉じる |
| `src/locales/*.json` | `auth.socialApple` / `socialGoogle` / `socialDivider` / `socialError` |

ログイン・新規登録の両方、顧客タブ・トレーナータブの両方に出る。

**足りないのは Supabase / Apple / Google の管理画面の設定だけ。**
本番の `auth.identities` は 2026-08-08 時点で google 0件 / apple 0件。

> フラグを先に `true` にしないこと。プロバイダー未設定で押すと Supabase が
> `Unsupported provider` を返し、**生のエラー画面へフルリダイレクトする**
> （Web は SDK が認可URLへ遷移するのでコード側で抑止できない）。

---

## 🔴 本番に auth.users のトリガーが存在しない（2026-08-08 実測）

**これを知らないと、この先の話が全部ずれる。**

リポジトリの `20260507051932` が作るはずの
`on_auth_user_created_profile` / `on_auth_user_created_role` が**本番に無い。**

権限で見えていないだけ、という可能性は対照実験で潰した。

```
auth.users の内部トリガー      30件（見えている）
DB全体のユーザートリガー       36件（見えている）
auth.users のユーザートリガー   0件  ← 本当に無い
```

`supabase_migrations.schema_migrations` にも `20260507051932` は無く、
適用済みの最終は `20260721160949`。ただし本番の変更は Lovable の
`query_database` から直接当てている運用なので、**この表は実態を表さない。**
判断は必ず `pg_trigger` を見ること。

### 意図的に復活させない判断をした（2026-08-08）

- いまの流れ（`JoinGym` / `Onboarding` が upsert で profiles を作る）は破綻していない
- `auth.users` の AFTER INSERT トリガーは、**失敗すると新規登録そのものが止まる**。
  いま無いということは、その故障モードが存在しない状態でもある

したがって下の `handle_new_user` 修正は**現時点では不活性**。
トリガーを復活させたときに正しく動くようにしてあるだけ。

### ⚠️ 「Apple の privaterelay が顧客一覧に並ぶ」は**今は起きない**

トリガーが無いので `handle_new_user` が走らず、profiles は
`JoinGym`（お客様が名前を入力する）でしか作られない。
最初この被害を実在するものとして説明してしまったが、**誤りだった。**

---

## 🔴 `.update()` は行が無いと黙って成功する（2026-08-08 に踏んだ）

```ts
// src/pages/Onboarding.tsx（修正前）
await supabase.from("tenant_members").insert({ ..., display_name: gymName + "オーナー" });  // 入る
await supabase.from("profiles").update({ display_name: ... }).eq("user_id", user.id);       // no-op
```

profiles の行はトリガーが作る前提で書かれていた。トリガーが無いので
**エラーも出さずに0行更新で成功**し、**開設したオーナー14人ぶんの profiles が
丸ごと欠けていた**（ジム側ホームの挨拶が既定文言のままになる）。

`JoinGym.tsx` は最初から `upsert` だったので、自分で参加したお客様は無事だった。
**欠落がオーナーに偏っていたのが手がかり。**

### 実測（バックフィル前）

```
profiles が無い active メンバー   16人  … オーナー14 / お客様2
うち tenant_members に名前がある   16人  ← データは在った。写せていなかっただけ
うち予約実績がある                 0人
一度もジムに参加していない        10人  … 補完元が無いので対象外
```

5/21 以降に開設した人が全員該当。そこでトリガーが失われたと見られる。

### やったこと

1. `Onboarding.tsx` を `update` → `upsert({ onConflict: "user_id" })`
2. `tenant_members.display_name` から16件バックフィル
3. `SET LOCAL ROLE authenticated` でオーナー本人を演じ、自分の名前が読めることを確認

```
バックフィル後: profiles 47 → 63 / active メンバーの欠落 0件 / 空名 0件
```

`src/test/socialLogin.test.ts` が「profiles を作りうる経路は upsert であること」を
見張っている（`update` に戻すと赤）。

> **一般化して覚えること。** このアプリで profiles の行の存在は**保証されていない。**
> 新しく行を作りうる経路では必ず `upsert`。`update` を書いてよいのは
> 「行が在ることを直前に確かめた」ときだけ。

---

## 直したこと（2026-08-08）

### `handle_new_user` がプロバイダーの氏名を拾えていなかった

```sql
-- 変更前
COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email)
```

`display_name` を入れるのは **`src/pages/Auth.tsx:187` のフォームだけ。**
Apple も Google も `display_name` というキーは持たない。

```
Google … full_name / name（+ given_name / family_name）
Apple  … full_name。ただし**初回認可のときだけ**で、共有を拒否されると何も来ない
```

つまりソーシャル登録は **100% `NEW.email` に落ちていた。**

### 🔴 Apple の「メールを非公開」と重なると実害になる

Apple ログインは既定で `abc123@privaterelay.appleid.com` を配る。
従来のコードだと**これがそのまま顧客一覧に並ぶ。**

**メールに落とさず NULL のままにする**方針にした。理由:

- `profiles.display_name` は nullable で、UI は全箇所 `|| t("common.nameUnset")` を持つ
- `src/components/trainer/TrainerClientList.tsx` の `isUnnamed()` が NULL を拾って
  一覧で目立たせる → トレーナーが名前を埋める導線に乗る
- 逆に privaterelay を入れると「名前が入っている」ように見えて**その導線をすり抜ける**

```
display_name → full_name → name → email（privaterelay は除く）
```

通常のメール登録の挙動は変えていない（メールは意味のある識別子なので残す）。

### 🔴 ロールは metadata から読まない

`handle_new_user_role` は **metadata に関係なく必ず `'customer'`** を入れる。
OAuth のメタデータは攻撃者が細工しうるので、ここから role を読んではいけない。
トレーナー昇格は `signup-trainer`（Edge Function）が別途行う
（`AuthCallback` が `pendingOAuthRole === "trainer"` のとき呼ぶ。付与は冪等）。

`src/test/socialLogin.test.ts` がこれを見張っている（変異9件で赤を確認）。

---

## 管理画面でやること

> 以下は Supabase 公式ドキュメント（`auth-apple` / `redirect-urls`）を
> 2026-08-08 に読んで確認した内容。**うろ覚えで書いていない。**

### 🔴 Apple のシークレットは6ヶ月で切れる。ローテーションが要る

```
Apple requires you to generate a new secret key every 6 months using the
signing key (.p8 file). This is a critical maintenance task that will
cause authentication failures if missed.
```

**Supabase に入れるのは `.p8` の中身そのものではない。** `.p8` から生成した
**JWT（クライアントシークレット）**で、これに有効期限がある。
OAuth フロー（＝ジムボードが使っている方式）を使う限り必須の作業。

- **6ヶ月ごとのカレンダー登録を必ず入れること**
- `.p8` は生成のたびに要るので保管する
- ネイティブ実装だけならローテーション不要だが、ジムボードは OAuth フロー

### 🔴 OAuth フローでは Apple から氏名が**一切**来ない

```
When using the OAuth flow, the user's full name is not accessible from
Apple's response. Apple only provides the full name through native
authentication methods ... during the first sign-in.
```

「初回だけ来る」のは **Sign in with Apple JS / ネイティブ SDK** の話。
`signInWithOAuth` を使っているジムボードでは**常に来ない。**

つまり **Apple 登録者は全員 `display_name` が NULL**（メール非公開なら
メールも使えないため）。これは例外ではなく**通常ケース**。
`JoinGym` で名前を入力させる導線が、Apple 経路の唯一の名前の入り口になる。

### Apple Developer（必要なもの6つ）

1. **Team ID**（10桁）。既存の `APPLE_TEAM_ID` と同じもの
2. **Email Sources の登録** — Services セクション。
   これが無いと `@privaterelay.appleid.com` 宛のメールが届かない
3. **App ID** = `app.gymboard.mobile`。Capabilities で Sign in with Apple を有効化。
   ⚠️ **Server-to-Server notification endpoint は空のままにする**
   （Supabase が未対応）
4. **Services ID**（例 `app.gymboard.mobile.web`）。これが Supabase の Client ID になる
5. Services ID の **Website URLs**（🔴 下の「リダイレクト先はプロバイダーごとに違う」
   を先に読むこと。**Apple と Google で別の値**）
   - Domains: `oauth.lovable.app,gymboard.lovable.app,app.kyoto-salute.com`
   - Return URLs:
     ```
     https://oauth.lovable.app/callback
     https://gymboard.lovable.app/~oauth/callback
     https://app.kyoto-salute.com/~oauth/callback
     ```
   - ⚠️ **カンマ区切りで入れること。** 欄の説明が "comma delimited list" で、
     改行だけだと1本目しか登録されない恐れがある。Next の次の確認リストで
     3本並んでいるか目視する
   - ⚠️ 最後に **Save** まで押す（Next → Done → Continue → Save）
6. **署名キー（Keys → Sign in with Apple）** → `.p8` を保管する。
   シークレット（JWT）は Lovable の「Generate secret」でも作れるが、
   2026-08-08 は**上流セッションが openssl で生成して渡した**（検証済み）。
   ```
   header  {"alg":"ES256","kid":<Key ID>}
   payload {"iss":<Team ID>,"iat":…,"exp":iat+180日,
            "aud":"https://appleid.apple.com","sub":<Services ID>}
   ```
   `cryptography` は壊れているので `openssl dgst -sha256 -sign` で署名し、
   DER を r‖s の64バイトへ変換する。生成後は公開鍵で必ず検証すること
   （改ざん版が落ちることまで確認する）

> ### 🔴 `.p8` が3種類になる
>
> | 種類 | どこで作る | 何に使う |
> |---|---|---|
> | APNs 認証キー | Keys → APNs | Firebase → プッシュ通知 |
> | App Store Connect API キー | ASC → Users and Access → Integrations | ビルドのアップロード |
> | **Sign in with Apple キー** | Keys → Sign in with Apple | **これ。Supabase のシークレット生成** |
>
> **全部 `AuthKey_XXXXXXXXXX.p8` という同じファイル名。**
> ピラボードが前2つを取り違えて、プッシュが永久に届かない状態になった
> （`mem/ops/native-release-checklist.md:338-357`）。

---

## 🔴 リダイレクト先は**プロバイダーごとに違う**（2026-08-08 に2回間違えた）

**Apple と Google で違った。** 推測すると必ず外す。

```
Apple   https://oauth.lovable.app/callback
        https://gymboard.lovable.app/~oauth/callback
        https://app.kyoto-salute.com/~oauth/callback
                                      ↑ Lovable の OAuth プロキシ経由

Google  https://rrbfwitprzuevzytykrq.supabase.co/auth/v1/callback
                                      ↑ 素の Supabase
```

Apple 側の Domains は `oauth.lovable.app` / `gymboard.lovable.app` / `app.kyoto-salute.com`。

### 私が2回間違えた経緯

1. **1回目**: Supabase 公式ドキュメントどおり「Return URL は
   `https://<ref>.supabase.co/auth/v1/callback`」と手順書に書いた
   → **Apple では誤り**（Lovable のプロキシが正）
2. **2回目**: その反省から「Lovable Cloud では Supabase の URL を使わない」と
   **一般化した**。Lovable の Google 設定画面も Apple と同じ3本を
   「これを登録してね」と表示していたので、それを信じた
   → **Google では誤り**（素の Supabase が正）。`redirect_uri_mismatch` で判明

**Lovable の設定画面に出ている「登録してね」の一覧すら、Google では実態と違った。**

> ### 教訓: エラーが返す `redirect_uri` を読むのが唯一確実
>
> ドキュメントでも設定画面でもなく、**実際に送られた値**を見る。
> `redirect_uri_mismatch` のエラーページの URL に入っている `authError=` を
> base64 デコードすると、送信された `redirect_uri` がそのまま入っている。
>
> ```python
> import base64
> d = base64.urlsafe_b64decode(blob + "=" * (-len(blob) % 4))
> # → redirect_uri: https://....../auth/v1/callback
> ```
>
> **兄弟アプリも全部 Lovable なので、同じ確認を毎回やること。**
> 「ジムボードではこうだった」も当てにしない。

### 認証情報は「自前」を選ぶこと（マネージドを選ばない）

Lovable Cloud には「マネージド Apple ログイン」（Lovable の認証情報を使う）が
あるが、**ジムボードでは選んではいけない。**

1. **Apple の `sub` は開発チーム単位。** Lovable のチームで運用してから自前へ
   移すと、**既存ユーザー全員の識別子が変わって別人になる**
2. Services ID の Primary App ID が `app.gymboard.mobile` であることが
   「このアプリの Sign in with Apple」の根拠。マネージドだと別チームの別アプリに紐づく
3. Email Sources に登録した `notify.kyoto-salute.com` は**自チームのもの**。
   マネージドだとリレーが別チーム経由になり、非公開メールのお客様に届かない

BYOC の場所（Lovable のエージェントに教えてもらった実パス）:

```
Users → Authentication Settings → Sign In Methods → Apple
     → 「Use your own credentials」
```

### 「Allow users without an email」は ON にする

同じ画面にあるトグル。既定 **OFF**。
「Allow users to hide their email when signing in with Apple」

Apple の同意画面では**お客様が「メールを非公開」を選べて、こちらから禁止できない。**
OFF のままだと、非公開を選んだ人がログインできない可能性が高い。

受け入れ側は用意済み: Email Sources 登録済み ✅ ／
`display_name` が NULL でも「名前未設定」で処理される ✅。

### Redirect URLs（アプリへの戻り先）

Lovable の許可リストを読んでもらったところ、**Web 側は既にカバー済み**だった。

```
https://app.kyoto-salute.com/**        ← /auth/callback を含む。追加不要
https://gymboard.lovable.app/**
https://preview--gymboard.lovable.app/**
（各 preview / lovableproject ドメイン）
```

**不足していたのは1本だけ。**

```
app.gymboard.mobile://auth/callback    ← ネイティブ。無いとアプリだけ戻れない
```

> ワイルドカードの区切り文字は `.` と `/`。`*` は1階層、`**` は全階層。

### Google Cloud Console

- OAuth クライアント（**ウェブアプリケーション**）を1つだけ作る
- **iOS/Android 用のクライアントは要らない。** ネイティブでも `signInWithOAuth`
  （＝サーバ経由の Web OAuth）なので、Google から見ると常にウェブ1本。
  アプリが Google と直接話す経路が無い
- 承認済みリダイレクトURI は **`https://rrbfwitprzuevzytykrq.supabase.co/auth/v1/callback`**
  （2026-08-08 に実測。Apple とは違う。上の「プロバイダーごとに違う」を参照）
- 🔴 **OAuth 同意画面の「対象」を「外部」にする。** 組織 `kyoto-salute.com` があるため
  既定が「内部」になりやすく、内部のままだと `@kyoto-salute.com` の人しかログインできない
- 🔴 **公開ステータスを「本番環境」にする。** テストのままだとテストユーザー以外は弾かれる。
  スコープが `email` / `profile` のみ（非機密）なので審査なしで公開できる
- 「OAuth ユーザー数の上限 100」の表示は**無視してよい**。
  未承認の機密スコープを要求する場合の制限で、非機密のみなら適用されない
- クライアントは `gymboard`（`gymboard-59570`）プロジェクトに作った。
  `salute-seo` / `Salute` は別事業のプロジェクトなので使わない

> ### 🔴 `.p8` が3種類になる
>
> | 種類 | どこで作る | 何に使う |
> |---|---|---|
> | APNs 認証キー | Keys → APNs | Firebase → プッシュ通知 |
> | App Store Connect API キー | ASC → Users and Access → Integrations | ビルドのアップロード |
> | **Sign in with Apple キー** | Keys → Sign in with Apple | **今回。Supabase に入れる** |
>
> **全部 `AuthKey_XXXXXXXXXX.p8` という同じファイル名。**
> ピラボードが前2つを取り違えて、プッシュが永久に届かない状態になっている
> （`mem/ops/native-release-checklist.md:338-357`）。

- **Email Sources に送信ドメインを登録する。**
  `@privaterelay.appleid.com` 宛のメールは、登録していないと Apple が捨てる。
  ジムボードは予約確認・リマインドをメールで送るので、忘れると
  **「Apple で登録したお客様にだけメールが届かない」**という気づきにくい壊れ方をする。

---

## ネイティブの実装が正しい理由（触るときの注意）

```ts
// src/lib/oauth.ts
const { data } = await supabase.auth.signInWithOAuth({
  provider, options: { redirectTo, skipBrowserRedirect: true },
});
await Browser.open({ url: data.url });   // @capacitor/browser
```

**Google は埋め込み WebView での OAuth を弾く**（`disallowed_useragent`）。
`@capacitor/browser` は SFSafariViewController / Chrome Custom Tabs を開く
＝システムブラウザなので通る。`skipBrowserRedirect` を外すと
アプリの WebView 内で遷移してしまい Google に弾かれる。

`redirectTo` は `getAuthCallbackUrl()` 経由。**直書きしないこと**
（フォークのログインが上流へ飛ぶ）。

---

## Apple のガイドライン 4.8

サードパーティのログイン（Google）を出すなら、iOS では
**Sign in with Apple も併せて提供する必要がある。** 両方入っているので問題ない。
片方だけ有効化しないこと。

---

## 残っていること

- [x] `handle_new_user` の本番適用（2026-08-08 適用。トランザクション内で一時トリガーを
      張って7ケース通し、ROLLBACK で後片付けまで確認）
- [x] オーナー14人＋お客様2人の profiles バックフィル
- [ ] 管理画面の設定（上記）
- [ ] 設定後に `SOCIAL_LOGIN_ENABLED = true`
- [ ] 実機で Apple / Google 両方ログインして、`auth.identities` に行が入るか確認
- [ ] 一度もジムに参加していない10人の profiles（補完元の名前が無いので保留）

### 検証に使った形（トリガーが無い関数をどう確かめるか）

誰からも呼ばれない関数は、**検証のあいだだけトリガーを張って ROLLBACK する。**

```sql
BEGIN;
CREATE TRIGGER tmp_verify AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
VALUES ('00000000-0000-4000-a000-000000000001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','taro@gmail.com','{"full_name":"山田 太郎"}'::jsonb, now(), now());
SELECT display_name FROM public.profiles WHERE user_id = '00000000-0000-4000-a000-000000000001';
ROLLBACK;   -- DDL も含めて巻き戻る
```

通した7ケース: Google氏名 / Apple非公開・名前なし（NULL）/ Apple非公開・名前あり /
display_name 優先 / 通常メール / 大文字 PrivateRelay（NULL）/ 空白だけの氏名は素通り。

---

## 🔴 2026-08-09: ネイティブで「戻ってこられない」＋セッションが漏れていた

実機（App Store 版）で宗本さんが発見。**メール＋パスワードは正常にアプリ内で完結するのに、
Apple / Google だけアプリ内ブラウザ（SFSafariViewController）から戻れず、
Web 版（app.kyoto-salute.com）に着地してそこで操作できてしまっていた。**

「戻れない」だけの話ではなかった。**故障は3つ重なっていた。**

| | 故障 | 状態 |
| --- | --- | --- |
| A | Redirect URLs 許可リストに `app.gymboard.mobile://auth/callback` が無く、Site URL にフォールバック | 推定（コンソール確認が要る） |
| B | iOS の `CFBundleURLTypes` にスキームが**登録されていない** | **確定** |
| C | `flowType` 未指定＝**implicit** で、トークンが URL フラグメントで外部ブラウザに渡っていた | **確定** |

### B: スキームはどこにも登録されていなかった

- Capacitor の iOS テンプレート（`node_modules/@capacitor/cli/assets/ios-pods-template.tar.gz`
  の `App/App/Info.plist`）を**実際に展開して全17キーを列挙**。`CFBundleURLTypes` は無い。
- `cap add` も `cap sync` も足さない（CLI 8.4.2 の dist を grep して0件）。
- `ios/` は `.gitignore` 済みで、毎ビルド `npx cap add ios` でまっさらに再生成される。
  **Xcode で手で足しても残らない。**
- Android も同じ穴（`android-template` の AndroidManifest に VIEW は0件、
  `strings.xml` の `custom_url_scheme` は既定値のまま）。

→ `.github/workflows/ios-build.yml` に PlistBuddy のステップを追加。
   `scripts/patch-android.mjs` に intent-filter の追加を実装。

### C: supabase-js の既定は PKCE ではない

**`@supabase/auth-js` 2.108.2 の `dist/module/GoTrueClient.js:21` は `flowType: 'implicit'`。**
PKCE が既定なのは `@supabase/ssr` であって supabase-js ではない。ここを取り違えていた。

implicit だと戻りが `#access_token=...&refresh_token=...` になり、
**その URL を開いたブラウザが誰であれログインしてしまう**
（`GoTrueClient.js:3262` の `_isImplicitGrantCallback` はパスすら見ない）。
そして **SFSafariViewController は Safari とデータストアを共有する**ので、
セッションが端末の Safari 側に残る。

→ `src/integrations/supabase/client.ts` に `flowType: 'pkce'` を明示。
   PKCE なら verifier を持たないブラウザは `?code=` を使えないので
   （`GoTrueClient.js:3271`）、同じ事故が起きても「ログインできない」で止まり漏れない。

**⚠️ `client.ts` は「automatically generated」。再生成で `flowType` が黙って消える。**
`src/test/nativeAppIdentity.test.ts` に落ちる検査を置いた。

### 実害の範囲（本番DBで確認・2026-08-09）

```
auth.identities:  email 59 / google 1 / apple 1
OAuth 由来の auth.sessions: 6件、すべて 5wz7892v8d@privaterelay.appleid.com
                            （宗本さんのテスト用 Apple アカウント）
                            6件とも refreshed_at IS NULL
```

**お客様の被害はゼロ。** OAuth を使ったのは宗本さんのテストアカウントだけだった。
`refreshed_at` が全件 NULL＝**どのセッションもアプリの中で生き続けたことがない**、
というのが「戻れていない」ことの実測証拠でもある。

### PKCE 切替で危うく作りかけた別の壊し方

`detectSessionInUrl`（既定 true）は、PKCE では**クライアント初期化時に自分で
`?code=` を交換してしまう**。そうすると `AuthCallback.tsx` の明示的な
`exchangeCodeForSession` は「code が既に使われている」で必ず失敗する。
**そこでセッションは既にある。** 旧コードはここで即 `/auth` に飛ばしていたので、
そのまま出すと「ログインできているのにログイン画面へ戻される」になっていた。
→ 諦める前に `getSession()` で確認する形に変更。検査も追加（socialLogin.test.ts）。

### 決済の前例は根拠にならなかった

「決済（8/7 審査通過）でディープリンク復帰が動いているからスキームは効いている」は**誤り**。
`src/pages/BillingReturn.tsx:44-51` に
`/* スキームが登録されていない環境では何も起きない。手動ボタンに委ねる */` とあり、
**不発でも成立するように設計されていた**（画面に「決済は完了」と出る＋手動ボタン＋
SFSafariViewController なので X で必ず戻れる）。
認証だけが詰むのは、X で閉じて戻ってもアプリ側にセッションが無いから。

`mem/features/native-checkout.md:50` の「ディープリンクが効かない場合（プライベート
ブラウズ等）」という記述は、**実際には常に不発だった可能性が高い**。

### まだ人がやること

- [ ] Redirect URLs に `app.gymboard.mobile://auth/callback` を追加し、**目視で確認**する
      （2026-08-08 のコミット 660ca13 で同じ依頼をしたが、入ったかの記録が残っていない）
- [ ] Site URL の実値を控えてここに書く（記録が1件も無い）
- [ ] 次の iOS リリース後、実機で Apple / Google 両方のログインがアプリに戻るか確認
- [ ] メモ帳に `app.gymboard.mobile://billing?status=success` と書いてタップ →
      アプリが起動すればスキーム登録が効いている
