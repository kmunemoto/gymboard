# 上流の変更で、兄弟アプリが判断する必要があるもの

兄弟アプリ（業種フォーク）が `git merge upstream/main` したときに、
**「これは自分のアプリに要るのか？要るなら何をするのか？」を判断すべき変更**だけを並べる。

## なぜこれが要るのか

コードは merge で降りてくるが、**降りてきたことに気づけない**。
機能フラグは既定値のまま、新しい設定は既定値のまま、必要な作業は誰も知らないまま埋もれる。

実際にこうなった:
- `TRIAL_BOOKING_ENABLED` … 上流に入れたが、伝えるまで兄弟は誰も `false` にしていなかった
- `tenants.booking_capacity` … 入れた翌日に本番を見たら**14テナント全部が既定のまま**だった

**上流で作っただけでは届かない。** ここに書いて、merge のたびに読んでもらう。

## 使い方

**フォーク側**: `git merge upstream/main` したら、前回の merge 以降の項目を上から読む。
「全兄弟で必要」は原則やる。「業種による」は自分の業種で判断する。

**上流側（このリポジトリで作業する人・エージェント）**:
兄弟が判断すべき変更を入れたら、**PRと同じコミットで**ここに1件足す。
判断が要らないもの（内部リファクタ・上流だけのバグ修正・ドキュメント整理）は書かない。
**全部書くと読まれなくなる。**

書式は、新しいものを上に:

```
### YYYY-MM-DD (#PR番号) 見出し
**要否**: 全兄弟で必要 / 業種による / ジムボード専用
何をするか（1〜3行）。詳細は該当の mem/ へリンク。
```

---

### 2026-08-02 (#239) Android CI の初回リリースが Play に弾かれるバグを修正
**要否**: **Android を GitHub Actions でリリースする全兄弟で必要**（#235 を取り込んだアプリ）

`android-build.yml` の `versionCode` は `github.run_number` だった。これは
**「そのワークフローの実行回数」なので初回は 1** になり、Android Studio で
手作業リリースしてきたアプリでは Play Console が
`Version code 1 has already been used` で弾く。しかも落ちるのは
**10分ビルドし終えた最後のアップロード段**で、`ci.yml` では検知できない。

`ANDROID_VERSION_CODE_BASE`（`10000`）で下駄を履かせて修正。
そちらでも `android-build.yml` を取り込んでいるなら、**merge するだけで直る**
（値の調整は不要。手で採番してきた `versionCode` が 10000 に達していれば別）。
詳細は `mem/features/android-ci.md`。

### 2026-08-02 (#239) `versionName` をワークフローに直書きし、iOS と1本の版数線に統一
**要否**: **やり方は全兄弟で推奨 / 番号自体は各アプリ独自**

`versionName` を `workflow_dispatch` の入力にしていたのをやめ、`android-build.yml` に
直書きした。`android/` は `.gitignore` 済みなので、**入力にすると現在のバージョンが
リポジトリのどこからも読めない**（「バージョンを1つ上げて」と言われても上げようがない）。
直書きにすると「上げた」がコミットとして履歴に残る。iOS が `MARKETING_VERSION` を
直書きしているのと同じ形。

あわせてジムボードでは **iOSとAndroidの採番を1本に統一**した（`versionName` は Play では
表示文字列で順序制約が無いため、途中から揃えても弾かれる心配は無い）。
管理する番号が1本になるのでおすすめだが、**番号そのものは各アプリの現在値から始めること。**
`android-build.yml` を merge したら `ANDROID_VERSION_NAME` を**自分のアプリの値に必ず直す**
（ジムボードの `1.4.6` がそのまま降ってくる）。

`src/test/prepareAndroidRelease.test.ts` が「iOS/Android とも直書きのまま」「メジャー・
マイナーが一致」を見張る。統一しない方針にするなら後者のテストは外してよい。

