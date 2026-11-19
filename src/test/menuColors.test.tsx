/**
 * 店側の予定表で、予約をメニューごとに色分けする（2026-11-19）。
 *
 * 宗本さん「トレーニングとピラティスみたいな、トレーニングに合わせて予約の色変えれる？
 * このジム側のスケジュールの画面」→ 色の決め方は「自動で色分けだけ」（設定は増やさない）。
 *
 * 🔴 壊しやすいもの:
 *   1. トレーニング（いつものメニュー）・メニューの無い予約・メニューが1つの店の色が変わる（今の色のまま）
 *   2. ほかのメニューにテーマ色と見分けにくい色が付く（色相が近い・トーンが違う・白い文字が読めない）
 *   3. 使っていないメニュー（外したヨガ）に、いちばん見分けやすい色を取られる
 *   4. オプション付きの印（左の帯・「＋」）が、メニューの色の予約で消える
 *   5. ブロック（休み）の見た目が変わる
 *   6. 凡例がトレーニングだけの週にも出る／色の付いた予約があるのに出ない
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, renderHook, screen, cleanup, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import "@/lib/i18n";
import type { BookingMenu } from "@/lib/bookingMenus";
import {
  MIN_HUE_FROM_THEME, currentThemeRef, hslCss, hueDistance, menuColorMap, menuColorOf, menuGradientStyle,
  type MenuColor, type ThemeRef,
} from "@/lib/menuColors";
import { THEME_FAMILIES, THEME_TONES, buildThemeTriple, contrastWithWhite } from "@/lib/themePalette";
import type { BookingWithTime } from "@/hooks/useBookings";
import WeekTimelineView from "@/components/trainer/WeekTimelineView";
import MenuColorLegend from "@/components/trainer/MenuColorLegend";
import { useMenuColors } from "@/hooks/useMenuColors";

afterEach(() => {
  cleanup();
  localStorage.removeItem("gymboard.themeColor");
});

const menu = (id: string, name: string, sort: number, opts: Partial<BookingMenu> = {}): BookingMenu => ({
  id, name, staff_user_id: null, is_active: true, sort_order: sort, starts_on: null, ...opts,
});
// 御所南と同じ形: トレーニング（担当なし）・ヨガ（外している）・マシンピラティス（担当あり）
const TRAINING = menu("m-training", "トレーニング", 0);
const YOGA = menu("m-yoga", "ヨガ", 1, { staff_user_id: "inst", is_active: false });
const PILATES = menu("m-pilates", "マシンピラティス", 2, { staff_user_id: "inst" });
const SALUTE = [TRAINING, YOGA, PILATES];

const ROSE_DUSTY: ThemeRef = { family: "rose", tone: "dusty" };
const familyHue = (id: string) => THEME_FAMILIES.find((f) => f.id === id)!.hue;
const ALL_THEMES: ThemeRef[] = THEME_FAMILIES.flatMap((f) => THEME_TONES.map((tone) => ({ family: f.id, tone })));

/** その色が、どの色（family）の・どのトーンで作られたか */
const sourceOf = (c: MenuColor) => {
  for (const f of THEME_FAMILIES) {
    for (const tone of THEME_TONES) {
      if (buildThemeTriple(f.id, tone).accent === c.accent) return { family: f.id, tone, hue: f.hue, neutral: "neutral" in f };
    }
  }
  throw new Error(`palette の色ではない: ${c.accent}`);
};

describe("🔴 トレーニング・メニューの無い予約・メニューが1つの店は今の色のまま", () => {
  it("メニューが0・1個の店は何も色分けしない", () => {
    expect(menuColorMap([], ROSE_DUSTY).size).toBe(0);
    const one = menuColorMap([TRAINING], ROSE_DUSTY);
    expect(one.size).toBe(0);
    expect(menuColorOf(one, TRAINING.id)).toBeNull();
  });

  it("いつものメニュー（担当のいない先頭＝トレーニング）は null（テーマ色）", () => {
    const map = menuColorMap(SALUTE, ROSE_DUSTY);
    expect(map.has(TRAINING.id)).toBe(true);
    expect(map.get(TRAINING.id)).toBeNull();
    expect(menuColorOf(map, TRAINING.id)).toBeNull();
  });

  it("メニューの無い予約（menu_id が NULL）・知らないメニューは今の色", () => {
    const map = menuColorMap(SALUTE, ROSE_DUSTY);
    expect(menuColorOf(map, null)).toBeNull();
    expect(menuColorOf(map, undefined)).toBeNull();
    expect(menuColorOf(map, "m-unknown")).toBeNull();
  });
});

