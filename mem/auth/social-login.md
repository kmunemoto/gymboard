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

### Supabase

- Authentication → Providers → Google / Apple を有効化
- Redirect URLs の許可リストに**両方**入れる
  - `https://app.kyoto-salute.com/auth/callback`
  - `app.gymboard.mobile://auth/callback` ← ネイティブ。忘れるとアプリだけ戻れない

### Google Cloud Console

- OAuth クライアント（ウェブアプリケーション）を作る
- 承認済みリダイレクトURI = `https://rrbfwitprzuevzytykrq.supabase.co/auth/v1/callback`
  （アプリのURLではない。**Supabase のURL**）

### Apple Developer

- Services ID を作る
- **Sign in with Apple 用の `.p8` キー**を作る

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

- [ ] `handle_new_user` の本番適用（2026-08-08 時点でコネクタ切断のため未適用）
- [ ] 管理画面の設定（上記）
- [ ] 設定後に `SOCIAL_LOGIN_ENABLED = true`
- [ ] 実機で Apple / Google 両方ログインして、`auth.identities` に行が入るか確認
