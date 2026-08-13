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
| `src/test/pushConfigGuards.test.ts` + `src/test/patchAndroid.test.ts` | 通知アイコンと Firebase プロジェクトの突き合わせ | **入れると最初は赤くなる。** 下の「通知アイコン」を先に用意すること |
| `src/test/iosSigningHardening.test.ts` | iOS の署名値を Secrets ではなくプロファイル本体から読んでいるか | `ios-build.yml` を一緒に持っていくこと。下の「プロファイルが見つからない」参照 |

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
| 7 | `.github/expected-firebase-project-id` | 自分が使う Firebase プロジェクト ID を1行だけ書く（下の「Firebase」参照） |
| 8 | `assets/notification-icon/*.png` | 自分のロゴから作った**白＋透過**の通知アイコン5枚（下の「通知アイコン」参照） |

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
  → 詰まったら下の「iOS だけ届かないときの切り分け」を見ること
- サービスアカウント JSON → Supabase Secrets の `FIREBASE_SERVICE_ACCOUNT_JSON`。
  **同じプロジェクトなら1つのサービスアカウントで全アプリに送れる**

> ⚠️ **分けるのは「プロジェクト」ではなく「アプリ登録」。**
> 一度「アプリごとに新規プロジェクトを作れ」と書いたが誤り。
> 共用して困るのは**設定ファイルを使い回したとき**で、プロジェクトの共用ではない。
> `nativeAppIdentity.test.ts` も当初これを取り違えて、
> 正しく設定した兄弟アプリを誤って赤にしていた（修正済み）。

**プロジェクトを共用するなら、`.github/expected-firebase-project-id` は全アプリで同じ値**。
分けるなら自分の値を書く。iOS / Android 両方のワークフローが、ビルド前に
設定ファイルの `PROJECT_ID` / `project_id` をこのファイルと突き合わせて、
違えば**そこで落とす**。

> ⚠️ **アプリ側の Firebase プロジェクトと、サーバ側の送信鍵
> （Supabase Secrets の `FIREBASE_SERVICE_ACCOUNT_JSON`）のプロジェクトがズレると、
> 端末にトークンは保存されるのに配信だけ 403 `SENDER_ID_MISMATCH` で無言で失敗する。**
> `send-push-notification` の `isInvalid` は 403 を無効トークン扱いしないので、
> トークンも消えず、ただ永久に届かない。ピラボードが実際に踏んだ（2026-08-04）。
> ログには出ていたが、突き合わせが人間任せで誰も見ていなかった。だから機械で見る。

### 通知アイコン（Android）

**`assets/notification-icon/ic_stat_notification-<density>.png` を5枚用意する**
（`mdpi` 24px / `hdpi` 36px / `xhdpi` 48px / `xxhdpi` 72px / `xxxhdpi` 96px）。

> ⚠️ **Android 5.0 (API 21) 以降、ステータスバーの通知アイコンは
> OS が RGB を捨ててアルファチャンネルだけを白く塗って描画する。**
> 既定アイコンを指定しないとランチャーアイコン（全面不透明）が使われるので、
> 通知は**判読できない白い塊**になる。ジムボードも 2026-08-04 まで全部この状態だった。

作り方は「ロゴのシルエットを**白一色で塗り、背景を透過**にして、上下左右に少し余白を取る」。
`scripts/patch-android.mjs` が `mipmap-*` へコピーし、`AndroidManifest.xml` に
`com.google.firebase.messaging.default_notification_icon` を注入する。
**素材が1枚でも無ければスクリプトが `exit 1` で止まる**（黙って白い塊に戻さないため）。

画像生成は**ビルド時に行わない**。Android のリリースは Windows + Android Studio の
手作業経路があり、ImageMagick 等が入っている保証が無いため、**PNG はコミットしておく**。

### GitHub Secrets

iOS（`ios-build.yml`）:
```
APP_STORE_CONNECT_API_KEY        必須
APP_STORE_CONNECT_API_KEY_ID     必須
APP_STORE_CONNECT_ISSUER_ID      必須
IOS_P12_BASE64                   必須
IOS_P12_PASSWORD                 必須
IOS_PROVISION_PROFILE_BASE64     必須
APPLE_TEAM_ID                    任意（照合用。値はプロファイル本体から読む）
```
ワークフローの先頭の Preflight が、足りないものを**ビルド前に名指しで**落とす
（以前は15分ビルドしてからアップロードで落ちていた）。