describe("🔴 ほかのメニューは、テーマ色と見分けやすい色（同じトーン・離れた色相・白い文字が読める）", () => {
  it("御所南（ローズ・ダスティ）: マシンピラティスはティール・ダスティ（いちばん離れた色）", () => {
    const map = menuColorMap(SALUTE, ROSE_DUSTY);
    const pilates = menuColorOf(map, PILATES.id)!;
    expect(pilates).not.toBeNull();
    expect(pilates.accent).toBe(buildThemeTriple("teal", "dusty").accent);
    expect(pilates.accent2).toBe(buildThemeTriple("teal", "dusty").accent2);
  });

  it("🔴 受付中のメニューが先: 外したヨガ（並びは先）に、いちばん見分けやすい色を取られない", () => {
    const map = menuColorMap(SALUTE, ROSE_DUSTY);
    const pilates = sourceOf(menuColorOf(map, PILATES.id)!);
    const yoga = sourceOf(menuColorOf(map, YOGA.id)!);
    const theme = familyHue("rose");
    expect(hueDistance(pilates.hue, theme)).toBeGreaterThan(hueDistance(yoga.hue, theme));
    // どちらも受付中なら並び順（ヨガが先にいちばん離れた色）
    const bothActive = menuColorMap([TRAINING, { ...YOGA, is_active: true }, PILATES], ROSE_DUSTY);
    expect(menuColorOf(bothActive, "m-yoga")!.accent).toBe(buildThemeTriple("teal", "dusty").accent);
  });

  it("全部のテーマ色（16色×4トーン）で: 同じトーン・テーマ色から60度以上・互いに違う色・白い文字が3:1以上", () => {
    const many = [
      TRAINING,
      menu("a", "A", 1, { staff_user_id: "s" }),
      menu("b", "B", 2, { staff_user_id: "s" }),
      menu("c", "C", 3, { staff_user_id: "s" }),
      menu("d", "D", 4, { staff_user_id: "s" }),
      menu("e", "E", 5, { staff_user_id: "s", is_active: false }),
    ];
    for (const theme of ALL_THEMES) {
      const map = menuColorMap(many, theme);
      expect(map.get(TRAINING.id), `${theme.family}-${theme.tone}`).toBeNull();
      const colors = many.slice(1).map((m) => menuColorOf(map, m.id)!);
      const sources = colors.map(sourceOf);
      const themeFamily = THEME_FAMILIES.find((f) => f.id === theme.family)!;
      for (const [i, s] of sources.entries()) {
        const label = `${theme.family}-${theme.tone} → ${s.family}`;
        expect(s.tone, label).toBe(theme.tone);
        expect(s.neutral, label).toBe(false);
        if (!("neutral" in themeFamily)) {
          expect(hueDistance(s.hue, themeFamily.hue), label).toBeGreaterThanOrEqual(MIN_HUE_FROM_THEME);
        }
        expect(contrastWithWhite(colors[i].accent), label).toBeGreaterThanOrEqual(3);
      }
      expect(new Set(sources.map((s) => s.family)).size, `${theme.family}-${theme.tone}`).toBe(sources.length);
    }
  });

  it("同じ入力なら毎回同じ色（端末の中で色が入れ替わらない）", () => {
    const a = menuColorMap(SALUTE, ROSE_DUSTY);
    const b = menuColorMap(SALUTE, ROSE_DUSTY);
    expect([...a.entries()]).toEqual([...b.entries()]);
  });

  it("メニューが候補の色より多くても色が付く（もう一周する）", () => {
    const lots = [TRAINING, ...Array.from({ length: 14 }, (_, i) => menu(`x${i}`, `X${i}`, i + 1, { staff_user_id: "s" }))];
    const map = menuColorMap(lots, ROSE_DUSTY);
    for (const m of lots.slice(1)) {
      const c = menuColorOf(map, m.id);
      expect(c, m.id).not.toBeNull();
      // グレー（無彩色）は使わない（「使えない予約」に見える）
      expect(sourceOf(c!).neutral, m.id).toBe(false);
    }
  });

  it("テーマ色はこの端末の設定（localStorage）から読む。古い id・読めない値も受ける", () => {
    localStorage.setItem("gymboard.themeColor", "rose-dusty");
    expect(currentThemeRef()).toEqual({ family: "rose", tone: "dusty" });
    localStorage.setItem("gymboard.themeColor", "violet"); // 6色だったころの id
    expect(currentThemeRef()).toEqual({ family: "violet", tone: "vivid" });
    localStorage.setItem("gymboard.themeColor", "???");
    expect(currentThemeRef()).toEqual({ family: "teal", tone: "soft" });
    localStorage.removeItem("gymboard.themeColor");
    expect(currentThemeRef()).toEqual({ family: "teal", tone: "soft" });
  });
});

// ── 週の予定表 ────────────────────────────────────────────────────────────

