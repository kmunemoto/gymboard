# プリセット: パーソナルストレッチ（ストレッチボード）

対応アプリ: **ストレッチボード**（Lovable `26210a2c-1268-4ae3-b4ff-ee9d19e9f11a`）

想定業種は「トレーナーが1対1で施術するパーソナルストレッチ専門店」。
Dr.stretch のような、来店して受けるストレッチ専門のサロン。

## 語彙の方針

| 上流（ジム） | このプリセット | 理由 |
|---|---|---|
| ジム | **サロン** | 店舗の呼び名。「ストレッチ店」は硬い |
| ジムオーナー | **サロンオーナー** | 同上 |
| トレーナー | **トレーナー**（変えない） | パーソナルストレッチ業界でも「トレーナー」が正式な職名。無理に「セラピスト」へ変えると、かえって業界の呼び方から外れる |
| トレーニング | **ストレッチ** | 提供している行為そのもの |
| 来店 | **来店**（変えない） | サロンでも自然に使える |

**「トレーナー」を変えないのが、このプリセットの一番の判断**。
語を減らせば減らすほど、上流が文言を足したときの取りこぼしが減る。

## `src/locales/vertical.ja.json`

`personal-stretch.vertical.ja.json` を丸ごとコピーする（72項目）。

自動置換では意味が壊れる箇所は手で書き直してある:

- `auth.appTagline` … 上流は「パーソナルジム・ピラティス予約管理」。
  素直に置換すると「パーソナルストレッチ・ピラティス予約管理」になってしまうので
  **「パーソナルストレッチ予約管理」**にした。
  （セッコツボードはこの罠を踏んで「パーソナル院・ピラティス予約管理」になっている）
- `clientList.deleteDesc` … 食事記録は OFF なので削除対象の列挙から外した。
- `posture.recommendation.*` … **下記のとおり全面的に書き直した**。

### 姿勢分析の推奨内容は必ず書き直すこと

この業種で唯一 ON にする看板機能が姿勢分析なので、ここの中身がそのままだと
一番目立つ場所で「ジムのアプリを流用しただけ」に見える。

上流の `posture.recommendation.types.{straight,wave,natural}` は
**骨格タイプ別の筋トレ種目**（プランク / ラットプルダウン / スクワット…）を勧める。
プリセットではこれを**ストレッチ種目**（大胸筋ストレッチ / 腸腰筋ストレッチ /
肩甲骨はがし…）に差し替え、`summary` も「何を緩めるか」の説明に書き換えてある。

`postureExercises.{straightNeck,roundedBack,pelvicTilt}` も同様。
**ただし各項目の `area` の文字列は変えないこと。**
`TrainingRecommendationCard.tsx` が `POSTURE_EXERCISES` を
`"頭部の前傾（ストレートネック）"` 等の**日本語リテラルをキーにして引いている**ため、
ここを変えると姿勢フィードバックとの突き合わせが黙って外れる（表示が消えるだけで
エラーにならない）。プリセットは意図的に同じ文字列を保っている。

## `src/lib/featureFlags.ts`

お客様アプリは**姿勢分析だけ**を残す方針。

| フラグ | 値 | 理由 |
|---|---|---|
| `POSTURE_ENABLED` | `true` | この業種の看板機能。ビフォーアフターを見せられる |
| `SKELETAL_DIAGNOSIS_ENABLED` | `true` | フィットネス文脈の体型分類（ファッション業界の「骨格診断」と同じ語）で、医療隣接の業種ではないので上流のまま `true` でよい（セッコツボードとは違い、ここは変更不要） |
| `WORKOUT_LOG_ENABLED` | `false` | 種目×重量×回数はストレッチ店では使わない |
| `MEALS_ENABLED` | `false` | 減量が売りではない |
| `BODY_METRICS_ENABLED` | `false` | 体重・体脂肪はボディメイク文脈の指標 |
| `MUSCLE_RADAR_ENABLED` | `false` | **筋トレ記録がOFFだとデータ源が無くなる**ため道連れでOFF |
| `WORKOUT_SHARE_ENABLED` | `false` | 記録が無いので共有するものが無い |

`MUSCLE_RADAR_ENABLED` を単独で ON にしないこと。レーダーは `workouts` の集計で
描かれるので、記録タブを閉じたまま残すと**常に空のチャート**が出る。

結果、お客様側の下タブは **ホーム / 予約 / 設定** の3つになる。

## `src/lib/brand.ts`

| 定数 | 値 |
|---|---|
| `BRAND.ja` | `ストレッチボード` |
| `BRAND.en` | `StretchBoard` |
| `BRAND.app` | `stretchboard` |
| `NATIVE_APP_SCHEME` | `app.stretchboard.mobile:` |
| `BRAND_FALLBACK_GYM_NAME` | `BRAND.ja` |
| `POWERED_BY_LABEL` | `` `Powered by ${BRAND.en}` `` |
| `SUPPORT_EMAIL` | `k.munemoto@kyoto-salute.com` |

## `capacitor.config.ts`

| 項目 | 値 |
|---|---|
| `appId` | `app.stretchboard.mobile` |
| `appName` | `ストレッチボード` |

`appId` と `NATIVE_APP_SCHEME` と `.github/workflows/ios-build.yml` の bundle ID は
**3つとも一致させる**（`mem/ops/vertical-fork.md` 地雷3）。

## 営業まわりの既定値

- `tenants.booking_capacity` … **1**。1対1の施術なので上流の既定のままでよい。
  ベッドが複数ある店舗は、店側がサロン設定から増やせる。
- `tenants.slot_duration_minutes` … **60**。ストレッチは 30 / 45 / 60 分の
  メニューを併売する店が多いので、**プラン別の間隔**
  （`tenant_plans.slot_duration_minutes`）で分けるのが本筋。
  ジム全体の既定は 60 のままにして、30分メニューはプラン側で 30 を指定する。

## まだ決まっていない値（出荷前に埋める）

- [ ] `PRODUCTION_WEB_ORIGIN` … 公開URL。未公開なので未定
- [ ] `STRIPE_LIVE_HOSTS` … 上記が決まってから。**入れ忘れると本番なのに
      sandbox 判定になり、決済成功に見えて課金されない**（地雷2）
- [ ] `MARKETING_SITE_URL` … LP を作ってから
- [ ] Firebase プロジェクト（`ios-build.yml` の `Inject GoogleService-Info.plist`）
- [ ] プロビジョニングプロファイル（`PROVISIONING_PROFILE_SPECIFIER`）
- [ ] アイコン・スプラッシュ・ロゴコンポーネント
- [ ] 法務3ページ（利用規約 / プライバシー / 特商法）の事業者情報
- [ ] Supabase の Additional Redirect URLs に
      `app.stretchboard.mobile://auth/callback` を登録

## 未着手の前提

ストレッチボードは 2026-08-01 時点で **GitHub 未接続**かつ**素の GymBoard クローン**
（`capacitor.config.ts` が `app.gymboard.mobile` / 「ジムボード」のまま、
`featureFlags.ts` に Phase 0-B のフラグが無い）。

Supabase は独自プロジェクト `enablfwvguohfmaampgw` なので、
**GymBoard のデータと混ざる心配は無い**。

このプリセットを当てる前に、必ず上流を取り込むこと。
取り込まないと `vertical.ja.json` も `brand.ts` も存在せず、
`ja.json`（約1,900キー）を直接書き換えるしかなくなる ＝ 以後ずっと merge が衝突する。
