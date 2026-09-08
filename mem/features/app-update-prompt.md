# アプリ更新のお願い（ネイティブのみ・必ず閉じられる）

2026-09-07 宗本さんの要望:

> 新しいバージョンをアップロードして、まだアップデートしていないお客様に
> アップデートしてもらえるように、こういう画面をアプリに出すようにしてほしい。
> それぞれボタンを押したら iOS / Android のアプリに各飛ぶように。

---

## 🔴 リリースのたびに、ここを更新しないと**一生出ない**

出す条件は「`app_releases.latest_version` が、端末で動いている版より新しいこと」。
つまり**新しい版が公開されたら、この行を上げる作業が要る**。

```sql
-- iOS。リリース済みと分かった時点で
UPDATE public.app_releases
   SET latest_version = '1.7.0',
       released_at    = now(),
       note           = '何を出した版か',
       updated_at     = now()
 WHERE platform = 'ios';
```

やるタイミングは **「リリースノート書いて」の合図**（`mem/ops/release-signal.md`）。
その時点が「その版が出た」と分かる唯一の瞬間なので、実績の記録と同じ場所に置いてある。

### 🔴 `latest_version` に入れるのは「ストアに出ている版」。リポジトリの値ではない

`.github/workflows/ios-build.yml` の `MARKETING_VERSION` は**「次に出す版」**。
リリース済みを記録した時点で次へ進める運用なので、**そこから採ってはいけない。**

2026-09-07 時点で `MARKETING_VERSION` は `1.7.0` だが、**1.7.0 は一度も
App Store に上がっていない**（Actions #150 は `Install dependencies` で落ち、
`Upload to App Store Connect` は skipped）。出ているのは 1.6.9。
ここに 1.7.0 を入れると、全 iOS 利用者に**存在しない版への更新**を促すことになる。

`src/test/appUpdatePrompt.test.ts` が「初期値が `MARKETING_VERSION` より小さいこと」を
見張っているが、**見張れるのは初期値だけ**。運用中の `UPDATE` は CI の外にある。

### 🔴 Android は分からないうちは NULL のまま

`versionName` はリポジトリにもセッションにも無い（Android Studio で直接編集し、
Play Console が唯一の正。CLAUDE.md）。**推測で入れないこと。**
NULL の間、Android には何も出ない（フェイルセーフ）。
宗本さんに Play Console の versionName を教えてもらってから入れる。

---

## 🔴 必須更新（閉じられないダイアログ）は作っていない

見本としてもらった画面には「あとで」が無かったが、**意図的に付けている。**

設計を3つの観点（ブリック／版数比較／マルチテナント）で反証したところ、
必須更新には潰しきれない経路があった:

| 経路 | 何が起きるか |
|---|---|
| Play の段階公開 | 更新が回ってきていない端末が「更新しろ」で止まる |
| 機種非対応・国別公開 | ストアに新しい版が無いのに止まる |
| OS の最低要件 | **二度と更新できない**端末が構造的に残る |
| 版数の入力ミス | 全端末が同時に止まる。復旧は本番DBの書き換え＋端末の再起動待ち |
| 店側も同じアプリ | 営業中に受付業務まで止まる |

「更新したくてもできない層」を救う手が無いので、`min_version` は**列ごと作っていない。**
`src/test/appUpdatePrompt.test.ts` が `min_version` / `forceUpdate` の再登場を見張る。

足したくなったら、先に「更新できない人をどう救うか」を決めること。

---

## 仕組み

| 置き場 | 何を持つか | なぜそこか |
|---|---|---|
| `public.app_releases`（DB） | ストアに出ている版・配信日時・有効/無効 | リリースのたびに変わる。**アプリの更新なしに変えられる必要がある** |
| `src/lib/brand.ts` の `STORE_URLS` | ストアの商品ページURL | 製品ごとに違う。DB に置くと**兄弟アプリが上流のストアへ誘導**してしまい、気づけない |

### 読み取りは RPC 経由

ログイン前の画面でも読むが、このリポジトリに **anon へ SELECT を開いたテーブルは
1つも無い**（公開データは `get_tenant_public` など SECURITY DEFINER の関数だけが返す）。
その作法に合わせ、テーブルは RLS 有効・ポリシー0本にして、
`get_app_release(text)` だけを anon に開いている。

**DB 側にもフェイルセーフを2つ置いてある。** どちらかに引っかかると 0 行 ＝ 何も出ない:

- `enabled = false`（事故ったときの止め方。**これを false にすれば即止まる**）
- `released_at` が NULL または未来（リリース前に版数だけ先に入れる事故を止める）

### 画面側

```
src/lib/appVersion.ts        版数の読み取りと比較、出す/出さないの判断
src/hooks/useAppUpdatePrompt.ts  ネイティブ判定 → getInfo → RPC → 判断 → 「あとで」の記憶
src/components/AppUpdateDialog.tsx  見た目。App.tsx 直下（LazyBoundary の外）にマウント
```

