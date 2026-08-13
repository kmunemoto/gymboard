# Android のリリース（現状: Android Studio で手作業）

## ⚠️ 現状（2026-08-03）: このワークフローは**使っていない**

`.github/workflows/android-build.yml` は作って動く状態にしてあるが、
**ジムボードの Android リリースは従来どおり Windows + Android Studio で行う。**

**見送った理由**: 必要な GitHub Secrets が6種あり、うち
`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` は Play Console と Google Cloud をまたぐ
画面操作が必要で、準備コストが移行のメリットに見合わないと判断した（2026-08-03）。

**放置して問題ない。** `workflow_dispatch` のみなので、手で実行しない限り動かない。
下の記述はすべて「再開するときのための記録」として読むこと。

- **iOS は GitHub Actions のまま**（`ios-build.yml`）。ここは変わらない
- **兄弟アプリに強制しない。** 以前このファイルは「下流も同じ方針に揃えること」と
  書いていたが撤回した。各アプリが自分で判断する
  （ピラボードのように Android のリリース経路自体が無いアプリには、
  それでも作る価値がある）

## ⚠️ 通知アイコン（2026-08-04 に修正）

`com.google.firebase.messaging.default_notification_icon` を指定しないと、
通知には**ランチャーアイコン（フルカラー）がそのまま使われる**。
Android 5.0 (API 21) 以降、ステータスバーのアイコンは
**OS が RGB を無視しアルファチャンネルだけを使って白く塗りつぶして描画する**ため、
全面不透明のランチャーアイコンは**「白い四角の塊」**になって判読できない。

ジムボードの `assets/icon-only.png` は全面不透明なので、
**それまでの Android の通知は全部この白い塊だった**（ピラボードの報告で発覚）。

### 直し方

- 素材は `assets/notification-icon/ic_stat_notification-<density>.png`（5密度）に
  **事前生成してコミット**してある
- `scripts/patch-android.mjs` が `android/app/src/main/res/mipmap-*/` へコピーし、
  `AndroidManifest.xml` の `<application>` 内に meta-data を入れる

**patch 時に画像を生成しない**のが要点。Android のリリースは Windows + Android Studio の
手作業なので、ImageMagick 等が入っている保証が無い。**ファイルコピーだけで完結させる。**

> ピラボードは CI 側で ffmpeg を使って生成しようとして **8連続で失敗**している。
> しかも「失敗したら ImageMagick を入れる」というフォールバックを書いていたが、
> **ステップが `bash -e` なので ffmpeg の exit 127 でシェルごと死に、
> `if` に到達しなかった**。`bash -e` のステップに保険は書けない。

素材を差し替えるときは、**白＋透過**であること（アルファが無いと白い塊に戻る）。
`src/test/pushConfigGuards.test.ts` が PNG ヘッダを読んでサイズとアルファの有無を検査する。

---

## ⚠️ Firebase プロジェクトの突き合わせ（2026-08-04 に追加）

アプリに焼く `google-services.json` / `GoogleService-Info.plist` の project_id と、
サーバ側の送信鍵（Supabase Secrets の `FIREBASE_SERVICE_ACCOUNT_JSON`）の project_id が
違うと、**端末にトークンは保存されるのに配信だけ 403 SENDER_ID_MISMATCH で失敗する。**
`send-push-notification` の `isInvalid` は 403 を無効トークン扱いしないので、
**トークンは消えず、ただ永久に届かない。**

ピラボードが実際に踏んだ（`gymboard-59570` の設定が混入。
**ログには出ていたが、突き合わせが人間任せで誰も見ていなかった**）。

期待値は `.github/expected-firebase-project-id` に1箇所で持ち、
**iOS・Android 両方のビルドが不一致で落ちる**。

---

## いま実際にやっているリリース手順（Android）

1. **`android-version.json` の `versionCode` を +1、`versionName` を更新してコミット**
2. `scripts\build-android.bat`
   （git pull → npm install → build → `cap sync` → `patch-android.mjs` → `set-android-version.mjs`）
