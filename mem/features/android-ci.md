# Android を iOS と同じく GitHub 管理にする（2026-08-02）

## 背景・方針

これまで iOS は `.github/workflows/ios-build.yml`（`workflow_dispatch`）で
GitHub Actions のmacOSランナー上でビルド・署名・App Store Connectへのアップロードまで
完結している。Android は逆に、`scripts/build-android.bat` でWeb側のビルドと
Gradle設定の同期まではWindows上で自動化してあるものの、そこから先
（署名付きAABの生成・Play Consoleへのアップロード）は Android Studio の
「Generate Signed App Bundle」ウィザードでの手作業だった。

**方針転換: Android もiOSと同じくGitHub Actions（`workflow_dispatch`）でビルド・署名・
Play Consoleへのアップロードまで完結させる。** Windows + Android Studio は
実機での動作確認・デバッグ用途に残るが、**公式リリースの経路としては使わない**方向にする。

下流の兄弟アプリ（セッコツボード・ストレッチボード・ピラボード）も同じ方針に揃えること
（`mem/ops/vertical-fork.md` に追記済み）。特にピラボードは現時点でこの経路が
無い状態の代表例。

## 新しいワークフロー: `.github/workflows/android-build.yml`

iOSと同じ `workflow_dispatch` 手動トリガー。`ubuntu-latest` で完結する
（AndroidビルドはmacOS不要。iOSより安く速い）。

トリガー時の入力は `track` の1つだけ:
- `track` … `internal` / `alpha` / `beta` / `production`。既定は `internal`

### バージョン表記（`versionName`）はワークフローに直書きする（2026-08-02）

**当初は `workflow_dispatch` の入力にしていたが、やめた。**
`android/` は `.gitignore` 済みなので、入力にすると**現在のバージョンがリポジトリの
どこからも読めない**。「Androidのバージョンを1つ上げて」と言われても、
Play Console か Windows の `android/app/build.gradle` を見るまで**上げようがない**
（実際にそうなって作業が止まった）。iOS は `ios-build.yml` に `MARKETING_VERSION` が
直書きしてあるので「バージョンを上げた」がコミットとして履歴に残る。
**Androidも同じ形に揃えた。**

上げ方は `android-build.yml` の `ANDROID_VERSION_NAME` を書き換えるだけ。

#### 手作業時代の実績（リポジトリに記録が無かったので残す）

| 項目 | 2026-08-02 時点の Play Console 実績 |
|---|---|
| `versionCode` | **81** |
| `versionName` | **9.0** |

`ANDROID_VERSION_CODE_BASE` を 10000 にしてあるのは、この 81 を確実に上回るため
（初回CIリリースは `10000 + 1 = 10001` になる）。

#### ⚠️ iOS とは別の版数線。統一するなら 9.x 側に上げる形になる

一度は「iOS と1本に統一する」方針にしかけたが、**実際の値を確認して取りやめた。**

| | 現在 |
|---|---|
| iOS（`MARKETING_VERSION`） | `1.4.5` |
| Android（`ANDROID_VERSION_NAME`） | **`9.1`**（9.0 の次） |

**Android の方が数字が大きい。** iOS の 1.4.x に寄せると Android のお客様には
`9.0` → `1.4.6` と**バージョンが戻って見える**。`versionName` は Play では単なる
表示文字列で順序を検査されないため、**下げても弾かれずにそのまま出てしまう。**
（App Store の `MARKETING_VERSION` は増加を要求されるので、iOS 側は事故が起きない。
Android だけがノーガード＝テストで見張るしかない）

将来どうしても揃えたいなら、**iOS を 9.x 側へ上げる**（`1.4.5` → `9.x` は増加なので
App Store も通る）。ただし一度上げたら二度と下げられないので、必要になるまでやらない。

`src/test/prepareAndroidRelease.test.ts` が見張るのは:
- iOS・Android とも `versionName` が**直書きのまま**であること（入力に戻すと現在値が読めなくなる）
- Android の `versionName` が**リリース実績（9.0）より下がっていない**こと

### `versionCode` は手作業時代の地雷を構造的に無くした

`android/` は `.gitignore` 済みで、CIは毎回 `npx cap add android` から作り直す
（＝前回の `versionCode` が見えない）。そこで **iOSの `CURRENT_PROJECT_VERSION` と
同じ発想で `github.run_number` を使う**（ワークフロー実行のたびに単調増加する
GitHub側のカウンタ）。

