// 体験予約を受けてよいか（trial-book）と、体験の呼び方（メール・プッシュ・カレンダー）。2026-10-31
//
// 🔴 画面（src/lib/businessHours.ts・src/lib/staffSchedule.ts・src/lib/bookingWindow.ts・
//    src/lib/menuTrial.ts）と**同じ答え**を返すこと。片方だけ直すと「画面に出ている枠を送ると断られる」が起きる。
//    実際に起きていた: 画面は営業時間から枠を並べるのに、trial-book は「10:00〜21:00 開始」の直書きだった
//    （22:30 閉店の店で 21:15・21:30 の枠が出るのに、送ると「選択できない時間帯です」で断られていた）。
// import なし（src/test/menuTrial.test.ts が画面の関数と突き合わせている）。

export const SLOT_STEP_MINUTES = 15;
const DEFAULT_OPEN_MINUTES = 10 * 60;
const DEFAULT_CLOSE_MINUTES = 21 * 60;
const DAY_END_MINUTES = 24 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 公開ページ（体験）の「何日先まで」の従来の既定（src/lib/bookingWindow.ts の LEGACY_GUEST_WINDOW_DAYS） */
export const LEGACY_GUEST_WINDOW_DAYS = 10;
/** 送信の遅れ・端末の時計のずれを見込んだ余裕（日）。画面が10日先までなら12日先まで受ける（従来どおり） */
export const WINDOW_GRACE_DAYS = 2;

export interface DayHours {
  start?: string | null;
  end?: string | null;
}
/** tenants.operating_hours（src/lib/businessHours.ts の OperatingHours と同じ形） */
export interface OperatingHours {
  start?: string | null;
  end?: string | null;
  days?: Record<string, DayHours | null> | null;
}
/** staff_schedules の1行（その担当のもの） */
export interface ShiftRow {
  weekday: number;
  start_time: string;
  end_time: string;
}
export interface DayMinutes {
  open: number;
  close: number;
}

/** "HH:MM" → 0時からの分（src/lib/businessHours.ts の parseTimeToMinutes と同じ） */
export const parseTimeToMinutes = (t?: string | null): number | null => {
  if (!t) return null;
  const trimmed = t.trim();
  if (trimmed === "24:00") return DAY_END_MINUTES;
  const m = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
};

const resolveBusinessMinutes = (hours?: OperatingHours | null): DayMinutes => {
  const open = parseTimeToMinutes(hours?.start) ?? DEFAULT_OPEN_MINUTES;
  const close = parseTimeToMinutes(hours?.end) ?? DEFAULT_CLOSE_MINUTES;
  if (close <= open) return { open: DEFAULT_OPEN_MINUTES, close: DEFAULT_CLOSE_MINUTES };
  return { open, close };
};

/** その曜日の営業時間（分）。定休日は null（src/lib/businessHours.ts の resolveDayBusinessMinutes と同じ） */
export const resolveDayBusinessMinutes = (
  hours: OperatingHours | null | undefined,
  weekday: number,
): DayMinutes | null => {
  const fallback = resolveBusinessMinutes(hours);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return fallback;
  const days = hours?.days;
  if (!days || typeof days !== "object") return fallback;
  if (!Object.prototype.hasOwnProperty.call(days, String(weekday))) return fallback;
  const entry = days[String(weekday)];
  if (entry === null || entry === undefined) return null;
  const open = parseTimeToMinutes(entry.start);
  const close = parseTimeToMinutes(entry.end);
  if (open === null || close === null || close <= open) return fallback;
  return { open, close };
};

/**
 * 担当のシフト ∩ 営業時間（src/lib/staffSchedule.ts の staffDayMinutes と同じ）。
 * `shifts` はその担当の全部の行。1行も無い担当は営業時間どおり（GB002 と同じ）。
 */