`APP_STORE_CONNECT_API_KEY` の `.p8` は
**App Store Connect → Users and Access → Integrations** で作る。
**Apple Developer の Keys 一覧には出てこない**（別サイト）。Issuer ID もこの画面にしかない。

> ★ **同じ Apple Team なら、ASC API キーは全アプリで使い回せる。**
> キーはアプリ単位ではなくチーム単位。ジムボードの3つの値をそのまま入れれば通る。
> ⚠️ ただし: `.p8` は**作成時に1回しかダウンロードできない**（増やすほど紛失事故が増える）。
> ロールは **App Manager 以上**が要る（Developer だとアップロードだけ 403 になる）。
> 新しめの ASC はキーを特定アプリに制限できるので、流用するならそこも確認する。

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

## 🔴 iOS の署名が「プロファイルが見つからない」で落ちるとき（2026-08-10）

```
error: No profile for team '***' matching '***' found:
Xcode couldn't find any provisioning profiles matching '***/***'
```

ストレッチボードがこれで3回落とした。**正体は、Secrets に入れたプロファイル名の
末尾に改行が1文字入っていたこと。**

### なぜ誰も見つけられないか

- Secrets の入力欄は **textarea**。コピー元の末尾に改行があれば、**それごと保存される**
- ログでは `***` に伏せられる。**目視では絶対に見つからない**
- 出るエラーは「プロファイルが無い」。**プロファイルが壊れている・期限切れ・
  証明書違い**と誤診する。実際そちらを全部潰してから、最後にここへ辿り着いた
- `\r`（Windows で編集した値）はもっと悪い。ログ上ではカーソルが行頭に戻るだけで、
  **改行としてすら見えない**

### 直し方は「1フィールドを直す」ではない

末尾改行は特定のシークレット固有の問題ではなく、**貼り付けで入る値すべての問題**。
base64 系は `base64 --decode` が改行を無視するので無事だが、短いスカラー値は全部壊れる:

| シークレット | 改行が入るとどうなるか |
|---|---|
| プロファイル名 | 署名で「プロファイルが見つからない」 |
| `APPLE_TEAM_ID` | `DEVELOPMENT_TEAM` と `ExportOptions.plist` の両方が壊れる |
| `IOS_P12_PASSWORD` | `security import` がパスワード違いで落ちる。**証明書が壊れているように見える** |
| `APP_STORE_CONNECT_API_KEY_ID` | **ファイル名になる**ので `AuthKey_XXXXXXXXXX(改行).p8` が作られ、鍵が見つからない |
| `APP_STORE_CONNECT_ISSUER_ID` | altool の認証が落ちる |

やることは2つ:

**1. 署名に使う値は `.mobileprovision` の現物から読む。**
プロファイル名・チームID・bundle ID は**全部プロファイルの中に入っている**。
シークレットで渡す理由が無い。`$( )` は末尾の改行を捨てるので、読み出した時点で汚れようがない。
ベタ書きの二重管理（署名側と `ExportOptions.plist` 側）も同時に消える。

```bash
security cms -D -i "$PROFILE" > profile.plist 2>/dev/null \
  || openssl smime -inform DER -verify -noverify -in "$PROFILE" -out profile.plist
# 日付はロケール依存の文字列で出るので、PlistBuddy ではなく python3 で読む
python3 -c 'import plistlib,sys; p=plistlib.load(open(sys.argv[1],"rb")); print(p["Name"])' profile.plist
```

読んだら **`capacitor.config.ts` の `appId` と突き合わせて落とす**。
上流の Secrets をそのまま引き継いだ兄弟アプリを止める、唯一の歯止めになる。

**2. 残りのシークレットは、入ってくる境界で空白を落とす。**

```bash
trim_id() { printf '%s' "${1-}" | tr -d '[:space:]'; }   # 識別子（空白を含まない）
trim_nl() { printf '%s' "${1-}" | tr -d '\r\n'; }        # パスワード（改行だけ落とす）
```

