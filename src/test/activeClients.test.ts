import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  ACTIVE_CLIENT_BASES,
  DEFAULT_FOLLOW_UP_AFTER_DAYS,
  FOLLOW_UP_DAY_CHOICES,
  FOLLOW_UP_DAYS_MAX,
  FOLLOW_UP_DAYS_MIN,
  activeClientCount,
  classifyClientPresence,
  jstDateKey,
  resolveActiveClientBasis,
  resolveFollowUpAfterDays,
  summarizeClientPresence,
  type ClientPresenceInput,
} from "@/lib/activeClients";
import { TENANT_VALUE_DEFAULTS } from "@/lib/tenantColumns";

// ────────────────────────────────────────────────────────────────
// アクティブ顧客の数え方（2026-09-23 宗本さん）
//
// > アクティブ顧客って何を基準に数えてるの？ 本当に今通っている人だけの数字を出して欲しい。
// > 僕の場合は次回の予約が入ってない人はアクティブ顧客に数えないで欲しい。
// > その辺、設定できるようにできる？ジムごとに
//
// 🔴 壊しやすいものが2つある。
//
//   1. 既定の店（在籍の全員で数える・20店中19店）の「フォローが必要な顧客」に出る人が
//      変わってしまう。判定を lib へ移したので、旧実装と1人でも違えば**事故**。
//      下の「旧実装と突き合わせ」は、旧コードをそのまま写して数百人ぶん比べている。
//   2. 「離れている ◯名」とフォロー一覧の人数がズレる。同じ判定から出していれば
//      起きないので、画面が別の判定を持ち込んでいないかを見張る。
// ────────────────────────────────────────────────────────────────

const DAY = 86_400_000;
const jst = (s: string) => Date.parse(`${s}+09:00`);

const person = (over: Partial<ClientPresenceInput> = {}): ClientPresenceInput => ({
  user_id: "u1",
  status: "active",
  next_booking_date: null,
  last_visit_date: null,
  created_at: "2026-01-01T00:00:00+09:00",
  has_profile: true,
  ...over,
});

const NOW = jst("2026-09-23T12:00:00");

describe("ひとりを1つに分ける", () => {
  it("次の予約があれば「通っている」", () => {
    const p = person({ next_booking_date: "2026-09-30T10:00:00+09:00", last_visit_date: "2026-08-01T10:00:00+09:00" });
    expect(classifyClientPresence(p, NOW, 14).kind).toBe("coming");
  });

  it("🔴 今日来た人は、来たあとも今日いっぱい「通っている」", () => {
    // セッションが終わるたびに数字が減ると、朝と夜で数字が違って「壊れた」と見える
    const p = person({ last_visit_date: "2026-09-23T10:00:00+09:00" });
    expect(classifyClientPresence(p, NOW, 14).kind).toBe("coming");
    // 翌日には外れる
    expect(classifyClientPresence(p, jst("2026-09-24T09:00:00"), 14).kind).toBe("awaiting");
  });

  it("最近来たが次の予約が無ければ「予約待ち」", () => {
    const p = person({ last_visit_date: "2026-09-18T10:00:00+09:00" });
    const r = classifyClientPresence(p, NOW, 14);
    expect(r.kind).toBe("awaiting");
    expect(r.kind === "awaiting" && r.reason === "recent" && r.lastVisit).toBe("2026-09-18");
  });

  it("目安日数以上来ていなければ「離れている」", () => {
    const p = person({ last_visit_date: "2026-08-01T10:00:00+09:00" });
    const r = classifyClientPresence(p, NOW, 14);
    expect(r.kind).toBe("away");
    expect(r.kind === "away" && r.reason).toBe("lapsed");
  });

  it("目安日数を変えると境目が動く", () => {
    const p = person({ last_visit_date: "2026-09-10T10:00:00+09:00" });
    expect(classifyClientPresence(p, NOW, 7).kind).toBe("away");
    expect(classifyClientPresence(p, NOW, 21).kind).toBe("awaiting");
  });

  it("登録したばかりで一度も来ていない人は「予約待ち（新規）」", () => {
    const p = person({ created_at: "2026-09-20T12:00:00+09:00" });
    const r = classifyClientPresence(p, NOW, 14);
    expect(r.kind === "awaiting" && r.reason).toBe("new");
  });

  it("登録から日が経って一度も来ていない人は「離れている」", () => {
    const r = classifyClientPresence(person(), NOW, 14);
    expect(r.kind === "away" && r.reason).toBe("neverBooked");
  });

  it("🔴 プロフィールの無い空アカウントは「新規」扱いしない", () => {
    // 行が無いと画面側は created_at に「いま」を入れる。信じると、何か月も前の
    // 空アカウントが永遠に「新規・まだ予約がありません」に見える（本番の自社ジムに2件）
    const p = person({ has_profile: false, created_at: new Date(NOW).toISOString() });
    const r = classifyClientPresence(p, NOW, 14);
    expect(r.kind === "away" && r.reason).toBe("neverBooked");
  });

  it("休会中はどこにも数えない", () => {
    const p = person({ status: "suspended", next_booking_date: "2026-09-30T10:00:00+09:00" });
    expect(classifyClientPresence(p, NOW, 14).kind).toBe("suspended");
  });
});

