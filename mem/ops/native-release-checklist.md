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
1. フォークの iOS アプリが「ジムボードの Firebase プロジェクト」に登録される
2. 発行トークンはジムボードの sender のもの
3. フォーク自身の FIREBASE_SERVICE_ACCOUNT_JSON で送ると SENDER_ID_MISMATCH（403）
4. send-push-notification の isInvalid はこれを無効トークン扱いしない
   → **トークンは消えず、ただ永久に届かない**
```

**エラーは表に出ない。** 兄弟アプリはメールを全廃する方針なので、
これがそのまま**連絡手段ゼロ**になる。

`android-build.yml` の `packageName` は **Play Console のアップロード先**。
こちらは他人のアプリ枠に上げにいく（通常は権限エラーで失敗するので、まだ気づける）。

---

## 差し替える箇所

`src/test/nativeAppIdentity.test.ts` が**この表の整合性を見張っている**。
`capacitor.config.ts` の `appId` を変えた瞬間、直し忘れが名指しで赤くなる。

| # | 場所 | 何を |
|---|---|---|
| 1 | `capacitor.config.ts` | `appId`（**これが唯一の正**）、`appName` |
| 2 | `src/lib/brand.ts` | `NATIVE_APP_SCHEME` = `<appId>:` |
| 3 | `.github/workflows/ios-build.yml` | inline された GoogleService-Info.plist **ごと**（API_KEY / GCM_SENDER_ID / BUNDLE_ID / PROJECT_ID / STORAGE_BUCKET / GOOGLE_APP_ID）、`PRODUCT_BUNDLE_IDENTIFIER`、entitlements のキー、`MARKETING_VERSION` |
| 4 | `.github/workflows/android-build.yml` | `packageName`、プリフライトが期待する `package_name` |
| 5 | `.github/workflows/deploy-functions.yml` | `PROJECT_REF`（`edgeFunctionProjectRef.test.ts` が見張り済み） |
| 6 | `src/lib/brand.ts` | `OWN_WEB_HOSTS`（`edgeFunctionOrigin.test.ts` が見張り済み） |

`appId` は**アプリごとに一意**であること。逆ドメイン形式（例 `app.sekkotsuboard.mobile`）。
**一度ストアに出したら変えられない。** 最初に決め切ること。

---

## 用意するもの（アプリごとに独立）

### Firebase
- **アプリ専用の Firebase プロジェクトを作る。** ジムボードのものを共用しない
- iOS アプリと Android アプリを登録 → `GoogleService-Info.plist` / `google-services.json`
- **iOS は APNs キーを Firebase にアップロードする**（これが無いと iOS だけ届かない）
- サービスアカウント JSON を発行 → Supabase Secrets の `FIREBASE_SERVICE_ACCOUNT_JSON`

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
6アプリ分を手作業で回すのは現実的でないので、**兄弟アプリは `android-build.yml` を
使うほうが合う**。

ただし **このワークフローは一度も実際に走らせていない**（`mem/features/android-ci.md`
の「検証状況（正直なところ）」）。最初に使うアプリは:

1. Secrets 6種を登録
2. **`track: internal` のまま** `workflow_dispatch` で1回走らせる
3. Play Console の内部テストトラックに AAB が上がることを確認
4. そこで初めて本番トラックを検討

**いきなり production で回さない。**

---

## 確認の順番

```
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
- iOS の Firebase PROJECT_ID が appId と無関係
- inline plist の BUNDLE_ID だけ別物
- Play のアップロード先が別アプリ
- `brand.ts` のスキームだけズレる