const WEEK_START = new Date(2026, 10, 23); // 11/23（月）
const booking = (id: string, name: string, opts: Partial<BookingWithTime> = {}): BookingWithTime => ({
  id, user_id: `u-${id}`, date: "2026-11-25", startTime: "10:00", endTime: "11:00",
  clientName: name, status: "予約済み", booking_type: "月4回", ...opts,
});
const OPTION = [{ id: "opt-1", name: "TestOpt", duration_minutes: 15, price_yen: 0 }];

const renderWeek = (bookings: BookingWithTime[], withColors = true) =>
  render(
    <WeekTimelineView
      weekStart={WEEK_START}
      bookings={bookings}
      menus={SALUTE}
      menuColors={withColors ? menuColorMap(SALUTE, ROSE_DUSTY) : undefined}
    />,
  );
const card = (name: string) => screen.getByTitle(new RegExp(`^${name} `));
const PILATES_FILL = hslCss(buildThemeTriple("teal", "dusty").accent);
const toRgb = (hsl: string) => {
  const probe = document.createElement("div");
  probe.style.backgroundColor = hsl;
  return probe.style.backgroundColor;
};

describe("🔴 週の予定表のカード", () => {
  it("（前提）テストの環境がメニューの色を色として読める＝下の色の比較が空どうしで素通りしない", () => {
    expect(PILATES_FILL).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/);
    expect(toRgb(PILATES_FILL)).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    expect(menuGradientStyle(menuColorOf(menuColorMap(SALUTE, ROSE_DUSTY), PILATES.id)!).backgroundImage)
      .toBe(`linear-gradient(135deg, ${PILATES_FILL}, ${hslCss(buildThemeTriple("teal", "dusty").accent2)})`);
  });

  it("マシンピラティスの予約はメニューの色で塗る（bg-accent を付けない・白い文字）", () => {
    renderWeek([booking("p", "坂部", { menuId: PILATES.id, startTime: "14:30", endTime: "15:30" })]);
    const el = card("坂部");
    expect(el.className).not.toContain("bg-accent");
    expect(el.className).not.toContain("bg-primary");
    expect(el.style.backgroundColor).toBe(toRgb(PILATES_FILL));
    expect(el.style.color).toBe("rgb(255, 255, 255)");
    // 説明（長押し・マウスで出る）にメニュー名
    expect(el.getAttribute("title")).toContain("マシンピラティス");
  });

  it("トレーニング・メニューの無い予約は今まで通り bg-accent（style で塗らない）", () => {
    renderWeek([
      booking("t", "大谷", { menuId: TRAINING.id }),
      booking("n", "北野", { menuId: null, startTime: "12:00", endTime: "13:00" }),
    ]);
    for (const name of ["大谷", "北野"]) {
      const el = card(name);
      expect(el.className, name).toContain("bg-accent");
      expect(el.style.backgroundColor, name).toBe("");
    }
  });

  it("🔴 オプション付き: トレーニングは今まで通り bg-primary＋帯、ピラティスはメニューの色＋帯＋「＋」", () => {
    renderWeek([
      booking("to", "中本", { menuId: TRAINING.id, bookingOptions: OPTION }),
      booking("po", "石田", { menuId: PILATES.id, bookingOptions: OPTION, startTime: "16:00", endTime: "17:00" }),
    ]);
    const training = card("中本");
    expect(training.className).toContain("bg-primary");
    expect(training.className).toContain("border-l-warning");
    const pilates = card("石田");
    expect(pilates.className).not.toContain("bg-primary");
    expect(pilates.className).toContain("border-l-4");
    expect(pilates.className).toContain("border-l-warning");
    expect(pilates.style.backgroundColor).toBe(toRgb(PILATES_FILL));
    expect(within(pilates).getByText("＋")).toBeInTheDocument();
  });

  it("ブロック（休み）は今まで通り（メニューの色を付けない）", () => {
    renderWeek([booking("b", "休み", { user_id: "blocked", isBlocked: true, menuId: PILATES.id })]);
    const el = card("休み");
    expect(el.className).toContain("bg-muted");
    expect(el.style.backgroundColor).toBe("");
  });

  it("色を渡さなければ今まで通り（全部 bg-accent）", () => {
    renderWeek([booking("p", "坂部", { menuId: PILATES.id })], false);
    const el = card("坂部");
    expect(el.className).toContain("bg-accent");
    expect(el.style.backgroundColor).toBe("");
  });
});

// ── 凡例 ──────────────────────────────────────────────────────────────────