describe("全員を分けた結果", () => {
  const clients = [
    person({ user_id: "a", next_booking_date: "2026-09-25T10:00:00+09:00" }),
    person({ user_id: "b", last_visit_date: "2026-09-20T10:00:00+09:00" }),
    person({ user_id: "c", last_visit_date: "2026-09-10T10:00:00+09:00" }),
    person({ user_id: "d", last_visit_date: "2026-06-01T10:00:00+09:00" }),
    person({ user_id: "e" }),
    person({ user_id: "f", status: "suspended" }),
  ];
  const s = summarizeClientPresence(clients, NOW, 14);

  it("🔴 通っている＋予約待ち＋離れている＝在籍（誰も漏れない・重ならない）", () => {
    expect(s.enrolled).toBe(5);
    expect(s.coming.length + s.awaiting.length + s.away.length).toBe(s.enrolled);
  });

  it("数え方で大きい数字が切り替わる", () => {
    expect(activeClientCount("enrolled", s)).toBe(5);
    expect(activeClientCount("next_booking", s)).toBe(1);
  });

  it("離れている人は、来ていない日数の多い順（旧フォロー一覧と同じ並び）", () => {
    expect(s.away.map((x) => x.client.user_id)).toEqual(["e", "d"]);
  });
});

describe("読めない値は今まで通りに倒す", () => {
  it("数え方", () => {
    expect(resolveActiveClientBasis(undefined)).toBe("enrolled");
    expect(resolveActiveClientBasis("foo")).toBe("enrolled");
    expect(resolveActiveClientBasis("next_booking")).toBe("next_booking");
  });

  it("目安日数", () => {
    expect(resolveFollowUpAfterDays(undefined)).toBe(14);
    expect(resolveFollowUpAfterDays(2)).toBe(14);
    expect(resolveFollowUpAfterDays(91)).toBe(14);
    expect(resolveFollowUpAfterDays(7.5)).toBe(14);
    expect(resolveFollowUpAfterDays(21)).toBe(21);
  });

  it("🔴 tenant の既定値も今まで通り（列が読めない環境で全店の数字が変わらない）", () => {
    expect(TENANT_VALUE_DEFAULTS.active_client_basis).toBe("enrolled");
    expect(TENANT_VALUE_DEFAULTS.follow_up_after_days).toBe(DEFAULT_FOLLOW_UP_AFTER_DAYS);
  });
});

// ────────────────────────────────────────────────────────────────
// 🔴 旧実装と突き合わせ
//
// 2026-09-23 まで TrainerDashboard にあった「フォローが必要な顧客」の判定を**そのまま**写す。
// 変えたのは入力の受け取り方だけ（t() の代わりに名前を素通し）。
// ────────────────────────────────────────────────────────────────
type OldBooking = { user_id: string; date: string; startTime: string; status: string };
type OldProfile = { user_id: string; status: string | null; next_booking_date: string | null; created_at: string | null };

const oldAtRisk = (bookings: OldBooking[], profiles: OldProfile[], now: Date, INACTIVE_DAYS: number) => {
  const visit = new Map<string, { last: string | null; upcoming: boolean }>();
  bookings.forEach((b) => {
    if (b.status === "キャンセル済み" || b.status === "同日キャンセル済み" || b.user_id === "blocked" || b.user_id === "trial-guest") return;
    const dt = new Date(`${b.date}T${b.startTime || "00:00"}:00+09:00`);
    const info = visit.get(b.user_id) || { last: null, upcoming: false };
    if (dt <= now) {
      if (!info.last || b.date > info.last) info.last = b.date;
    } else {
      info.upcoming = true;
    }
    visit.set(b.user_id, info);
  });
  const daysBetween = (fromIso: string) => Math.floor((now.getTime() - new Date(fromIso).getTime()) / 86400000);
  const list: { user_id: string; reason: "lapsed" | "neverBooked"; days: number }[] = [];
  profiles.forEach((p) => {
    if ((p.status ?? "active") !== "active") return;
    const info = visit.get(p.user_id);
    const hasUpcoming = (info?.upcoming ?? false) || !!p.next_booking_date;
    if (hasUpcoming) return;
    if (info?.last) {
      const days = daysBetween(`${info.last}T23:59:59+09:00`);
      if (days >= INACTIVE_DAYS) list.push({ user_id: p.user_id, reason: "lapsed", days });
    } else {
      const joined = p.created_at ? daysBetween(p.created_at) : 0;
      if (joined >= INACTIVE_DAYS) list.push({ user_id: p.user_id, reason: "neverBooked", days: joined });
    }
  });
  return list.sort((a, b) => b.days - a.days);
};