export const shiftDayMinutes = (
  hours: OperatingHours | null | undefined,
  weekday: number,
  shifts: ReadonlyArray<ShiftRow> | null | undefined,
): DayMinutes | null => {
  const store = resolveDayBusinessMinutes(hours, weekday);
  if (!store) return null;
  if (!shifts || shifts.length === 0) return store;
  const rows = shifts.filter((s) => s.weekday === weekday);
  if (rows.length === 0) return null;
  let open: number | null = null;
  let close: number | null = null;
  for (const r of rows) {
    const o = parseTimeToMinutes(r.start_time);
    const c = parseTimeToMinutes(r.end_time);
    if (o === null || c === null || c <= o) continue;
    open = open === null ? o : Math.min(open, o);
    close = close === null ? c : Math.max(close, c);
  }
  if (open === null || close === null) return store;
  const lo = Math.max(open, store.open);
  const hi = Math.min(close, store.close);
  if (hi <= lo) return null;
  return { open: lo, close: hi };
};

/**
 * 画面に並ぶ開始時刻か。画面は「開店（シフトの始まり）から15分刻み・1枠が閉店（シフトの終わり）までに収まる」
 * 開始時刻を並べる（src/lib/businessHours.ts の bookingSlotMinutes）。
 */
export const isListedStart = (day: DayMinutes | null, startMin: number, sessionMinutes: number): boolean =>
  !!day
  && startMin >= day.open
  && startMin + sessionMinutes <= day.close
  && (startMin - day.open) % SLOT_STEP_MINUTES === 0;

/** 何日先まで（src/lib/bookingWindow.ts の normalizeBookingWindowDays と同じ。使えない値は null＝未設定） */
export const normalizeWindowDays = (raw: unknown): number | null => {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const n = Math.floor(raw);
  if (n < 1 || n > 365) return null;
  return n;
};

/** JST の暦日（yyyy-MM-dd）の0時の実時刻（ms）。読めなければ null */
export const jstDayStartMs = (dateKey: string | null | undefined): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((dateKey ?? "").trim());
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(ms) ? null : ms - JST_OFFSET_MS;
};

/** 実時刻（ms）の JST の暦日（yyyy-MM-dd） */
export const jstDateKey = (ms: number): string => {
  const d = new Date(ms + JST_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

/**
 * 「何日先まで」を数える起点（ms）。ふだんは今。メニューの開始日がまだ先なら「開始日の前日の0時」
 * （開始日から N 日分を前もって受け付ける。宗本さん 2026-10-31。画面は src/lib/menuTrial.ts）。
 */
export const trialWindowAnchorMs = (nowMs: number, startsOn: string | null | undefined): number => {
  const start = jstDayStartMs(startsOn);
  if (start === null) return nowMs;
  return Math.max(nowMs, start - DAY_MS);
};

/** 受けてよい最も先の時刻までの長さ（ms）。画面の日数＋余裕 */
export const trialMaxAheadMs = (windowDays: number): number => (windowDays + WINDOW_GRACE_DAYS) * DAY_MS;

// ── 呼び方（通知層なので日本語を直接書く。画面は i18n の menuTrial.*）──────────────────────

const menuLabel = (menuName: string | null | undefined): string => (menuName ?? "").trim();

/** メールの呼び方。メニューの体験は「マシンピラティスの体験」、ほかは従来どおり「体験トレーニング」 */
export const trialName = (menuName: string | null | undefined): string =>
  menuLabel(menuName) ? `${menuLabel(menuName)}の体験` : "体験トレーニング";

/** メールの「内容」欄。トレーニングの体験は従来の文言のまま */
export const trialContentValue = (menuName: string | null | undefined): string =>
  menuLabel(menuName) ? `${menuLabel(menuName)}の体験` : "体験トレーニング（カウンセリング＋トレーニング 計60分）";

/** 店宛ての通知（メール・プッシュ・LINE・Google カレンダー）のラベル */
export const trialBookingLabel = (menuName: string | null | undefined): string =>
  menuLabel(menuName) ? `${menuLabel(menuName)}の体験予約` : "体験予約";