3. Android Studio でクリーンビルド → 実機で確認
4. 「Generate Signed App Bundle」で署名付きAABを生成
5. Play Console へアップロード
6. **下の「リリース実績」に記録する**（下記）

### 版数は `android-version.json`（リポジトリ管理）が唯一の記録（2026-08-05 から）

以前は手順2で **`android/app/build.gradle` を手で書き換えていた**。
`android/` は `.gitignore` 済みなので、**現在値がリポジトリのどこからも読めなかった。**

そのせいで:

- 「バージョンを1つ上げて」と言われても**上げようがない**
  （Play Console か Windows の `build.gradle` を見るまで分からない。実際にそうなった）
- `npx cap add android` で作り直すと Capacitor 既定値（`versionCode 1` / `"1.0"`）に戻る
- 上げ忘れも上げたつもりも、**Play にアップロードするまで気づけない**

いまは `android-version.json` に持ち、`scripts/set-android-version.mjs` が
`build.gradle` へ書き込む。**上げるときはこのファイルを編集してコミットする。**
「バージョンを上げた」がコミットとして履歴に残る
（iOS が `ios-build.yml` に `MARKETING_VERSION` を直書きしているのと同じ発想）。

`src/test/androidVersion.test.ts` が、実際にスクリプトを走らせて検証している
（置換・冪等性・不正値で止まること・`.bat` が呼んでいること。変異8種で確認済み）。

> ⚠️ **`android-version.json` は Play Console の実態とは自動では同期しない。**
> アップロード前に Play Console の最新 `versionCode` を確認すること。
> 既存の `build.gradle` より下げようとした場合はスクリプトが警告を出すが、
> **Play に上がっている値までは見に行けない。**

3つのスクリプトの棲み分け:

| スクリプト | 役割 |
|---|---|
| `patch-android.mjs` | Gradle / Manifest / google-services.json / 通知アイコン。**版数は触らない**（`src/test/patchAndroid.test.ts` が固定） |
| `set-android-version.mjs` | **手作業経路専用。** `android-version.json` を `build.gradle` に書く |
| `prepare-android-release.mjs` | **CI専用。** 環境変数から版数と署名設定を書く（`BASE(10000) + run_number`） |

手作業側は 82 から1ずつ、CI 側は 10000 以上。**ぶつからない**ので、
将来 CI に移行しても `versionCode` は単調増加のまま
（`androidVersion.test.ts` がこの関係を見張っている）。

### ⚠️ 2回目以降の `git pull` が止まる問題（2026-08-04 に修正）

`build-android.bat` の1回目は通るのに、2回目から必ずここで止まっていた:

```
error: Your local changes to the following files would be overwritten by merge:
        supabase/functions/mcp/index.ts
Please commit your changes or stash them before you merge.
```

`supabase/functions/mcp/index.ts` は `npm run build`（`vite.config.ts` の
`mcpPlugin()`）が**毎回生成し直す**成果物で、しかも git 追跡下にある。つまり

```
1回目: [3/5] npm run build が書き換える → 作業ツリーが汚れる
2回目: [1/5] git pull が中断
```

という形で**必ず**詰まる。`package-lock.json` は同じ理由で最初から
`git checkout --` してあったが、こちらが漏れていた。1行足して解消。

**手で直すなら生成元の `src/lib/mcp/`。** `supabase/functions/mcp/index.ts` を
直接いじっても次の build で巻き戻る。

`src/test/buildAndroidScript.test.ts` が「ビルドが作り直す成果物を pull の前に捨てる」
という不変条件を見張っている（変異テスト5パターンで確認済み）。
**`.bat` は CI でも vitest でも実行されないので、Windows で人が叩くまで誰も気づけない。**

## リリース実績（手で更新すること）

**次に出す版数は `android-version.json` を見ること**（2026-08-05 から、そこが唯一の記録）。
この表は「実際に Play へ上がったもの」の履歴として残す。

