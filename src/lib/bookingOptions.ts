/**
 * 予約のオプション（`booking_options`）。
 *
 * 実店舗の要望（2026-09-02 宗本さん）:「トレーニングのあとに 30分 3,000円 の
 * ストレッチを付けられるようにしたい。予約するときに選べるようにしたい」。
 *
 * ## 🔴 追加の時間は「同じ1回のセッション」として扱う
 *
 * 宗本さんの明言:「トレーニング時間とストレッチの間にもちろん15分は開けません。
 * 一つのセッションの時間として扱います」。つまり占有はこうなる:
 *
 *   1枠60分 + オプション30分 + 次のお客様までの間15分 = 105分
 *
 * 「60分 + 間15分 + 30分 + 間15分 = 120分」ではない。間を2回取ると、実際には
 * 空いている15分が予定表から消える。`sessionFootprintMinutes` がこの唯一の計算。
 *
 * ## いまの版でできること
 *
 * 店が**オプションを定義できる**ところまで（`TrainerBookingOptions`）。
 * お客様側の選択と、`check_booking_overlap` の占有への加算は次の版。
 * DB を変えるときは、トリガーの中の footprint 計算が**3箇所**にあることに注意する
 * （これから入れる予約 / 既存の `bookings` / 既存の `trial_bookings`）。
 * 片方だけ直すと「Aの後にBは取れるのにBの後にAは取れない」という左右非対称の判定になる。
 *
 * ## 料金は表示のための数字
 *
 * ジムボードはアプリ内で施術料の決済をしない（Stripe はサブスク課金のみ）。
 * `price_yen` はお客様に見せる金額で、支払いは店頭。0 は「無料」ではなく
 * **「料金を表示しない」**（掲示したくない店・回数券に含む店がある）。
 */

/** オプション1件。DB の列と同じ形（`get_tenant_booking_options` の戻りも同じ）。 */
export interface BookingOption {
  id: string;
  name: string;
  duration_minutes: number;
  price_yen: number;
  description?: string | null;
  enabled?: boolean;
  sort_order?: number;
}

/** 名前の長さの上限（DB の CHECK と同じ値）。 */
export const OPTION_NAME_MAX = 40;
/** 追加時間の上限（分）。DB の CHECK と同じ値。これを超えるならプランとして持つべきもの。 */
export const OPTION_DURATION_MAX = 180;
/** 料金の上限（円）。桁の打ち間違い（3000 のつもりで 300000）を止めるためのもの。 */
export const OPTION_PRICE_MAX = 1_000_000;

/**
 * 追加時間として選べる値。
 *
 * 5分刻みにしてあるのは `SLOT_DURATION_OPTIONS` と同じ理由（実店舗が50分で回している）。
 * 先頭の 0 は「時間は増えないオプション」（プロテイン・レンタルウェアなど）。
 */
export const OPTION_DURATION_OPTIONS: readonly number[] = [
  0,
  ...Array.from({ length: 18 }, (_, i) => 5 + i * 5), // 5〜90分（5分刻み）
  105,
  120,
  150,
  180,
];

/** 入力が DB の CHECK を通るか。通らない理由を返す（通るなら null）。 */
export type OptionInvalidReason = "name" | "duration" | "price";

export const validateBookingOption = (
  o: { name: string; duration_minutes: number; price_yen: number },
): OptionInvalidReason | null => {
  const name = o.name.trim();
  if (name.length === 0 || name.length > OPTION_NAME_MAX) return "name";
  if (!Number.isInteger(o.duration_minutes)) return "duration";
  if (o.duration_minutes < 0 || o.duration_minutes > OPTION_DURATION_MAX) return "duration";
  if (!Number.isInteger(o.price_yen)) return "price";
  if (o.price_yen < 0 || o.price_yen > OPTION_PRICE_MAX) return "price";
  return null;
};

/** 有効なオプションだけを並び順（sort_order → 名前）で返す。 */
export const activeOptions = (
  options: ReadonlyArray<BookingOption> | null | undefined,
): BookingOption[] =>
  (options ?? [])
    .filter((o) => o.enabled !== false)
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name));

/** 選ばれたオプションの合計時間（分）。知らない ID は 0 として扱う（消されたオプション）。 */
export const optionMinutesFor = (
  options: ReadonlyArray<BookingOption> | null | undefined,
  selectedIds: ReadonlyArray<string> | null | undefined,
): number => {
  if (!options || !selectedIds || selectedIds.length === 0) return 0;
  const byId = new Map(options.map((o) => [o.id, o]));
  // 同じ ID が2回入っていても1回として数える
  return [...new Set(selectedIds)].reduce(
    (sum, id) => sum + Math.max(0, byId.get(id)?.duration_minutes ?? 0),
    0,
  );
};