ジムボードの `ios-build.yml` がこの形になっている。そのまま持っていける。
`src/test/iosSigningHardening.test.ts` が**元に戻したら赤くなる**ので、一緒にコピーすること。

### 🔴 altool は失敗しても終了コード 0 を返すことがある（2026-08-10 に実測）

これは署名とは別の話だが、同じ「緑なのに届いていない」型なので並べておく。

ジムボードの Actions #126 のログには、はっきりこう出ていた:

```
UPLOAD FAILED with 2 errors
Validation failed (409) Invalid Pre-Release Train. …
Failed to upload package.
```

**それでもステップは緑になり、ジョブ全体も success で終わった。**
つまり「Actions が緑 = App Store Connect に届いた」は成り立っていなかった。

ネイティブは Actions を回すまでお客様に1行も届かない。ここを見逃すと、
**「直した・出した」と思い込んだまま、実際には何も届いていない**状態が作れる。
`git log` を見ても分からない。いちばん質の悪い壊れ方。

終了コードを信用せず、**出力の中身で判定すること**:

```bash
set +e
xcrun altool --upload-app -f "$IPA" -t ios --apiKey "$KEY_ID" --apiIssuer "$ISS_ID" \
  2>&1 | tee "$RUNNER_TEMP/altool.log"
ALTOOL_RC=${PIPESTATUS[0]}
set -e
if [ "$ALTOOL_RC" -ne 0 ] \
   || grep -qE 'UPLOAD FAILED|Failed to upload package' "$RUNNER_TEMP/altool.log"; then
  echo "::error::App Store Connect へのアップロードに失敗しました。"
  exit 1
fi
```

いちばん多い原因は **「そのバージョン番号が既に審査を通っている」**。
`MARKETING_VERSION` を上げれば直る。`android-version.json` と同じで、
**ワークフローに書いた版数は App Store Connect の実態と自動同期しない。**

### ⚠️ 中身を覗いて調べようとしないこと

`od -c` / `xxd` / `sed -n l` は文字列を1バイトずつに分解するので、
**GitHub のマスクをすり抜けて public のログに平文で出る**。
安全に取れるのは **`wc -c`（長さ）** と「空白が入っていたか」の真偽だけ。

### ついでに: Xcode 16 以降、プロファイルの置き場所が変わった

```
旧: ~/Library/MobileDevice/Provisioning Profiles
新: ~/Library/Developer/Xcode/UserData/Provisioning Profiles
```

**両方に置く。ファイル名は左右で変える**:

- 旧 … これまで通りの固定名。**動いている経路には触らない**
- 新 … `<UUID>.mobileprovision`。Xcode 自身がこの名前で書くので、固定名だと拾わないことがある

ワークフローが「一番新しい Xcode」を選ぶ作りだと、**コードを1行も変えていなくても
ランナーの Xcode が上がった日に落ちる**。`xcodebuild -version` は必ずログに出しておくこと。

---

## Android のビルド経路をどうするか

ジムボード本体は **Windows + Android Studio の手作業**（`mem/features/android-ci.md`）。

### ⚠️ 「ビルド」と「Play へのアップロード」は別の話（2026-08-04 にピラボードへ確認）

一度「ピラボードが GitHub Actions で毎回リリースしており、実運用で検証済み」と書いたが、
**半分は誤りだった。** 正確には:

| | ピラボードの実態 |
|---|---|
| Actions でビルド・署名 | **やっている**（実行22回・成功13回） |
| Actions から Play へアップロード | **一度もやっていない** |

ピラボードのワークフローは **署名済み AAB を artifact として出すところで終わり**で、
そこから先は**毎回 Play Console へ手でアップロード**している。

理由は `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` が用意できなかったため。
**Play Console の API アクセス画面に辿り着けず**、この1点のために自動化を諦めている。

### したがって

```
ビルド・署名の自動化   → 実績あり。安心して使える
Play への自動アップロード → 誰も通していない。未知の道
```

**兄弟アプリを立ち上げるなら、まず「Actions でビルド → AAB を手でアップロード」で始める。**
これならサービスアカウント鍵が要らず、ピラボードが22回踏み固めた経路に乗れる。
自動アップロードは、必要になってから別途取り組む。