> **いつ更新するか**: 宗本さんから `リリースノート書いて` と言われたとき。
> **それがリリース完了を知る唯一の信号**で、別途の報告は来ない
> （`mem/ops/release-signal.md`）。言われたらこの表に実績を書き、
> `android-version.json` を1つ進めてから、新しい版のノートを書く。
> **「リリースしましたか？」と聞き返さないこと。**

| 日付 | versionCode | versionName | 備考 |
|---|---|---|---|
| 2026-08-02 時点 | **81** | **9.0** | Play Console で確認した実績。CI移行を検討した際に判明 |
| 2026-08-06 | **82** | **9.1** | 「リリースノート書いて」の合図で実績化。担当スタッフ機能・通知アイコン修正・予約締切の実効化・各種文字化け修正ほか（8/2〜8/6分、iOS は `MARKETING_VERSION 1.4.7` に対応） |
| 2026-08-08 | **83** | **9.2** | 「リリースノート書いて」の合図で実績化。ネイティブから決済ページへの直行（審査通過 8/7）・体験予約の料金表示とキャンセルポリシー表示・Apple/Googleアカウントでのログイン・不具合修正ほか（8/6〜8/8分、iOS は `MARKETING_VERSION 1.4.8` に対応） |
| 2026-08-09 | **84** | **9.3** | 「リリースノート書いて」の合図で実績化。Apple / Google アカウントでのログイン（**ただしネイティブでは戻ってこられない不具合あり。8/9 に修正したが、この版には入っていない**）・オーナーの profiles 欠落修正ほか（8/8分、iOS は `MARKETING_VERSION 1.4.9` に対応。ビルドは 8/8 23:11 の Actions #121 = `9f7d5be`） |
| 2026-08-10 | **85** | **9.4** | 「リリースノート書いて」の合図で実績化。会員のお金・契約・在籍状態（入金の記録・売上の実績化・休会/退会・電話番号/ふりがな・同意の記録）＋ソーシャルログインがアプリに戻らない不具合の修正（iOS の URLスキーム登録・PKCE 化）（8/9分、iOS は `MARKETING_VERSION 1.5.0` に対応。ビルドは 8/9 19:07 の Actions **#124** = `90f1947`）。⚠️ **Android を実際に Play へ上げたかは未確認**（`android-version.json` が 85/9.4 になったのは 8/10。それ以前にビルドしたなら 84/9.3）。次回アップロード前に Play Console で現物を見ること |
| 2026-08-12 | **86** | **9.5**（予定） | 「リリースノート書いて」の合図。**ただし今回は iOS だけが出た。** iOS は `MARKETING_VERSION 1.5.3`、Actions **#127** = `76dad87`（8/12 04:00Z）でアップロード成功。中身は**チャットの全面改修**（写真・動画の添付／定型文／予約の引用／共有受信箱＋通知・既読・在籍の不具合修正）。⚠️ **Android 86/9.5 はまだ Play に上げていない**（8/11 に `android-version.json` を 86/9.5 に進めたまま、ビルドは未実施）。なので**版数は上げていない**。上げる前に Play Console の実物を見ること |
| 2026-08-13 | — | — | **iOS `MARKETING_VERSION 1.5.4` = Actions #129（`1f302db`）が承認・公開済み**（宗本さんが App Store Connect で確認、2026-08-13）。中身は **PR #302＝チャットの LINE 化**（引用返信・会話内検索・送信取り消し・リアクション・日付区切り・URL のリンク化・画像の全画面表示）＋**受信者が本文を書き換えられた穴の修正**。1.5.4 は2回上がっていて（ビルド **128**＝`4dfc0f8`＝PR #301 までとビルド **129**）、**出荷されたのは 129 のほう**。判明の経緯は Actions #130 の 409（`The train version '1.5.4' is closed` / `previously approved version [1.5.4]`）→ そこで `MARKETING_VERSION` を 1.5.5 に上げた（PR #304 = `716aaa5`）。⚠️ **`612811b`（PR #303）はこの版に入っていない＝未出荷** |
| （未リリース） | 86 | 9.5 | `android-version.json` の現在値。**Android は 9.5 をまだ Play に上げていない**（8/11 に版数だけ進めたまま、ビルド未実施）。iOS の次は **1.5.5**（main は既に 1.5.5）。**1.5.5 に載るのは PR #303 だけ**＝オーナーのアカウント削除（引き継ぐ／ジムを閉じる）と Edge Function の npm import 固定。#302 は 1.5.4 で出荷済み。🔴 **#303 は Apple 5.1.1(v)「アプリ内でアカウントを削除できること」に触れる修正なので、出荷までためないこと** |

