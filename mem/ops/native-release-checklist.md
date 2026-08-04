# 兄弟アプリをネイティブで出すときのチェックリスト

2026-08-04、**兄弟アプリはすべてネイティブ（iOS/Android）で出す**方針になった。
複製元（ジムボード）の値が残ったままだと、**エラーを出さずに壊れる**箇所が複数ある。

対象: セッコツボード／ストレッチボード／ピラボード／ゴルフボード／鍼灸ボード／相談ボード
（今後増えたアプリも同じ）

---

## いちばん危ない事実

**`.github/workflows/*.yml` は TypeScript を import できない。**
だからネイティブの識別子と Firebase 設定は**ワークフローに直書きするしかない**。
そして **Lovable の remix はワークフローファイルを直さない。**

`brand.ts` に集約する作戦（`mem/ops/vertical-fork.md`）は、ここには効かない。

とくに `ios-build.yml` は **GoogleService-Info.plist を丸ごと inline** で持っている。
差し替え忘れると:

```
1. フォークの iOS アプリが「ジムボードのアプリ登録」として Firebase に入る
   （BUNDLE_ID / GOOGLE_APP_ID が上流のまま）
2. APNs の設定も証明書もそのアプリ登録に紐づくので、自分のアプリには届かない
3. 別プロジェクトのサービスアカウントで送っていれば SENDER_ID_MISMATCH（403）
4. send-push-notification の isInvalid はこれを無効トークン扱いしない
   → **トークンは消えず、ただ永久に届かない**
```

**プロジェクトを共用しているかどうかは関係ない。** 問題は
「アプリ登録の設定ファイルを差し替えていない」こと。

**エラーは表に出ない。** 兄弟アプリはメールを全廃する方針なので、
これがそのまま**連絡手段ゼロ**になる。

`android-build.yml` の `packageName` は **Play Console のアップロード先**。
こちらは他人のアプリ枠に上げにいく（通常は権限エラーで失敗するので、まだ気づける）。

---

## ⚠️ 先に: 取り込むファイル

**上流からの `git merge` 運用は 2026-08-03 に終了している**（`mem/ops/vertical-fork.md`）。
つまり**このファイルを読んでいるだけでは、下のテストは自分のリポジトリに入らない。**

以下を**上流（ジムボード）から自分のリポジトリの同じパスにコピーしてから**進めること。

| ファイル | 役割 | 備考 |
|---|---|---|
| `src/test/nativeAppIdentity.test.ts` | **この手順書の表を見張る本体** | **必須。** 依存なし（`vitest` と `node:fs` のみ）なので、そのままコピーすれば動く |
| `src/test/edgeFunctionProjectRef.test.ts` | Supabase の project ref が上流のまま残っていないか | **どの配布キットにも入っていない。** 無ければ一緒にコピーする |
| `src/test/edgeFunctionOrigin.test.ts` | Edge Function に上流のドメインが残っていないか | `security/` の配布キット経由で配られている。既にあれば不要 |

**`nativeAppIdentity.test.ts` を入れないと、この手順書はただの読み物になる。**
「差し替えたつもり」を機械的に検出できるのがこの手順書の value なので、
**必ず一緒に取り込むこと。**

コピーしたら `npm test` を回す。上流の値がまだ残っていれば、その時点で赤くなり、
**どこが残っているか名指しで出る**（それがそのまま作業リストになる）。

---

## 差し替える箇所

`src/test/nativeAppIdentity.test.ts` が**この表の整合性を見張っている**。
`capacitor.config.ts` の `appId` を変えた瞬間、直し忘れが名指しで赤くなる。

| # | 場所 | 何を |
|---|---|---|
| 1 | `capacitor.config.ts` | `appId`（**これが唯一の正**）、`appName` |
| 2 | `src/lib/brand.ts` | `NATIVE_APP_SCHEME` = `<appId>:` |
| 3 | `.github/workflows/ios-build.yml` | inline された GoogleService-Info.plist を**自分のアプリ登録のもので丸ごと**置き換え、`PRODUCT_BUNDLE_IDENTIFIER`、entitlements のキー、`MARKETING_VERSION`（プロジェクトを共用するなら `PROJECT_ID` / `GCM_SENDER_ID` は同じ値のままでよい。**アプリごとに必ず変わるのは `BUNDLE_ID` と `GOOGLE_APP_ID`**） |
| 4 | `.github/workflows/android-build.yml` | `packageName`、プリフライトが期待する `package_name` |
| 5 | `.github/workflows/deploy-functions.yml` | `PROJECT_REF`（`edgeFunctionProjectRef.test.ts` が見張り済み） |
| 6 | `src/lib/brand.ts` | `OWN_WEB_HOSTS`（`edgeFunctionOrigin.test.ts` が見張り済み） |

`appId` は**アプリごとに一意**であること。逆ドメイン形式（例 `app.sekkotsuboard.mobile`）。
**一度ストアに出したら変えられない。** 最初に決め切ること。