/** useAllCustomerProfiles と同じやり方で、予約から next / last を作る。 */
const toPresenceInputs = (bookings: OldBooking[], profiles: OldProfile[], now: Date): ClientPresenceInput[] => {
  const sorted = [...bookings]
    .filter((b) => b.status !== "キャンセル済み" && b.status !== "同日キャンセル済み")
    .map((b) => ({ ...b, iso: `${b.date}T${b.startTime}:00+09:00` }))
    .sort((a, b) => Date.parse(a.iso) - Date.parse(b.iso));
  const next: Record<string, string> = {};
  const last: Record<string, string> = {};
  for (const b of sorted) {
    if (new Date(b.iso) > now) { if (!next[b.user_id]) next[b.user_id] = b.iso; }
    else last[b.user_id] = b.iso;
  }
  return profiles.map((p) => ({
    user_id: p.user_id,
    status: p.status,
    next_booking_date: next[p.user_id] ?? null,
    last_visit_date: last[p.user_id] ?? null,
    created_at: p.created_at,
    has_profile: true,
  }));
};

/** 決まった順に数を出す（毎回同じ人たちで比べるため）。 */
const rng = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

describe("🔴 旧実装と突き合わせ（既定の店のフォロー一覧が1人も変わらない）", () => {
  const rand = rng(20260923);
  const base = jst("2026-09-23T00:00:00");
  const profiles: OldProfile[] = [];
  const bookings: OldBooking[] = [];
  const statuses = ["active", "active", "active", "active", "suspended", null];
  for (let i = 0; i < 400; i += 1) {
    const id = `u${i}`;
    const joinedAgo = Math.floor(rand() * 200);
    profiles.push({
      user_id: id,
      status: statuses[Math.floor(rand() * statuses.length)],
      next_booking_date: null,
      created_at: new Date(base - joinedAgo * DAY + Math.floor(rand() * DAY)).toISOString(),
    });
    const n = Math.floor(rand() * 5);
    for (let k = 0; k < n; k += 1) {
      const offset = Math.floor(rand() * 120) - 90; // 90日前〜30日後
      const d = new Date(base + offset * DAY);
      const date = jstDateKey(d);
      const hh = String(10 + Math.floor(rand() * 12)).padStart(2, "0");
      const mm = rand() < 0.5 ? "00" : "30";
      const st = rand() < 0.1 ? "キャンセル済み" : rand() < 0.05 ? "同日キャンセル済み" : "予約済み";
      bookings.push({ user_id: id, date, startTime: `${hh}:${mm}`, status: st });
    }
  }

  // 1日の中の境目（深夜・昼・夜）と、日をまたいだ直後を含める
  const nows = [
    "2026-09-23T00:00:30", "2026-09-23T09:59:00", "2026-09-23T12:00:00",
    "2026-09-23T21:31:00", "2026-09-23T23:59:30", "2026-10-07T08:00:00",
  ].map((s) => new Date(jst(s)));

  for (const now of nows) {
    for (const days of [14, 7, 30]) {
      it(`${now.toISOString()} ・ 目安 ${days}日`, () => {
        const withNext = profiles; // next_booking_date は旧実装でも予約から判定される
        const expected = oldAtRisk(bookings, withNext, now, days)
          .map((r) => `${r.user_id}:${r.reason}:${r.days}`);
        const got = summarizeClientPresence(toPresenceInputs(bookings, profiles, now), now.getTime(), days).away
          .map(({ client, presence }) =>
            `${client.user_id}:${presence.kind === "away" ? presence.reason : "?"}:${"days" in presence ? presence.days : "?"}`);
        expect(got).toEqual(expected);
        // 比べる相手がいないと空の一致で緑になる
        expect(expected.length).toBeGreaterThan(5);
      });
    }
  }
});