上流の `android-build.yml` は `r0adkll/upload-google-play` で自動アップロードする形だが、
**この部分は誰も動かしたことがない。** 使うなら `track: internal` で必ず先に試すこと。

> `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` の取り方・Play Console 側の権限付与・
> 初回リリースが API から作れるかどうかは、**ピラボードも未経験**。
> 聞いても答えは出ない（2026-08-04 に確認済み）。

---

## 確認の順番

```
0. テストを上流からコピーする（「取り込むファイル」の節）
1. appId を決める（一度出したら変えられない）
2. 上の表 1〜8 を全部差し替える（通知アイコン5枚を含む）
3. npm test  →  nativeAppIdentity / pushConfigGuards が緑になること
4. Firebase を作り、APNs キーを上げ、Secrets を入れる
5. ビルドして **実機でプッシュが1通届くことを確認**（アイコンが白い塊でないことも見る）
6. ここまで終わってから、メール全廃（別紙）に進む
```

**5 が終わるまでメールを止めない。** 「送れているつもり」が最悪の状態。

---

## 🔴 成功マーカーを信じない（2026-08-12）

**2026-08-12 の1日で、同じ型の壊れ方を3回踏んだ。** 全部「緑なのに届いていない」。

| | 成功に見えるもの | 実際に起きていたこと |
|---|---|---|
| `xcrun altool` | **終了コード 0** | 標準出力に `UPLOAD FAILED`。App Store Connect に届いていない（#126） |
| `npm test` | `Tests 1115 passed (1115)` | 下に `Errors 6 errors`、**exit 1**。要約行だけ見て2回だまされた |
| `deploy-functions.yml` | `conclusion: success` ×18回 | Deploy ステップは全部 **skipped**。6週間、一度もデプロイしていなかった |

**共通するのは「成功マーカーが、確かめたいこととずれている」こと。**
確かめたいのは *届いたか* なのに、見ているのは *コマンドが終わったか* だった。

### だから、こう確かめる

| 確かめたいこと | 見るもの（成功マーカーではない） |
|---|---|
| IPA が届いたか | App Store Connect のビルド一覧に**その版が並んでいるか** |
| テストが通ったか | `npm test; echo "exit=$?"`（`Tests` 行を grep しない） |
| Edge Function が本番に居るか | 叩いて **404 かどうか**（`mem/ops/edge-function-deploy.md`） |
| プッシュが届くか | **実機に1通届くこと**（上の 5） |

### 実際に効いた（2026-08-12 追記）

`altool` の検知を入れたあと、初めてその状態でビルドしたのが **#127**
（`76dad87` / iOS 1.5.3 / 8/12 04:00Z）。Upload ステップが実行されて成功した。

**つまり #127 以降は「緑＝本当に App Store Connect に届いた」と言ってよい。**
それ以前（#126 以前）の緑にはその意味が無い。過去の記録を読むときは注意すること。

⚠️ **バージョン番号は使い回せない。** #126 が 409 で落ちたのは、直前の #125 と
同じ 1.5.1 で上げようとしたから。**アップロードが成功したら、次のビルドの前に
必ず `MARKETING_VERSION` を上げる**（上げ忘れると、また緑のまま届かない）。

#### 🔴 正確には「同じ版数だから」ではなく「**その版が承認されたから**」（2026-08-13 に訂正）

上の書き方だと「同じ `MARKETING_VERSION` では2回上げられない」と読めるが、**それは違う**。
2026-08-12 に **1.5.4 は2回アップロードに成功している**（ビルド **128** = `4dfc0f8` 09:09Z、
ビルド **129** = `1f302db` 10:49Z）。ビルド番号は `github.run_number` なので毎回変わり、
**同じ版数の中に複数のビルドが並ぶのは正常**（Apple の言う pre-release train）。

閉まるのは**審査を通ったとき**。翌 8/13 の #130 が返したのはこれ:

```
Invalid Pre-Release Train. The train version '1.5.4' is closed for new build submissions.
CFBundleShortVersionString [1.5.4] … must contain a higher version than
that of the previously approved version [1.5.4].
```