---

## 用意するもの（アプリごとに独立）

### Firebase

**1つの Firebase プロジェクトに全アプリを登録してよい**（2026-08-04 に確認）。
Firebase は「1プロジェクト × 複数アプリ」が正規の構成で、実際にそう運用している。
プロジェクトを分ける必要は無い。

- プロジェクトに **iOS アプリと Android アプリを1つずつ登録**する
  （bundle ID / package name はアプリごとに一意）
- ダウンロードした `GoogleService-Info.plist` / `google-services.json` は
  **そのアプリ登録専用**。使い回してはいけない
- **iOS は APNs キーを Firebase にアップロードする**（これが無いと iOS だけ届かない）
- サービスアカウント JSON → Supabase Secrets の `FIREBASE_SERVICE_ACCOUNT_JSON`。
  **同じプロジェクトなら1つのサービスアカウントで全アプリに送れる**

> ⚠️ **分けるのは「プロジェクト」ではなく「アプリ登録」。**
> 一度「アプリごとに新規プロジェクトを作れ」と書いたが誤り。
> 共用して困るのは**設定ファイルを使い回したとき**で、プロジェクトの共用ではない。
> `nativeAppIdentity.test.ts` も当初これを取り違えて、
> 正しく設定した兄弟アプリを誤って赤にしていた（修正済み）。

### GitHub Secrets

iOS（`ios-build.yml`）:
```
APPLE_TEAM_ID
APP_STORE_CONNECT_API_KEY
APP_STORE_CONNECT_API_KEY_ID
APP_STORE_CONNECT_ISSUER_ID
IOS_P12_BASE64
IOS_P12_PASSWORD
IOS_PROVISION_PROFILE_BASE64
```

Android（`android-build.yml`。使うなら）:
```
GOOGLE_SERVICES_JSON_BASE64
ANDROID_KEYSTORE_BASE64
ANDROID_KEYSTORE_PASSWORD
ANDROID_KEY_ALIAS
ANDROID_KEY_PASSWORD
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON
```
5つは `scripts/setup-android-secrets.ps1`（Windows）で自動登録できる。
詳細は `mem/features/android-ci.md`。

### ストア
- Apple Developer アカウント、App Store Connect にアプリ登録
- Google Play Console にアプリ登録
- **`keystore` はアプリごとに作り、絶対に紛失しない**（失うと同じアプリとして更新できない）

---

## Android のビルド経路をどうするか

ジムボード本体は **Windows + Android Studio の手作業**（`mem/features/android-ci.md`）。
これは「既に回っている経路があるから」という理由で現状維持にしただけで、
**GitHub Actions が使えないからではない。**

**ピラボードは GitHub Actions で毎回リリースしており、成功している**（2026-08-04 に確認）。
つまりこの経路は**実運用で検証済み**。兄弟アプリはこちらを使う。

手順は GitHub の Actions タブ →「Android Build & Upload」→ Run workflow →
公開トラックを選ぶだけ。**Windows も Android Studio も要らない。**

初めて使うアプリは、念のため `track: internal` で1回通してから本番トラックへ。

> **実際の手順や詰まりどころは、ピラボードのセッションが一番よく知っている。**
> Secrets の取り方（とくに `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`）は
> そちらに聞くのが早い。

---

## 確認の順番

```
0. テスト3本を上流からコピーする（「取り込むファイル」の節）
1. appId を決める（一度出したら変えられない）
2. 上の表 1〜6 を全部差し替える
3. npm test  →  nativeAppIdentity.test.ts が緑になること
4. Firebase を作り、APNs キーを上げ、Secrets を入れる
5. ビルドして **実機でプッシュが1通届くことを確認**
6. ここまで終わってから、メール全廃（別紙）に進む
```

**5 が終わるまでメールを止めない。** 「送れているつもり」が最悪の状態。

---

## なぜテストで見張るのか

ネイティブの不一致は**ビルドもテストも通る**。
実機に入れて通知を待って、初めて「来ない」と分かる。しかも
`SENDER_ID_MISMATCH` はログにしか出ず、アプリ側は無反応。

`nativeAppIdentity.test.ts` は `capacitor.config.ts` の `appId` を唯一の正として、
ワークフローの直書きがそれと一致するかを見る。
**フォークが appId を変えた瞬間に赤くなる**ので、差し替え忘れを CI で捕まえられる。

変異テストで、以下がすべて赤くなることを確認済み:
- appId だけ変更（ワークフロー直し忘れ）← **本命**
- inline plist の `BUNDLE_ID` だけ別物
- inline plist を一部だけ貼り替え（`GOOGLE_APP_ID` の sender が `GCM_SENDER_ID` と不一致）
- Play のアップロード先が別アプリ
- `brand.ts` のスキームだけズレる

**誤検出しないことも確認済み**: appId とワークフローを正しく差し替え、
Firebase プロジェクトは共用のまま、という**正しい兄弟アプリの状態で緑**になる。