describe("🔴 凡例（どの色がどのメニューか）", () => {
  const colors = menuColorMap(SALUTE, ROSE_DUSTY);

  it("ピラティスの予約がある週: トレーニング（今の色）とマシンピラティス（メニューの色）を出す", () => {
    render(<MenuColorLegend menus={SALUTE} colors={colors} menuIds={[TRAINING.id, null, PILATES.id]} />);
    const legend = screen.getByTestId("menu-color-legend");
    expect(legend).toHaveAttribute("aria-label", "メニューの色");
    expect(legend).toHaveTextContent("トレーニング");
    expect(legend).toHaveTextContent("マシンピラティス");
    expect(legend).not.toHaveTextContent("ヨガ"); // この週に無いメニューは出さない
    const [trainingSwatch, pilatesSwatch] = within(legend).getAllByTestId("menu-color-swatch");
    expect(trainingSwatch.className).toContain("bg-accent");
    expect(pilatesSwatch.style.backgroundColor).toBe(toRgb(PILATES_FILL));
  });

  it("トレーニングだけの週・メニューの無い予約だけの週は出さない（今まで通り）", () => {
    const { container } = render(<MenuColorLegend menus={SALUTE} colors={colors} menuIds={[TRAINING.id, null, undefined]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("メニューが1つの店は出さない", () => {
    const { container } = render(
      <MenuColorLegend menus={[TRAINING]} colors={menuColorMap([TRAINING], ROSE_DUSTY)} menuIds={[TRAINING.id]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

// ── 店側の予定表（TrainerSchedule）へのつなぎ ─────────────────────────────

const SCHEDULE = readFileSync("src/components/trainer/TrainerSchedule.tsx", "utf8");

describe("🔴 予定表へのつなぎ", () => {
  it("週の予定表にメニューと色を渡している", () => {
    expect(SCHEDULE).toMatch(/<WeekTimelineView[\s\S]{0,200}menus=\{allMenus\}[\s\S]{0,80}menuColors=\{menuColors\}/);
  });

  it("色は useMenuColors(allMenus) から（この端末のテーマ色で作る）", () => {
    expect(SCHEDULE).toMatch(/const \{ menuColors, menuCardStyle \} = useMenuColors\(allMenus\);/);
  });

  it("凡例はその週の予約（ブロックを除く）のメニューから出す", () => {
    expect(SCHEDULE).toMatch(
      /<MenuColorLegend[\s\S]{0,200}menuIds=\{weekDays\.flatMap\(\(d\) => getDayBookings\(d\)\)\.filter\(\(b\) => !b\.isBlocked\)\.map\(\(b\) => b\.menuId\)\}/,
    );
  });

  it("日の予定表（PC の表・スマホの頭文字）もメニューの色で塗る", () => {
    expect(SCHEDULE.match(/style=\{menuCardStyle\((session|booking)\)\}/g)?.length).toBe(2);
    expect(SCHEDULE.match(/menuCardStyle\((session|booking)\) \? "" : "accent-gradient text-accent-foreground"/g)?.length).toBe(2);
  });
});

describe("🔴 useMenuColors（この端末のテーマ色で作る・日の予定表の塗り）", () => {
  it("ローズ・ダスティの端末: ピラティスはティールのグラデーション、トレーニング・ブロックは塗らない", () => {
    localStorage.setItem("gymboard.themeColor", "rose-dusty");
    const { result } = renderHook(() => useMenuColors(SALUTE));
    expect(menuColorOf(result.current.menuColors, PILATES.id)!.accent).toBe(buildThemeTriple("teal", "dusty").accent);
    const teal = buildThemeTriple("teal", "dusty");
    expect(result.current.menuCardStyle({ menuId: PILATES.id })).toEqual({
      backgroundImage: `linear-gradient(135deg, ${hslCss(teal.accent)}, ${hslCss(teal.accent2)})`,
      color: "#fff",
    });
    expect(result.current.menuCardStyle({ menuId: TRAINING.id })).toBeUndefined();
    expect(result.current.menuCardStyle({ menuId: null })).toBeUndefined();
    expect(result.current.menuCardStyle({ menuId: PILATES.id, isBlocked: true })).toBeUndefined();
  });

  it("テーマ色を変えたら色も変わる（ティール・ソフトの端末ではピラティスはティールにならない）", () => {
    localStorage.setItem("gymboard.themeColor", "teal-soft");
    const { result } = renderHook(() => useMenuColors(SALUTE));
    const c = sourceOf(menuColorOf(result.current.menuColors, PILATES.id)!);
    expect(c.tone).toBe("soft");
    expect(hueDistance(c.hue, familyHue("teal"))).toBeGreaterThanOrEqual(MIN_HUE_FROM_THEME);
  });
});

describe("凡例の読み上げ名は5言語", () => {
  for (const lng of ["ja", "en", "ko", "zh-CN", "zh-TW"]) {
    it(lng, () => {
      const d = JSON.parse(readFileSync(`src/locales/${lng}.json`, "utf8"));
      expect(typeof d.schedule.menuColorLegend).toBe("string");
      expect(d.schedule.menuColorLegend.trim()).not.toBe("");
    });
  }
});
