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
 * ## 占有を計算している場所は**5つ**ある（2026-09-03・PR #368 で全部そろえた）
 *
 *   1. `check_booking_overlap`  これから入れる予約
 *   2. `check_booking_overlap`  既存の `bookings`
 *   3. `check_booking_overlap`  既存の `trial_bookings`  ← **足さない**（列が無い）
 *   4. `guard_booking_staff_reassign`  担当の差し替え（BEFORE UPDATE）
 *   5. `get_tenant_booked_slots`  画面が見る埋まり枠
 *
 * 1つでも欠けると静かに壊れる。2 を忘れると**本物の二重予約**（ストレッチの最中に
 * 次のお客様が入る）、5 を忘れると**「空きに見えるのに送信すると断られる」**。
 * 定義は `supabase/migrations/20260903000000_booking_option_minutes.sql`、
 * 見張りは `src/test/bookingOptionFootprint.test.ts`。
 *
 * 🔴 `check_booking_overlap` は `bookings` と `trial_bookings` の**両方**のトリガーから
 * 呼ばれる。`NEW.option_minutes` と直接書くと**体験予約の登録だけが実行時に落ちる**
 * （`trial_bookings` にこの列は無い）。`to_jsonb(NEW) ->> ...` で読むこと。
 *
 * ## 占有が伸びる＝選べる枠が変わる、をどう扱うか
 *
 * 画面と DB の判定がずれると「画面では選べているのに送信すると DB に断られる」になる。
 * 揃え方は画面ごとに違う（2026-09-03 第4段で分かれた）:
 *
 * - **お客様の予約画面**（`CustomerBooking`）… 枠グリッドは**素の枠**で作り、
 *   枠を選んだあとの確認カードで「この枠にオプションが入るか」を見る
 *   （`src/lib/bookingOptionFit.ts`）。入らなければ、入る枠をこちらから提案する。
 * - **店側の代理予約**（`TrainerSchedule`）… 先に選ばせて枠を絞る（従来どおり）。
 *   電話で聞いてから入力する場面なので、提示する必要がなく、絞るほうが速い。
 *   `useBookingOptionSelection({ onChange })` で選択中の時刻を外している。
 *
 * ## 入れたあとの予約に、後からオプションを足す導線は作らないこと
 *
 * 重複判定は **BEFORE INSERT のみ**（20260804000000 の方針）。UPDATE で占有を伸ばしても
 * **何も検査されず**、次のお客様の枠を静かに飲み込む。作るならそのトリガーを同時に足す。
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

/**
 * その予約に付いているオプションを1行で表す。「ストレッチ（+30分）／プロテイン」。
 *
 * 予定表は狭いので、これを**そのまま**カードにもツールチップにも出す。
 * 時間が増えないオプションには「+0分」を付けない（意味の無い数字を並べない）。
 */
export const summarizeOptions = (
  options: ReadonlyArray<BookingOptionSnapshot> | null | undefined,
  minutesLabel: (minutes: number) => string,
): string =>
  (options ?? [])
    .map((o) => (o.duration_minutes > 0 ? `${o.name}（${minutesLabel(o.duration_minutes)}）` : o.name))
    .join("／");

/**
 * 「あとからオプションを足そうとしたが、後ろが空いていなかった」。
 *
 * SQLSTATE `GB008`（`20260904000000_booking_option_update_guard.sql` がこの用途専用に
 * 付けている）。満枠（文言のみ・SQLSTATE 無し）や GB001（担当が埋まっている）と
 * 混ぜないのは、店員に出す案内が違うため——満枠は「別の時間なら取れる」だが、
 * これは「この予約は伸ばせない」で、対処が別（予約を動かすか、短いオプションにする）。
 */
export const OPTION_BLOCKED_SQLSTATE = "GB008";

export const isOptionBlockedError = (error: unknown): boolean =>
  !!error && typeof error === "object" &&
  (error as { code?: string }).code === OPTION_BLOCKED_SQLSTATE;

/**
 * 「この枠を取ると、既にある予約とぶつかるか」。半開区間で比べる。
 *
 * 予約の占有は [開始, 開始+1枠+オプション+間) で、**終わりは含まない**。
 * 10:00〜11:45 を押さえている予約の直後、11:45 ちょうどから次の予約を取れる
 * （含めてしまうと、実際には空いている15分刻みの枠が1つ消える）。
 *
 * 🔴 「後ろが詰まっているとオプションを付けられない」は、この式に
 * `sessionFootprintMinutes` の結果を渡すことで自動的に成り立つ。
 * オプションを付けると `footprintMinutes` が伸び、後ろの予約に届いた枠が満枠になる。
 * 例（1枠60分・間15分・18:00に予約がある日）:
 *
 *   16:30 + 75分 = 17:45  → 18:00 に届かない  … 取れる
 *   16:30 + 105分 = 18:15 → 18:00 に食い込む  … 取れない（オプションを付けた場合）
 *   16:15 + 105分 = 18:00 → ちょうど          … 取れる
 */
export const footprintOverlaps = (
  candidateStartMin: number,
  footprintMinutes: number,
  existing: { startMin: number; endMin: number },
): boolean =>
  candidateStartMin < existing.endMin &&
  existing.startMin < candidateStartMin + footprintMinutes;