### 🔴 iOS 1.5.1 は「合図」を待たずに実績が判明した（2026-08-10）

いつもは「リリースノート書いて」でリリース完了を知る取り決めだが、この回は
**Apple 自身が教えてくれた**。8/10 に Actions を回したところ、アップロードが 409 で弾かれた:

```
Validation failed (409) Invalid Pre-Release Train.
  The train version '1.5.1' is closed for new build submissions
Validation failed (409) This bundle is invalid. The value for key
  CFBundleShortVersionString [1.5.1] must contain a higher version than
  that of the previously approved version [1.5.1]
```

つまり **iOS 1.5.1 は Actions #125（8/10 12:04 JST・`3429391`）で上がり、既に審査を通っている。**
`MARKETING_VERSION` は 1.5.2 に進めた。中身は 1.5.0 と同じ（コメント修正のみ）。

> **正直な注意**: 手で更新する記録は必ず古くなる。ここが実態と合っているか怪しいときは、
> Play Console → リリース → 製品版を見ること。
> **この記録を信じて版数を決めない。** 上げる前に必ず現物を確認する。
>
> `android-version.json` も同じで、**Play の実態とは自動では同期しない。**
> 82 は「2026-08-02 の実績 81 の次」として置いた値なので、
> **それ以降にリリースしていたら足りない。** アップロード前に確認すること。

---

# 以下は「再開するとき」のための記録

## もともとの方針（2026-08-02、いったん保留）

iOS は `ios-build.yml` でビルド・署名・App Store Connect へのアップロードまで完結している。
Android も同じくGitHub Actions で完結させ、Windows + Android Studio は実機確認用に残す、
という方針だった。**Secrets の準備コストで保留にした**（上記）。

再開するときは、下の「必要な GitHub Secrets」を揃えて
`scripts/setup-android-secrets.ps1` を流すところから始める。

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

## 検証状況

### 2026-08-04 追記: ピラボードに確認した結果（重要な訂正あり）

一度「ピラボードが実運用で成功している」と書いたが、**半分は誤りだった。**

| | ピラボードの実態 |
|---|---|
| Actions でビルド・署名 | **やっている**（実行22回・成功13回） |
| Actions から Play へアップロード | **一度もやっていない** |

ピラボードのワークフローは **署名済み AAB を artifact として出して終わり**で、
Play Console へは**毎回手でアップロード**している。
`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` が用意できず
（**Play Console の API アクセス画面に辿り着けなかった**）、
2026-08-03 に自動アップロードを外している。

**したがって、このファイルの `r0adkll/upload-google-play` を使う部分は
依然として「誰も動かしたことがない」。** 以下も**誰も未経験**:

- Google Cloud でのサービスアカウント作成手順
- Play Console 側の権限付与・反映待ち時間
- Play Console の初回リリースが API から作れるかどうか
- `Version code N has already been used` の実績（この経路を通っていないため）

**ピラボードに聞いても答えは出ない。** 自動アップロードを実現するなら、
誰かが最初に通す必要がある。

### 検証されている範囲

**ビルドと署名は実績がある。** ピラボードは `versionCode = 10000 + run_number` の
採番も含めて上流と同じ形で動かしている（ただし Play に上げていないので、
下駄が「効いた」実績ではない）。

**兄弟アプリは「Actions でビルド → AAB を手でアップロード」から始めるのが安全。**

### 上流（ジムボード）側で確認できている範囲（当初の記録）

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
