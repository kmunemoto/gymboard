# 業種プロファイル（business_type）と接骨院版

## 経緯
`tenants.business_type` は初期からある列で、CHECK 制約は
`('personal_gym','pilates','yoga','seitai','other')`。しかし長らく
**保存されているだけの死に列**だった（書き込みは `src/pages/Onboarding.tsx` の1箇所、
読み出しは `tenantColumns.ts` の select と `useTenant.ts` の型だけ、分岐0箇所）。

接骨院向けアプリを作るにあたり、選択肢は3つあった。

| 方針 | 判断 |
|---|---|
| A. リポジトリごと複製（フォーク） | **採らない** |
| B. business_type で分岐して同居 | **採用** |
| C. 共通コアを抽出して業種ごとの皮をかぶせる | 採らない（順序が逆） |

Aを採らなかった決め手は、**このリポジトリ自身に「フォークの維持に失敗している」記録が
あった**こと。`mem/features/capacitor-8-upgrade.md` に、ピラボード（既存のフォーク）へ
Capacitor 7→8・Gradle/AGP更新・Play Console再申請を別途やり直す必要があると書かれている。
3本目を作れば、マイグレーション235本・Edge Function 36本・動的生成される RLS ポリシーを
1人で3系統維持することになる。テナント分離の正しさは `src/test/tenantIsolation.test.ts` が
機械検証しているが、**この唯一機能している安全網を2箇所で手動同期すると漏えい確率はむしろ上がる**。

Cを採らなかったのは、検証済みの2業種目が無い段階でN業種のフレームワークを建てることになり、
`check_booking_overlap`（SECURITY DEFINER・ダブルブッキングの最終防衛線）のような
最も load-bearing な部分を、新規収益ゼロの改修で触ることになるため。

## 設計

`src/lib/businessProfile.ts` が分岐の**単一ソース**。

```ts
resolveBusinessProfile(businessType) → BusinessProfile
isClinicBusiness(businessType) → boolean
```

判定は `CLINIC_BUSINESS_TYPES` という**集合**で行う。`business_type === "seitai"` のような
直接比較を書かないのは、業種が増えるたびに全画面を grep する羽目になるため。
`src/test/businessProfile.test.ts` が src 全体を走査してこの直接比較を禁止している。

プロファイルが持つもの: 用語オーバーレイ名 / 表示プリセット / 部位マスタのシード /
休眠判定の日数 / 予約枠の選択肢 / `regulated` / `allowReviewPrompt`。

### 絶対に守ること
1. **personal_gym の解決結果を変えない。** 既存テナントは全て personal_gym。
   `businessProfile.test.ts` が現行の定数（`DEFAULT_TENANT_MUSCLE_GROUPS` /
   `DEFAULT_DORMANT_DAYS` / `SLOT_OPTIONS`）と1つずつ突き合わせて固定している。
   新しい項目を足すときは、personal_gym 側には**今の実装が使っている定数をそのまま参照**で
   入れること（直書きすると元の定数を変えたときに personal_gym だけ取り残される）。
2. **未知の business_type は personal_gym にフォールバック。** DB の CHECK に値を足した
   だけでコードが落ちる、という壊れ方をさせない。
3. 直接比較を書かない（上記）。

## 用語オーバーレイ
`src/locales/ja.clinic.json` に**差分キーだけ**を置き、`applyTerminologyOverlay()`
（`src/lib/i18n.ts`）が実行時に ja へ重ねる（deep + overwrite）。
**`ja.json` 本体は1文字も変えない**ので、既存ジムの1900キー超は完全に不変。

お客様→患者 / ジム→院 / トレーナー→施術者 / 種目管理→施術メニュー。

テストが見張っているもの:
- オーバーレイのキーが `ja.json` に**実在する**こと（改名で静かに死ぬのを防ぐ）
- 差し替え後に文言が**変わっている**こと（無意味なキーを残さない）
- `{{count}}` などの**補間変数を落としていない**こと
- ジム向けの語彙が残っていないこと

制約:
- 一度重ねたオーバーレイは i18next から綺麗に剥がせない（deep merge のため）。
  業種はテナント単位で変わらず、テナント切替時はリロードが挟まるので
  「重ねるだけ・剥がさない」で運用する。
- テナント解決までの一瞬だけジム向け文言が見えうる。ローディングでほぼ隠れるが完全には消せない。
- **ja のみ。** 接骨院版は国内向けで、医療系の海外配信はストア側の申告義務の射程に
  入りうるため意図的に多言語化していない。

## 法規制まわり（接骨院固有）
- **`allowReviewPrompt: false`** — 柔道整復師法24条は広告可能事項を法定列挙する
  ポジティブリスト方式で、依頼・誘導した患者の体験談は広告規制の対象になりうる
  （違反は30万円以下の罰金）。現場の判断に委ねずコード側で既定OFF。
- 整体（`seitai`）と接骨院は**法的には別カテゴリ**。接骨院は国家資格（柔道整復師）を要し
  受領委任の枠組みがあるが、整体には業法が無い。画面の用語という観点では同じなので
  同じプロファイルに寄せ、法規制の差は `regulated` で表現している。
  DB の CHECK 制約への `judo_therapy` 追加は未実施（現時点では `seitai` のみ）。

## 未着手（次にやること）
- `judo_therapy` を CHECK 制約に追加
- 患者側 BottomNav（`src/components/customer/BottomNav.tsx`）の5タブ固定配列をプロファイル駆動に
- `gymDisplaySettings.ts` の `presetToValues()` に clinic プリセット
- `Onboarding.tsx` の部位マスタのシードを `profile.defaultBodyParts` に
- **`counseling_responses.tenant_id` の DEFAULT 撤去**（`20260625100000_*.sql` が Salute の
  UUID を直書きし FK 制約も無い。公開問診フォームを作る PR と必ず同一 PR で）
- `consent_records`（要配慮個人情報の独立同意）— 負傷部位・既往歴を保存する前に必須
- 姿勢分析の文言から「診断」を撤去（薬機法のプログラム医療機器該当性）

## スコープ外と決めたこと
**療養費・レセプト・受領委任・法定施術録の正本には踏み込まない。**
制度追随が恒常コストになり（令和8年7月施行の改定など）、施術録を正本にすると
転帰確定日から5年保存・訂正履歴・物理削除禁止が必須要件化して
`src/pages/DeleteAccount.tsx` と正面衝突する。
アプリ内の記録は「補助メモであり法定の施術録ではない。正本はレセコン／紙」と明記する。
