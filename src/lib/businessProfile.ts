import { DEFAULT_TENANT_MUSCLE_GROUPS } from "./tenantMuscleGroups";
import { DEFAULT_DORMANT_DAYS } from "./dormancy";
import type { GymDisplayPreset } from "./gymDisplaySettings";

/**
 * 業種（tenants.business_type）ごとの既定値を1箇所に集約する。
 *
 * ## なぜこれが要るか
 * `business_type` は初期から tenants にあるが、長らく**保存されているだけの死に列**だった
 * （書き込みは Onboarding.tsx の1箇所、分岐は0箇所）。接骨院のように業務の語彙も
 * 既定値も違う業種を受け入れるにあたり、この列を「表示プロファイルの解決キー」に格上げする。
 *
 * ## 絶対に守ること
 * 1. **`business_type === "..."` を画面側に書かない。** 分岐の条件はこのファイルだけが持つ。
 *    直接比較を書くと、業種が増えるたびに全画面を grep する羽目になる。
 *    `src/test/businessProfile.test.ts` が src 全体を走査して直接比較を禁止している。
 * 2. **personal_gym の解決結果を変えない。** 既存テナントは全て personal_gym なので、
 *    ここが変わると本番（Salute御所南ほか）の挙動が変わる。同テストが現行の既定値と
 *    1つずつ突き合わせて固定している。新しい項目を足すときは、personal_gym 側には
 *    必ず「今の実装が使っている定数」をそのまま入れること。
 * 3. **未知の business_type は personal_gym にフォールバックする。** DB 側の CHECK 制約に
 *    値を足しただけでコードが落ちる、という壊れ方をさせない。
 *
 * ## 施術所（clinic）という区分について
 * 整体（seitai）と接骨院（judo_therapy）は、法的にはまったく別のカテゴリ。
 * 接骨院は柔道整復師という国家資格を要し、柔道整復師法24条の広告規制（ポジティブリスト）
 * を受け、施術情報は要配慮個人情報に当たりうる。整体にはこれらの業法が無い。
 * ただし**アプリの表示・用語という観点では両者はほぼ同じ**（患者・院・施術）なので、
 * 表示プロファイルとしては clinic にまとめ、法規制の差は `regulated` で表現する。
 * DB の CHECK 制約に judo_therapy を足すのは別作業（現時点では seitai のみ存在）。
 */

/** tenants.business_type の取りうる値。DB 側の CHECK 制約と対応する。 */
export type BusinessType =
  | "personal_gym"
  | "pilates"
  | "yoga"
  | "seitai"
  | "judo_therapy"
  | "other";

/** 表示プロファイルの種別。business_type より粗い粒度でまとめたもの。 */
export type BusinessProfileKey = "gym" | "clinic";

/**
 * 施術所として扱う business_type。
 * 集合で持つのは、判定を `===` の羅列にしないため（judo_therapy を後から足しても
 * このファイルの1行で済み、画面側は一切変更不要になる）。
 */
const CLINIC_BUSINESS_TYPES: ReadonlySet<string> = new Set<BusinessType>([
  "seitai",
  "judo_therapy",
]);

/** 接骨院・整体向けの部位マスタのシード値。ジムの「胸・背中・肩…」に相当する。 */
export const CLINIC_BODY_PARTS = [
  "頸部", "肩", "腰部", "背部", "股関節", "膝", "足関節", "肘・手",
] as const;

export interface BusinessProfile {
  key: BusinessProfileKey;
  /**
   * 用語オーバーレイの名前。i18n の ja.json に重ねる差分ファイルを指す。
   * null なら ja.json のまま（＝ジム向け文言）。
   */
  terminologyOverlay: "clinic" | null;
  /** 新規テナント作成時に選ばれる表示プリセットの初期値 */
  defaultDisplayPreset: GymDisplayPreset;
  /** 部位マスタのシード値 */
  defaultBodyParts: readonly string[];
  /** 休眠（離脱リスク）判定の既定日数 */
  defaultDormantDays: number;
  /** 予約枠の間隔の選択肢（分） */
  slotDurationOptions: readonly number[];
  /**
   * 業法の規制を受ける業種か。
   * true の場合、広告表現・要配慮個人情報の扱い・「診断」表記に制約がかかる。
   * 個別の機能可否はこのフラグから導かず、下の明示フラグで持つこと
   * （「規制業種だから何が禁止か」はコードで表現しきれないため）。
   */
  regulated: boolean;
  /**
   * 口コミ依頼バナー（tenants.google_review_url）を出してよいか。
   * 接骨院は柔道整復師法24条が広告可能事項を法定列挙するポジティブリスト方式で、
   * 依頼・誘導した患者の体験談は広告規制の対象になりうる（違反は30万円以下の罰金）。
   * 判断を現場に委ねず、既定で出さない。
   */
  allowReviewPrompt: boolean;
}

const GYM_PROFILE: BusinessProfile = {
  key: "gym",
  terminologyOverlay: null,
  defaultDisplayPreset: "standard",
  // 以下3つは「現行の実装がそのまま使っている定数」。値を直書きせず参照すること
  // （直書きすると、元の定数を変えたときに personal_gym だけ取り残される）。
  defaultBodyParts: DEFAULT_TENANT_MUSCLE_GROUPS,
  defaultDormantDays: DEFAULT_DORMANT_DAYS,
  slotDurationOptions: [30, 45, 60, 90, 120],
  regulated: false,
  allowReviewPrompt: true,
};

const CLINIC_PROFILE: BusinessProfile = {
  key: "clinic",
  terminologyOverlay: "clinic",
  // 院は1日30〜40人が15分前後で回る。ジム向けの全部盛りは現場で邪魔になる。
  defaultDisplayPreset: "simple",
  defaultBodyParts: CLINIC_BODY_PARTS,
  // 通院間隔はトレーニングより短い。30日待つと離脱に気づくのが遅い。
  defaultDormantDays: 14,
  // 保険外の短時間施術に合わせて15分・20分を足す。
  slotDurationOptions: [15, 20, 30, 45, 60, 90],
  regulated: true,
  allowReviewPrompt: false,
};

/**
 * business_type から表示プロファイルを解決する。
 * null / undefined / 未知の値は personal_gym 相当（＝現行の挙動）にフォールバックする。
 */
export const resolveBusinessProfile = (
  businessType: string | null | undefined,
): BusinessProfile =>
  businessType && CLINIC_BUSINESS_TYPES.has(businessType) ? CLINIC_PROFILE : GYM_PROFILE;

/** 施術所（接骨院・整体）か。画面側で business_type を直接見ないための入口。 */
export const isClinicBusiness = (businessType: string | null | undefined): boolean =>
  resolveBusinessProfile(businessType).key === "clinic";