### 2026-08-02 (#236, #237) 同時に複数の予約を受けられる設定に、店が気づけるようにした
**要否**: **全兄弟で必要**

1人で回す店と複数人で回す店は**同じ業種の中に両方ある**ので、業種では決まらない。
「どちらでも正しく動き、実態と設定がずれていたら店が気づける」形にした。3経路とも
コードは merge でそのまま降りるが、**文言に「ジム設定」が入るのでオーバーレイが要る**。

- オーバーレイ対象: `onboarding.fieldCapacity` / `fieldCapacityHint` /
  `schedule.errorSlotTakenCapacityHint` / `waitlistAlert.*`
  （`personal-stretch` と `pilates` のプリセットには追加済み。セッコツボードは要対応）
- **`booking_capacity` 列が本番DBに適用済みか確認すること**（`scripts/check-schema-applied.mjs`）
- 詳細: `mem/features/booking-capacity.md`

### 2026-08-02 (#235) Android のリリースも GitHub Actions で行う方針にした
**要否**: **全兄弟で必要**（ただし急ぎではない）

`.github/workflows/android-build.yml` が merge で降りてくる。各アプリで:
`packageName` を自分の `appId` に書き換え、**アプリ専用の**署名キーストア・Firebase・
Play Console サービスアカウントを GitHub Secrets に登録する。
**GymBoard のキーストアを使い回さないこと**（Play Store の署名は原則変更不可）。
詳細: `mem/features/android-ci.md`

### 2026-08-02 (#233) 上流のテストがフォークで落ちないようにする番人を入れた
**要否**: 全兄弟で自動的に効く（作業は不要）

`src/test/forkHostileTests.test.ts` が、テスト内の日本語リテラルのうち
`ja.json` に実在するものを検出して落とす。**フォークで新しく落ちたら上流のバグ**なので、
`ALLOWED` に足して黙らせずに**上流へ報告すること**。

### 2026-08-02 (#229) スキーマ適用チェックのSQLを生成するスクリプトを追加
**要否**: **全兄弟で必要**

`node scripts/check-schema-applied.mjs > /tmp/check.sql` で検査SQLを作り、
Supabase の SQL Editor に貼る。0行なら適用漏れ無し。読み取り専用。
**「migration がリポジトリにある＝本番DBに適用済み」ではない**（この種の欠落は
tsc・テスト・ビルドが全部緑のまま素通りする）。詳細: `mem/ops/schema-drift.md`

### 2026-08-02 (#228) `supabase/migrations/` はフォーク所有。ただしスキーマ追従は必須
**要否**: **全兄弟で必要**

上流の migration **ファイル**は取り込まない（Salute の UUID を列既定値に焼き込むもの等が
混ざっている）。**しかしスキーマ自体は適用しないと merge したフロントが動かない**
（`get_tenant_booked_slots` など14個以上のDBオブジェクトを実行時に参照する）。
上流の `types.ts` を仕様書にして追従 migration を1本手で書く。
詳細: `mem/ops/vertical-fork.md`

### 2026-08-02 (#227) 体験予約を業種フラグ化した（`TRIAL_BOOKING_ENABLED`）
**要否**: **ジムボード以外は全て `false`**（方針決定済み）

`false` にしてもデータ・Edge Function・DBは消えない。ただし
**公開ページは残り「現在受け付けていません」の案内がお客様の目に触れる**ので、
`trialBooking.notAvailableTitle` / `notAvailableBody` をオーバーレイで差し替えること。

### 2026-08-01 (#213) 同時に受けられる予約数（`tenants.booking_capacity`）
**要否**: **全兄弟で必要**（#236/#237 と併せて対応する）

「テナント内で時間が重なる予約が1件でもあれば拒否」という
**1テナント＝同時1予約の暗黙の前提**を外した。既定1で従来と同じ挙動。
複数ベッド・複数施術者の店はこの値を上げる必要がある。
詳細: `mem/features/booking-capacity.md`