/** 選ばれたオプションの合計金額（円）。 */
export const optionPriceFor = (
  options: ReadonlyArray<BookingOption> | null | undefined,
  selectedIds: ReadonlyArray<string> | null | undefined,
): number => {
  if (!options || !selectedIds || selectedIds.length === 0) return 0;
  const byId = new Map(options.map((o) => [o.id, o]));
  return [...new Set(selectedIds)].reduce(
    (sum, id) => sum + Math.max(0, byId.get(id)?.price_yen ?? 0),
    0,
  );
};

/**
 * お客様に見せる「1回のセッションの長さ」（分）。1枠 + オプション。
 * 次のお客様までの間（`booking_buffer_minutes`）はここに**含めない**
 * （お客様の時間ではないので「09:00〜10:30」の表示に混ぜてはいけない）。
 */
export const sessionMinutes = (slotMinutes: number, optionMinutes: number): number =>
  Math.max(0, slotMinutes) + Math.max(0, optionMinutes);

/**
 * 予定表が塞ぐ長さ（分）。1枠 + オプション + 次のお客様までの間。
 *
 * 🔴 間は**1回だけ**。トレーニングとオプションの間には入れない
 * （`supabase/migrations/20260902000000_booking_options.sql` の冒頭と同じ規則）。
 */
export const sessionFootprintMinutes = (
  slotMinutes: number,
  optionMinutes: number,
  bufferMinutes: number,
): number => sessionMinutes(slotMinutes, optionMinutes) + Math.max(0, bufferMinutes);

/** 予約に控える1件ぶんの内容（`bookings.booking_options` の要素）。 */
export interface BookingOptionSnapshot {
  id: string;
  name: string;
  duration_minutes: number;
  price_yen: number;
}

/**
 * 保存用の控えを作る。選ばれた順ではなく**一覧の並び順**で入れる
 * （店側の予定表とお客様の控えで並びが違うと、同じ予約に見えない）。
 */
export const buildOptionSnapshot = (
  options: ReadonlyArray<BookingOption> | null | undefined,
  selectedIds: ReadonlyArray<string> | null | undefined,
): BookingOptionSnapshot[] => {
  if (!options || !selectedIds || selectedIds.length === 0) return [];
  const chosen = new Set(selectedIds);
  return options
    .filter((o) => chosen.has(o.id))
    .map((o) => ({
      id: o.id,
      name: o.name,
      duration_minutes: o.duration_minutes,
      price_yen: o.price_yen,
    }));
};

/**
 * 保存済みの控え（jsonb）を安全に読み出す。
 *
 * DB に何が入っていても画面を落とさないのが目的（`parseAnswerSnapshot` と同じ）。
 * 形が違う行は捨てる。
 */
export const parseOptionSnapshot = (raw: unknown): BookingOptionSnapshot[] => {
  if (!Array.isArray(raw)) return [];
  const out: BookingOptionSnapshot[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    if (!name) continue;
    out.push({
      id: typeof rec.id === "string" ? rec.id : "",
      name,
      duration_minutes:
        typeof rec.duration_minutes === "number" && Number.isFinite(rec.duration_minutes)
          ? Math.max(0, Math.trunc(rec.duration_minutes))
          : 0,
      price_yen:
        typeof rec.price_yen === "number" && Number.isFinite(rec.price_yen)
          ? Math.max(0, Math.trunc(rec.price_yen))
          : 0,
    });
  }
  return out;
};

/**
 * DB から読んだ `option_minutes` を安全な数値にする。
 * 列がまだ無い環境（マイグレーション未適用）では undefined が来るので 0 に倒す。
 */
export const readOptionMinutes = (raw: unknown): number =>
  typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0;

/**
 * "09:00" と "10:30" から 90 を返す。日をまたぐ予約は無いので単純な差でよい。
 *
 * 予約行の `endTime`（`parseBooking` が 1枠＋オプション で作る）から
 * 「何分のセッションか」を復元するのに使う。画面に「60分」と直書きしないための道具。
 */
export const minutesBetween = (startTime: string, endTime: string): number => {
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN;
  };
  const diff = toMin(endTime) - toMin(startTime);
  return Number.isFinite(diff) && diff > 0 ? diff : 0;
};