`previously **approved**` と書いてある。つまり判定は「重複か」ではなく「承認済みか」。

**なぜこの違いが効くか。** 承認はこちらの操作ではなく Apple 側で起きるので、
**版数を上げるべき瞬間はログからは分からない**。だから運用としては上の
「アップロードが成功したら次の前に必ず上げる」で正しい（上げすぎても無害）。
ただし**原因を診断するとき**にこの区別を持っていないと、
「同じ版数で2回上げたのが悪い」と誤診して、承認済みという本当の意味
（＝**その版はもうお客様に出ている**）を読み落とす。

実際 #130 の 409 は、**1.5.4 が公開済みだと知る唯一の手がかり**になった
（ストア提出はセッションから見えないので、普段は「リリースノート書いて」の合図待ち）。
409 を見たら、版数を上げる前に **App Store Connect でその版のビルド番号を確認する**こと。
同じ版数で複数ビルドが上がっていると、**どれが出荷されたかで中身が違う**
（1.5.4 の場合、128 にはチャットの LINE 化が入っておらず、129 には入っていた。
宗本さんの確認で **129** と確定）。

**そして必ず対照を1つ置く。** 「届いていると分かっているもの」が同じ手順で
届くことを見て、初めて「届かない」が本物だと言える。
2026-08-12 の Edge Function 404 も、デプロイ済みの関数2本を同時に叩いて
401 / 405 が返ることを見てから「これは本当に未デプロイだ」と判断した。

兄弟アプリでも同じ。**「緑だったので大丈夫です」と報告しない。**
何を見てそう言えるのかを書く。

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

---

## ストアの掲載名（2026-08-06 追加）

**ホーム画面のアイコン名と、ストアの掲載名は別物。混同しやすい。**

| | どこで決まるか | 上限 | 説明を足す場所か |
|---|---|---|---|
| ホーム画面のアイコン名 | `capacitor.config.ts` の `appName` | **iOS は約12文字で省略** | ❌ 読めない |
| ストアの名前 | App Store Connect / Play Console | 30 | ✅ **ここ** |
| App Store のサブタイトル | App Store Connect | 30 | ✅ |
| Play の「簡単な説明」 | Play Console | 80 | ✅ |

**検索でヒットするのはストア側。** アイコン名に説明を足しても省略されて読めない。

### `brand.ts` の `STORE_LISTING` に記録する

掲載名は**コンソールにしか無く、リポジトリのどこにも記録されていなかった**。

- 現在値を知るのにコンソールを開く必要があった
- 兄弟アプリが「上流はどう書いているか」を参照できなかった
- **文字数超過はストアに弾かれてから分かる**（審査提出の当日に判明する）

**この値はコードから使われない。** 人がコンソールに入力する作業は変わらない。
それでも置くのは上の3点のため。`src/test/storeListing.test.ts` が
上限と「製品名で始まること」を見張る（変異4種で検証済み）。

> **製品名で始めること**を検査している理由: 検索結果では後ろが省略されるので、
> 製品名が後ろにあると何のアプリか分からなくなる。

### 反映のタイミングが2つで違う

- **App Store**: 名前もサブタイトルも**審査を通らないと変わらない**。
  次のリリースに合わせて入れること
- **Play**: バージョンと独立。いつでも変えられる（審査後 数時間〜1日）

### ⚠️ 名前を変えると検索順位が一度下がる

ストアが新しい名前で評価をやり直す。数日〜2週間で戻るのが普通だが、
**複数アプリを同じ日に全部変えないこと。** 1つ変えて様子を見てから残りを変える。

### ⚠️ 機微な業種のアプリは、掲載名を強くしないほうがよい場合がある

ストアの掲載名は端末には出ないが、**アカウントの購入・ダウンロード履歴には残る**
（家族共有では家族に見えることがある）。

相談・カウンセリングのように、**利用していること自体を知られたくない**業種では、
検索でのヒットしやすさと正面からぶつかる。

```
利用者が自分で探して入れる   → 検索に効く文言
運営側から案内されて入れる   → 説明を弱める。検索は要らない
```

**どちらかを先に決めてから文言を作ること。**

---