これにより、`capacitor-8-upgrade.md` の「やってはいけないこと」にあった
**「`android/` を作り直すと `versionCode` が1に戻り、Play Consoleに
`Version code 1 has already been used` で弾かれる」という地雷が、
設計上起こらなくなった。** 手作業のように「バージョンコードを忘れずに+1する」
という注意事項そのものが要らない。

#### ⚠️ `run_number` だけでは足りなかった（2026-08-02 修正）

上の設計には穴があった。**`github.run_number` は「そのワークフローの実行回数」なので
初回実行では 1 になる。** `android-build.yml` は新規追加のワークフローで実行回数0
（`ios-build.yml` が115回まで積み上がっているのとは違う）。一方 Play Console には
Android Studio で手作業アップロードしてきたAABが既に載っている。

つまり**初回のCIリリースは、置き換えたはずの
`Version code 1 has already been used` を経路を変えて踏み直す。**
しかも落ちるのは「10分かけてビルドし終えた最後のアップロード段」で、
CI（`ci.yml`）では絶対に検知できない。

対策として `ANDROID_VERSION_CODE_BASE`（現在 `10000`）で下駄を履かせ、
`versionCode = BASE + run_number` にした。手で +1 しながら運用してきた番号が
10000 に達することは実質ないので、初回から確実に上回る。
下駄を足しても `run_number` は単調増加のままなので、上の性質は失われない。

**もし初回アップロードでこのエラーが出たら**、Play Console に上がっている最大の
`versionCode` より大きくなるよう `android-build.yml` の `ANDROID_VERSION_CODE_BASE`
を上げること（`versionCode` は一度上げたら下げられないので、上げる方向は常に安全）。

回帰テストは `src/test/prepareAndroidRelease.test.ts`。スクリプト側の計算だけでなく、
**`android-build.yml` が実際に `ANDROID_VERSION_CODE_BASE` を渡しているか**も
YAMLを読んで検査している（配線が外れると上記のとおりCIでは検知できないため）。

### 署名: `scripts/prepare-android-release.mjs`（新規）

`scripts/patch-android.mjs` とは別スクリプトにした。`patch-android.mjs` は
「`versionCode`/`versionName` を書き換えない」ことを `src/test/patchAndroid.test.ts` が
明示的に守っている（Windows側の手作業を壊さないための不変条件）。ここに
バージョン更新と署名を混ぜると、その不変条件が読みにくくなるため分離した。

- 環境変数が無ければ何もしない（ローカルで誤って実行しても無害）
- `ANDROID_VERSION_CODE` / `ANDROID_VERSION_NAME` … `android/app/build.gradle` の
  該当行を書き換える
- `ANDROID_VERSION_CODE_BASE`（省略可・既定0）… `ANDROID_VERSION_CODE` に足す下駄。
  上の「`run_number` だけでは足りなかった」参照。上限 2100000000 を超えたら止める
- `ANDROID_KEYSTORE_PATH` / `ANDROID_KEYSTORE_PASSWORD` / `ANDROID_KEY_ALIAS` /
  `ANDROID_KEY_PASSWORD` … `signingConfigs.release` ブロックを配線し、
  `buildTypes.release` に適用する（Android Studioのウィザードが対話的にやることを
  非対話のCI向けに `build.gradle` へ書き下したもの）
- 冪等。`src/test/prepareAndroidRelease.test.ts` で検証済み

### Play Consoleへのアップロードは「公開」しない

`r0adkll/upload-google-play@v1`（サードパーティだがこの用途で広く使われている
実績のあるアクション）で `status: draft` かつ既定トラック `internal` にしてある。
**iOSの App Store Connect アップロードが自動で審査提出・公開まではしないのと
同じ安全側の既定**で、Play Console側で人間が明示的に確認して公開するまで
実際のユーザーには届かない。信頼できるようになったら `track` を `production` に
変えて呼び出せばよい（ワークフローYAML自体の編集は不要）。

## 必要な GitHub Secrets（6種）

**⚠️ 6つ全部を登録してから実行すること。1つずつだと毎回止まる。**

初回実行（2026-08-02）は `GOOGLE_SERVICES_JSON_BASE64` 未設定で57秒で失敗した。
当時は各ステップが自分の使う Secret だけを個別にチェックしていたため、
**1つ登録するたびに次のステップで落ちる**構造だった。とくに
`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` は最後のアップロード段でしか使われないので、
未登録だと**10分かけてビルドし終えてから**落ちる。

そこで **`Preflight` ステップ**を先頭（`Setup Node.js` より前）に置き、
6つまとめて検査して**足りないものを全部並べて出す**ようにした。
値そのものはログに出さない（空かどうかだけを見る）。