**Web では1行も動かない。** `App.getInfo()` は Web では**例外を投げる**ので、
`Capacitor.isNativePlatform()` を supabase より先に見ている。ここが逆になると
「テストは全部緑なのに exit 1」になる（CLAUDE.md の既知の罠）。
vitest も Playwright も Web なので、このフックはテスト中は何もしない。

### 🔴 版数の比較は区切りごとに数で

`1.10.0` と `1.9.0`、`9.10` と `9.5`。文字列比較や `parseFloat` だと**逆になる**。
Android は既に 9.x まで来ているので `9.10` は遠くない。

読めない形（`1.7.0 (149)` / `v1.7.0` / `1.7.0-beta` / 空白）は**読めないものとして扱い、
何も出さない**。無理に数値化すると `NaN` が黙って勝敗を決める。

### 🔴 離れすぎている値は設定ミスとみなす

iOS は 1.x、Android は 9.x。**体系がまったく別**なので、ios の行に Android の版を
貼り間違えると「9.5 に更新してください」と出てしまう（そんな iOS 版は存在しない）。
メジャーが2つ以上離れていたら出さない（`MAX_MAJOR_GAP`）。

### 出す画面を絞っている

`/` と `/auth` だけ。**許可制**にしてあるのは、新しいルートが増えたときに
黙って被さるより、黙って出ないほうが安全なため。除いているのは:

- `/auth/callback` `/billing/return` … 戻ってくる途中の中継。被せると処理が止まる
- `/trial` `/drop-in` `/join` … リンクで来た見込み客の申込み導線
- `/privacy` `/terms` `/tokushoho` `/delete-account` … 法務・削除の導線

### 「あとで」の記憶

`localStorage` に24時間。**キーに版数を含めている**（含めないと、次の新しい版が
出ても24時間は誰にも出ない）。

---

## ⚠️ 実機で1回だけ確認してほしいこと

「アップデート」ボタンは `openExternalUrl`（`Browser.open` ＝ アプリ内ブラウザ）で
ストアのURLを開く。このアプリで既に決済ページを開くのに使っている経路と同じ。

**ストアの商品ページが開いたあと、ストアアプリに移れるかは実機でしか確かめられない。**
- iOS … `https://apps.apple.com/jp/app/id6771447574`
- Android … `https://play.google.com/store/apps/details?id=app.gymboard.mobile`

もし商品ページ止まりで使いにくければ、`itms-apps://` / `market://` に切り替える手がある
（ストアアプリを直接開くが、ストアアプリが無い端末では何も起きない）。

---

## 動作確認のしかた（本番を壊さずに）

`enabled` を false にする代わりに、**自分の端末の版より上の値を一時的に入れて**確認する。
確認が終わったら必ず戻すこと。

```sql
-- 出す（自分の端末が 1.6.9 なら）
UPDATE public.app_releases
   SET latest_version = '1.7.0', released_at = now() WHERE platform = 'ios';

-- 戻す
UPDATE public.app_releases
   SET latest_version = '1.6.9',
       released_at = TIMESTAMPTZ '2026-09-03 12:54:24+00' WHERE platform = 'ios';
```

⚠️ **これは全利用者に見える。** 検証中は全 iOS 利用者にダイアログが出る
（閉じられるので実害は小さいが、短時間で戻すこと）。

---

## 運用の記録

### 2026-09-08 — 1.6.9 → 1.7.0 に上げた（初めての更新）

「リリースノート考えて」の合図で、`latest_version` を **1.7.0** にした
（Actions #152 = `3295395`。9/5 にアップロード成功、Delivery UUID
`14ba929b-c395-45a6-afe3-723ff3f78fea`）。anon を演じて 1.7.0 が返ることを確認済み。

🔴 **1.7.1 は入れなかった。** 同じ日に Actions #153（`2a1c406`）で
1.7.1 をアップロード済みだが、**公開されたかはセッションから確認できない**。
公開前の版を入れると「存在しないかもしれない版」への更新を促すことになる。
**1.7.1 の公開が分かった時点で 1.7.1 に上げること。**

⚠️ **この更新では誰にもダイアログは出ない。** 1.7.0 の人は最新なので出ないし、
1.6.9 の人にはそもそもダイアログの仕組みが入っていない（1.7.1 で初めて入る）。
**実際に出始めるのは、1.7.1 の次の版を出して `latest_version` を上げたとき。**
仕込みの版と、効き始める版が1つずれる——この機能の構造上、初回だけこうなる。

## 本番へ適用した記録（2026-09-07）

3段構えで確認済み。

```
1. 読み取り   table_exists=null / fn_count=0 / policy_count=0（未適用）
2. 適用       テーブル＋関数＋初期値2行
3. ロール演技 anon    get_app_release('ios')     → 1行
              anon    get_app_release('android') → 0行（NULL のため）
              anon    テーブル直読み             → 拒否
              anon    対照 get_tenant_public     → 1行（演技が効いている証拠）
              authenticated get_app_release('ios') → 1行
              形の縛り '1.7.0 (149)' の INSERT   → 23514 で拒否
              未来の released_at                 → 0行
```