// ────────────────────────────────────────────────────────────────
// 画面と設定の組み込み
// ────────────────────────────────────────────────────────────────
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
const DASH = strip(readFileSync("src/components/trainer/TrainerDashboard.tsx", "utf8"));
const CARD = strip(readFileSync("src/components/trainer/ActiveClientsSettingsCard.tsx", "utf8"));
const MIGRATION = readFileSync("supabase/migrations/20260923010000_active_client_basis.sql", "utf8");

describe("🔴 ホーム画面", () => {
  it("数字もフォロー一覧も同じ判定から出している", () => {
    expect(DASH).toContain("summarizeClientPresence(profiles, Date.now(), followUpAfterDays)");
    expect(DASH).toContain("presence.away.map(");
    expect(DASH).toContain("activeClientCount(activeClientBasis, presence)");
  });

  it("🔴 画面に別の判定を持ち込んでいない（旧実装の残りが無い）", () => {
    // 戻ってくると「離れている ◯名」とフォロー一覧が食い違う
    expect(DASH).not.toMatch(/INACTIVE_DAYS/);
    expect(DASH).not.toMatch(/profiles\.filter\(\(p\) => isActiveMember\(p\.status\)\)\.length/);
  });

  it("目安日数は設定から読む（14 を直書きしない）", () => {
    expect(DASH).toContain("resolveFollowUpAfterDays(tenant?.follow_up_after_days)");
  });

  it("内訳と「次の予約待ち」は、次回予約ありで数える店だけに出す", () => {
    expect(DASH).toMatch(/sub: activeClientBasis === "next_booking"/);
    expect(DASH).toMatch(/showRetentionAlerts && activeClientBasis === "next_booking" && \(/);
  });
});

describe("🔴 設定", () => {
  it("両方の列を書く", () => {
    expect(CARD).toContain("active_client_basis: resolveActiveClientBasis(v)");
    expect(CARD).toContain("follow_up_after_days: resolveFollowUpAfterDays(Number(v))");
  });

  it("設定画面に置かれている", () => {
    expect(readFileSync("src/components/trainer/TrainerGymSettings.tsx", "utf8")).toContain("<ActiveClientsSettingsCard />");
  });

  it("DB は既定を今まで通りにしている", () => {
    expect(MIGRATION).toMatch(/active_client_basis text NOT NULL DEFAULT 'enrolled'/);
    expect(MIGRATION).toMatch(/follow_up_after_days smallint NOT NULL DEFAULT 14/);
  });

  it("選べる値が DB の CHECK と揃っている", () => {
    const m = /CHECK \(follow_up_after_days BETWEEN (\d+) AND (\d+)\)/.exec(MIGRATION);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(FOLLOW_UP_DAYS_MIN);
    expect(Number(m![2])).toBe(FOLLOW_UP_DAYS_MAX);
    for (const d of FOLLOW_UP_DAY_CHOICES) {
      expect(d).toBeGreaterThanOrEqual(FOLLOW_UP_DAYS_MIN);
      expect(d).toBeLessThanOrEqual(FOLLOW_UP_DAYS_MAX);
    }
    expect(FOLLOW_UP_DAY_CHOICES).toContain(DEFAULT_FOLLOW_UP_AFTER_DAYS);
    for (const b of ACTIVE_CLIENT_BASES) expect(MIGRATION).toContain(`'${b}'`);
  });
});

describe("文言（5言語）", () => {
  for (const lang of ["ja", "en", "ko", "zh-CN", "zh-TW"]) {
    it(lang, () => {
      const j = JSON.parse(readFileSync(`src/locales/${lang}.json`, "utf8"));
      expect(j.dashboard.statActiveClientsNextBooking).toBeTruthy();
      expect(j.dashboard.activeClientsBreakdown).toContain("{{awaiting}}");
      expect(j.dashboard.activeClientsBreakdown).toContain("{{away}}");
      expect(j.awaitingNext.recent).toContain("{{date}}");
      expect(j.awaitingNext.title && j.awaitingNext.new).toBeTruthy();
      for (const b of ACTIVE_CLIENT_BASES) {
        expect(j.settings.trainer.activeClientsBasis[b], `${lang} basis ${b}`).toBeTruthy();
        expect(j.settings.trainer.activeClientsBasisDesc[b], `${lang} desc ${b}`).toBeTruthy();
      }
      expect(j.settings.trainer.followUpAfterOption).toContain("{{days}}");
    });
  }
});