`src/test/prepareAndroidRelease.test.ts` が次を見張る:
- `Preflight` が `Setup Node.js` より前にあること
- ワークフローが参照する `secrets.*` が、Preflight の `env:` と `for` ループの**両方**に揃っていること
  （`env:` にだけ書いてループから漏らす、を実際に一度取りこぼしたので両方を別々に検査している）
- Secret の値を `echo` していないこと


| Secret | 内容 | base64化 |
|---|---|---|
| `GOOGLE_SERVICES_JSON_BASE64` | Firebase の `google-services.json` | **する** |
| `ANDROID_KEYSTORE_BASE64` | リリース署名用キーストア（.jks / .keystore） | **する** |
| `ANDROID_KEYSTORE_PASSWORD` | ストアのパスワード | しない |
| `ANDROID_KEY_ALIAS` | キーのエイリアス名 | しない |
| `ANDROID_KEY_PASSWORD` | キーのパスワード | しない |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | Play Console API 用サービスアカウントのJSON鍵 | **しない**（生JSONをそのまま） |

**⚠️ これらはCLAUDE.mdの「秘密情報（サービスアカウントJSON、署名鍵など）はコミットしない」に該当する。
リポジトリに直接書かず、必ずGitHub Secretsに登録すること。**

登録場所: リポジトリ → Settings → Secrets and variables → Actions → New repository secret。
**Name は大文字小文字も含めて完全一致**させること（1文字違うと「未設定」扱いになる）。

### 手作業を減らす: `scripts/setup-android-secrets.ps1`

Windows で実行すると、**6つのうち5つを自動で登録する**。

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-android-secrets.ps1
```

やること:

- `android\app\google-services.json` を自動で探し、**`app.gymboard.mobile` が入っているか確認**してから base64 化
- キーストアのパスを聞き、**`keytool` でストアのパスワードとキーのパスワードが実際に通るか検証**
  （間違っていればCIを回す前に分かる）
- エイリアスを**キーストアから読み出して**自動で埋める（複数あれば選択させる）
- GitHub CLI (`gh`) があれば `gh secret set` で直接登録。無ければクリップボード経由で1つずつ案内
- **Secret の値は画面に出さない。** `gh` へはコマンドライン引数ではなく一時ファイル経由で渡す
  （プロセス一覧に出さないため）。一時ファイルは直後に消す

`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` だけは Play Console と Google Cloud の画面操作が要るので対象外。

### base64 化の共通手順（Windows PowerShell）

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\file")) | Set-Clipboard
```

クリップボードに入るのでそのまま Secret 欄に貼る。

> **⚠️ `certutil -encode` を使わないこと。** `-----BEGIN CERTIFICATE-----` のヘッダが付き、
> ワークフローの `base64 --decode` が失敗する。改行が混ざるだけなら問題ない
> （`base64 --decode` は改行を無視する）が、ヘッダ行は無視しない。

### 1. `GOOGLE_SERVICES_JSON_BASE64`

ファイルは既に Windows のプロジェクトにある: `android\app\google-services.json`。
無ければ Firebase コンソール → プロジェクト（`gymboard-bc7f3`）→ 歯車 → プロジェクトの設定 →
全般 → マイアプリ → Android アプリ（`app.gymboard.mobile`）→ `google-services.json` をダウンロード。

上の base64 コマンドをこのファイルに対して実行する。

### 2. `ANDROID_KEYSTORE_BASE64`

**Android Studio の署名ウィザードで今まさに使っているファイルと同じもの。**
新しく作ってはいけない（Play Store の署名は原則変更不可）。

場所が分からないときは Android Studio → Build → Generate Signed App Bundle / APK →
「Key store path」に前回のパスが残っている。

上の base64 コマンドをそのファイルに対して実行する。

> Play App Signing（Google が配布用の署名を管理する仕組み）を使っている場合、
> 手元にあるのは「アップロード鍵」になる。**それで正しい。** CI がやるのは
> アップロード用の署名までで、配布用の署名は Google 側で行われる。

### 3〜5. パスワードとエイリアス

署名ウィザードで毎回入力している値をそのまま入れる。

**エイリアス名が思い出せない場合**は、キーストアから読み出せる。

```powershell
& "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" -list -v -keystore "C:\path\to\release.jks"
```

ストアのパスワードを聞かれるので入力すると、`別名 (Alias name):` に出る。
`keytool` は Android Studio 同梱の JDK に入っているのでインストール不要
（パスは Android Studio のバージョンで変わる。`jbr` が無ければ `jre`）。