## iOS だけ届かないときの切り分け（2026-08-06 / ピラボードの実測）

**Android が 200 で iOS だけ 401 なら、落ちているのは FCM → APNs の区間だけ。**
送信鍵・Firebase プロジェクト・トークン・Edge Function のコードは全部シロと確定する。

同じサービスアカウントで iOS と Android の最新トークンへ**同時に**テスト送信すると、
この切り分けが1回でつく（上流にも `supabase/functions/diag-ios-push` がある）。

### 🔴 応答で3状態が見分けられる

ピラボードが1手ずつ直しながら実測した。**この表が本体。**

| 状態 | iOS | 応答 |
|---|---|---|
| APNs キー**未登録** | 401 | `THIRD_PARTY_AUTH_ERROR` **のみ** |
| **キーIDが誤り**（別の鍵を上げた等） | 401 | ＋ `ApnsError { statusCode: 403, reason: "InvalidProviderToken" }` |
| 正しい | **200** | `ApnsError` が消える |

**`ApnsError` が出ていれば、キー自体は認識されている。**
そこから先は キーID・チームID・`.p8` の3つの噛み合わせだけなので、探す範囲が一気に狭まる。

### 最短の判定: そのキーIDが Apple Developer の Keys 一覧にあるか

Firebase に入っているキーIDを、**Apple Developer → Certificates, Identifiers & Profiles →
Keys の一覧と突き合わせる。** 一覧に無ければ、それは APNs キーではない。

ピラボードの実例:

```
Firebase に入っていた : U7G5BMJH4T   ← Keys 一覧に存在しない
Keys 一覧にあったもの  : U4ASLQQH2F（GymBoard Push Key）1つだけ
```

### 🔴 真犯人は App Store Connect API キーとの取り違えだった

**どちらも `AuthKey_XXXXXXXXXX.p8` という同じファイル名。**
だから **Firebase へのアップロードは成功する。** そして Apple 側で拒否される。

| どちらの `.p8` か | どこで作る | 何に使う |
|---|---|---|
| **APNs 認証キー** | Apple Developer → Keys → **APNs** を有効化 | **Firebase → APNs の認証** |
| App Store Connect API キー | App Store Connect → Users and Access → Integrations | **ビルドのアップロード**（`APP_STORE_CONNECT_API_KEY`） |

Firebase に入れたキーIDが Keys 一覧に無ければ、**もう一方に入っているはず。**

### 鍵は Team Scoped なら使い回してよい

`GymBoard Push Key` は **`Team Scoped (All topics)`** だったので、
**同じ鍵を別アプリの登録にも入れるだけで通った。** 新しい鍵は要らない。

- bundle ID ごとに鍵を作る必要はない（証明書方式とは違う）
- 既存アプリを止めずに済む
- ⚠️ **Revoke（失効）は押さないこと。** 押すと既存アプリの iOS が止まる

### なぜ気づきにくいか

**APNs キーが無くてもアプリは FCM トークンを取得し、画面は「通知ON」になる。**
CI は `GoogleService-Info.plist`・`aps-environment`・プロビジョニングプロファイルまで
検査しているが、**その先は Firebase コンソール側なので見えない。**

穴6（`pg_proc.proacl`）・穴7（DB内の関数のURL）と同じ形で、
**リポジトリを完璧にしても届かない層**にある。

> ⚠️ `send-push-notification` のログは**保持期間が短い。**
> 「あとでログを見よう」は成立しない。**その場で `diag-ios-push` を叩くのが最短。**

### 上流のコード側（`send-push-notification`）

`THIRD_PARTY_AUTH_ERROR` は **401** なので、

```ts
const isInvalid     = result.status === 404 || code === "UNREGISTERED" || ...
const isConfigError = result.status === 403 || code === "SENDER_ID_MISMATCH";
```

**どちらにも入らず、ただの `console.warn` に落ちる。**

- トークンは消えない（`isInvalid` に入らないので、そこは事故になっていない）
- **ただし `fcm.configRejected` に数えられない** → 永久に直らない設定の問題が、
  一時的な失敗と同じ見た目になる

**401 を `isConfigError` に含め、`platform` もログに出すこと**（ピラボード PR #61 の指摘）。
