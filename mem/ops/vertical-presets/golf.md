# ゴルフレッスン（ゴルフボード）プリセット

`golf.vertical.ja.json` を兄弟アプリの `src/locales/vertical.ja.json` に丸ごとコピーする。
機能フラグとブランド値は下記のとおり。

**対象アプリ**: ゴルフボード（2026-08-02 に remix で作成。4番目の兄弟）

## 決定の経緯（2026-08-03）

ゴルフボード側の棚卸し結果を受けて、宗本さんが決定。
**判断の根拠を残しておかないと次に同じ議論をやり直すことになる**ので、理由まで書く。

## 語彙

原則は「**置き換える語を減らすほど取りこぼしが減る**」。必要最小限に絞ってある。

| base（ジム向け） | ゴルフ | 理由 |
|---|---|---|
| ジム | スクール | |
| ジムオーナー | スクールオーナー | 「ジム」の置換で自動的に付いてくる |
| トレーナー | **コーチ** | **ゴルフ業界の正式呼称。**「トレーナー」だと別業種に見える。ストレッチボードが「トレーナー」を据え置いたのとは逆の判断だが、業界で通じないことの害の方が大きい |
| トレーニング | レッスン | |
| **お客様 / 来店** | **変えない** | セッコツボードが「来院」に変えて9件やり残している。変えないのが安全 |

`golf.vertical.ja.json` は **`src/locales/ja.json` から機械生成**した（上の3規則を全葉に適用し、
変わった葉だけを抜き出す）。**手書きしないこと** — キーがずれると i18next が黙って無視し、
「オーバーレイを当てたのにジムの語彙が出たまま」になる。

再生成する場合の考え方:

```
ja.json の全葉に対して トレーナー→コーチ / トレーニング→レッスン / ジム→スクール を適用し、
変わった葉だけを同じ入れ子構造で出力する
```

### 機械置換では拾えず、手で当てた5葉

| キー | 内容 |
|---|---|
| `settings.trainer.businessHoursCapacityDesc` | 「ベッド数や施術者数」→「**打席数やコーチの人数**」 |
| `onboarding.fieldCapacityHint` | 「ベッドが2台」→「**打席が2つ**」 |
| `help.section1ScheduleDesc` | 「施術中」→「レッスン中」 |
| `trialBooking.notAvailableTitle` / `notAvailableBody` | 下記「体験予約」参照 |

**`ベッド` `施術` は base に残っている業種語**なので、機械置換の規則を足すのではなく
個別に当てている（規則を増やすと関係ない葉まで壊す）。

## 機能フラグ（`src/lib/featureFlags.ts`）

ゴルフは医療隣接ではないので `personal-stretch` / `pilates` 型が出発点。

| フラグ | 値 | 理由 |
|---|---|---|
| `WORKOUT_LOG_ENABLED` | `false` | 「種目×重量×回数」はゴルフに合わない。**ピラボードが作り替えて今も merge で困っている**ので、上流と同じ形に保つ。記録は当面 `bookings.trainer_note`（予約ごとのカルテ）で代替 |
| `MUSCLE_RADAR_ENABLED` | `false` | 記録の道連れ |
| `WORKOUT_SHARE_ENABLED` | `false` | 同上（`customerFeatureGates.test.tsx` が連動を強制） |
| `MONTHLY_REPORT_ENABLED` | `false` | 中身が筋トレ/減量指標 |
| `BODY_METRICS_ENABLED` | `false` | ボディメイク文脈ではない |
| `MEALS_ENABLED` | `false` | 3業種とも false |
| **`POSTURE_ENABLED`** | **`false`** | 下記 |
| `TRIAL_BOOKING_ENABLED` | `false` | ジムボード以外は全て false（決定済み方針）。下記の注意あり |
| `LANGUAGE_SWITCHER_ENABLED` | `false` | 兄弟は日本語のみ |
| `SKELETAL_DIAGNOSIS_ENABLED` | `true` | 医療隣接ではないので規制の射程外。ただし `POSTURE_ENABLED=false` なら画面自体が出ない |
| `GOOGLE_REVIEW_ENABLED` | `true` | 同上（柔道整復師法24条はゴルフに掛からない） |

### `POSTURE_ENABLED = false` の理由（2026-08-03 決定）

他3業種は `true`（看板機能）だが、ゴルフでは **当面 `false`、必要になったら上流で設計**とした。

- 推奨内容が**筋トレ種目**なので、`true` にするなら全面差し替えが要る
- **スイング分析への転用は「姿勢の静止画分析」とは別物**（連続動作の解析）で、
  推奨内容の差し替えでは済まず**新規開発**になる
- `false` にすると **TensorFlow.js 約580KB がバンドルから丸ごと落ちる**ので初回ロードが軽い

**必要になったら、フォークで作り込まず上流に相談すること**（鉄則1「コードの形を変えない」）。

### 体験予約を `false` にするときの注意

**`false` にしても公開ページは消えない。** チラシやQRに印刷済みのリンクを404にしないため、
経路を残して案内文に差し替えている。つまり次の2キーは**OFFのフォークでもお客様の目に触れる**。
プリセットに golf 向けの文言を入れてある。

- `trialBooking.notAvailableTitle` … 「ただいま体験レッスンのご予約を受け付けておりません」
- `trialBooking.notAvailableBody` … 「…詳しくはスクールまでお問い合わせください。」

## 打席（`tenants.booking_capacity`）

**インドアゴルフなら最初から効く。** 既定1のままだと、空いている打席が「満枠」表示になる。

ただし **業種で既定値を決めない**（1人で回す店と複数打席の店が同じ業種に混在するため。
`mem/features/booking-capacity.md`）。**コード側の既定は1のまま**、オンボーディングで店に聞く
導線に乗せるのが正しい形。

**打席の指名予約（1番打席を指定）は未実装。** `booking_capacity` は
「同時に何件受けられるか」のカウントだけで、予約とリソースの紐付けは持っていない。

## ブランド値（`src/lib/brand.ts`）

| 項目 | 値 |
|---|---|
| `BRAND.ja` | ゴルフボード |
| `BRAND.en` | GolfBoard |
| `BRAND.app` | golfboard |
| `NATIVE_APP_SCHEME` | `app.golfboard.mobile:` |
| Supabase project ref | `cyhrvhngnhghzrheorum` |

`capacitor.config.ts` の `appId` / `NATIVE_APP_SCHEME` / `ios-build.yml` の bundle ID は
**必ず3つとも一致させる**（`mem/ops/vertical-fork.md` 地雷3・5）。

## 持ち主にしか決められない未決事項（2026-08-03 時点）

- **公開ドメイン** → `PRODUCTION_WEB_ORIGIN` と `STRIPE_LIVE_HOSTS`。
  **未設定だと決済が sandbox 判定になり、画面上は成功に見えて課金されない**
- Firebase プロジェクト（アプリごとに新規）
- iOS プロビジョニングプロファイル
- Android 署名キーストアと `ANDROID_VERSION_NAME`
  （ジムボードの `9.1` が merge で降りてくる。**Android CI を使うかどうかも任意** … `#241`）
- **本番DBへのスキーマ適用**（`scripts/check-schema-applied.mjs` でSQLを生成し、
  Supabase の SQL Editor で実行して確認する）