**パスワードが分からない場合は詰み**（キーストアは復旧できない）。
Play App Signing を有効にしていればアップロード鍵の再設定を Google に申請できるが、
していない場合はアプリの更新自体ができなくなるので、必ず控えを取っておくこと。

### 6. `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`（新規に作る。ここだけ手数が多い）

1. **Play Console のトップ**（個別アプリではなく全アプリの画面）→ 左メニュー最下部の
   「設定」→「デベロッパー アカウント」→ **「API アクセス」**
2. Google Cloud プロジェクトが未リンクなら、ここでリンクする（新規作成でよい）
3. 「サービス アカウント」の欄 → **「新しいサービス アカウントを作成」** →
   案内に従って **Google Cloud Console** を開く
4. Cloud Console 側で: サービス アカウントを作成 → 名前を入れる（例 `play-publisher`）→
   **ロールの付与は不要**（権限は Play Console 側で与える）→ 完了
5. 作成したサービス アカウントを開く → **「キー」タブ** → 「鍵を追加」→
   「新しい鍵を作成」→ **JSON** → ダウンロード
6. **Play Console に戻って「完了」/「更新」を押す**と、一覧にそのアカウントが出る
7. そのアカウントの「アクセス権を管理」→ **アプリを `app.gymboard.mobile` に限定** →
   権限で最低限 **「リリース」系（製品版リリースの管理 / テストリリースの管理 / アプリ情報の閲覧）**
   を付与 → 招待/保存
8. ダウンロードした JSON をテキストエディタで開き、**中身をそのまま**貼る
   （**base64 化しない。** `r0adkll/upload-google-play` が生JSON文字列を期待する）

**落とし穴:**

- 権限の反映に数分かかることがある。直後に実行して権限エラーが出たら少し待つ
- 手順6を飛ばすと Play Console 側にサービス アカウントが現れず、権限を付けられない
- JSON をダウンロードできるのは作成時の1回だけ。無くしたら鍵を作り直す
- **そのアプリに一度も AAB/APK を上げたことがないと API 経由のアップロードはできない。**
  ジムボードは既に公開済み（versionCode 81 / versionName 9.0）なので該当しない

## Windows + Android Studio の扱い

**残す。** 実機での動作確認・デバッグ用途（プッシュ通知・バッジ・スプラッシュ等の
実機検証）には引き続き必要。`scripts/build-android.bat` / `scripts/patch-android.mjs`
もそのまま使える。**変わるのは「公式リリースの経路」だけ**で、
署名付きAABを手で作ってPlay Consoleにアップロードする作業はこのワークフローに置き換わる。

## 下流の兄弟アプリへの展開

`mem/ops/vertical-fork.md`「ブランド差し替えチェックリスト」に、iOSの
bundle ID / Firebase設定と並べて Android CI のセットアップを追記した。
各アプリで必要なもの:

- 独自の `google-services.json`（Firebaseプロジェクトを分ける。iOS側の地雷5-bと同じ注意）
- 独自の署名キーストア（**アプリごとに新規生成する。GymBoardのキーストアを使い回さない**。
  Play Storeの署名は原則変更不可なので、最初から各アプリ専用のものを用意すること）
- 独自のPlay Console サービスアカウント（Play Consoleのアプリごとに権限が分かれるため）
- `android-build.yml` 内の `packageName: app.gymboard.mobile` を各アプリの
  `appId`（`capacitor.config.ts`）に合わせて書き換える

## 検証状況（正直なところ）

このクラウドセッションはネイティブビルドを実行できないため
（CLAUDE.mdの前提）、**このワークフロー自体をこのセッションから実行して
グリーンを確認することはできていない。** 検証できたのは:

- YAML構文が正しいこと
- `scripts/prepare-android-release.mjs` の文字列パッチ処理が期待どおり動くこと
  （モックの `build.gradle` に対する単体テスト16件。冪等性の検証で実際に1件、
  「再実行時に誤って失敗と判定するバグ」を発見・修正済み）
- 既存の `patch-android.mjs` との責務分離・非干渉

**その後、机上の再点検で実際にバグを1件見つけた**（上の「`run_number` だけでは
足りなかった」）。`versionCode` が初回 1 になる問題で、走らせていたら初回で落ちていた。
**「テストがグリーン」はこのワークフローが通ることを何も保証しない**という実例。

**Secrets を登録したうえで、一度 `workflow_dispatch` で実際に走らせて
グリーンになることを確認すること。** 初回は `track: internal` のまま実行し、
Play Console側で内部テストトラックにAABが上がることを確認してから
本番トラックへの利用を検討する。
