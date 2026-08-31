import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { parseVideoUrl, isSupportedVideoUrl, formatDuration, parseDurationInput } from "@/lib/videoEmbed";
import { NAV_TAB_TOGGLES, presetToValues } from "@/lib/gymDisplaySettings";
import { TENANT_OPTIONAL_COL_GROUPS, TENANT_DEFAULT_TRUE_COLS } from "@/lib/tenantColumns";

// 自宅ストレッチ動画ライブラリ（2026-08-31）の見張り。
//
// 🔴 決めごと（宗本さん決定）:
//   1. 動画ファイルは受け取らない。YouTube / Vimeo の限定公開URLを貼る方式
//      （尺・容量・転送量の原価をジムボード側に乗せない。経緯はマイグレーションの冒頭）
//   2. 公開範囲は「そのジムのお客様全員」。お客様ごとの割り当ては持たない
//   3. お客様側の入口はホームのカードだけ。下部ナビには足さない
//      （お客様側にジムごとの表示ON/OFFが無いので、足すと全テナントに出る）

const MIGRATION = "supabase/migrations/20260831010000_gym_videos.sql";
const DELETE_GYM = "supabase/migrations/20260831010500_delete_gym_videos.sql";
const CUSTOMER = "src/components/customer/CustomerVideos.tsx";
const TRAINER = "src/components/trainer/TrainerVideoManager.tsx";
const HOME = "src/components/customer/CustomerHome.tsx";
const BOTTOM_NAV = "src/components/customer/BottomNav.tsx";

const read = (p: string) => readFileSync(p, "utf8");

describe("🔴 貼られたURLをそのまま iframe に入れない", () => {
  it("javascript: / data: / http: は解析できない", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://evil.example.com/watch?v=dQw4w9WgXcQ",
    ]) {
      expect(parseVideoUrl(bad), `${bad} を通しています`).toBeNull();
    }
  });

  it("YouTube に似せた別ドメインを弾く（末尾一致で見る）", () => {
    // `evil-youtube.com` や `youtube.com.evil.jp` を YouTube と誤認しない
    expect(parseVideoUrl("https://evil-youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseVideoUrl("https://youtube.com.evil.jp/watch?v=dQw4w9WgXcQ")).toBeNull();
    // 正規のサブドメインは通す
    expect(parseVideoUrl("https://m.youtube.com/watch?v=dQw4w9WgXcQ")?.id).toBe("dQw4w9WgXcQ");
  });

  it("動画IDに使えない文字が混ざったURLは解析できない", () => {
    // ここを通すと、埋め込みURLに `?` や `"` を差し込まれる
    expect(parseVideoUrl('https://www.youtube.com/watch?v=abc"onload=x')).toBeNull();
    expect(parseVideoUrl("https://youtu.be/abc%22def")).toBeNull();
  });

  it("組み立てた埋め込みURLは、こちらが持つ雛形と動画IDだけでできている", () => {
    const p = parseVideoUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s&feature=share");
    expect(p).not.toBeNull();
    // 元のURLの余計なパラメータ（t / feature）は1つも引き継がない
    expect(p!.embedUrl).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&modestbranding=1&playsinline=1",
    );
    expect(p!.embedUrl).not.toContain("feature");
  });

  it("画面側は parseVideoUrl の結果しか iframe に渡していない", () => {
    for (const p of [CUSTOMER, TRAINER]) {
      const src = read(p);
      const iframes = [...src.matchAll(/<iframe[\s\S]*?\/>/g)];
      expect(iframes.length, `${p}: iframe が見つからない`).toBeGreaterThan(0);
      for (const [tag] of iframes) {
        expect(tag, `${p}: iframe の src が embedUrl 以外`).toMatch(/src=\{[a-zA-Z]+\.embedUrl\}/);
        expect(tag, `${p}: 生の video_url を src に入れている`).not.toContain("video_url");
      }
    }
  });

  it("DB 側でも https 以外を弾いている（画面を通さない経路への保険）", () => {
    expect(read(MIGRATION)).toContain("video_url LIKE 'https://%'");
  });
});

describe("URL の解析", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?t=42", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/live/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["  https://www.youtube.com/watch?v=dQw4w9WgXcQ  ", "dQw4w9WgXcQ"],
  ])("YouTube: %s", (url, id) => {
    const p = parseVideoUrl(url);
    expect(p?.provider).toBe("youtube");
    expect(p?.id).toBe(id);
    expect(p?.thumbnailUrl).toBe(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
  });

  it("Vimeo の限定公開（ハッシュ付き）は埋め込みURLにハッシュを持ち越す", () => {
    // ハッシュを落とすと限定公開の動画が「プライベート」で再生できなくなる
    const p = parseVideoUrl("https://vimeo.com/123456789/abcdef1234");
    expect(p?.provider).toBe("vimeo");
    expect(p?.id).toBe("123456789");
    expect(p?.privacyHash).toBe("abcdef1234");
    expect(p?.embedUrl).toContain("h=abcdef1234");
    expect(p?.watchUrl).toBe("https://vimeo.com/123456789/abcdef1234");
  });

  it("Vimeo: player 形式と ?h= も読める", () => {
    const p = parseVideoUrl("https://player.vimeo.com/video/123456789?h=abcdef1234");
    expect(p?.id).toBe("123456789");
    expect(p?.privacyHash).toBe("abcdef1234");
  });

  it("Vimeo: サムネイルは取得できないので null（一覧は代替の絵を出す）", () => {
    expect(parseVideoUrl("https://vimeo.com/123456789")?.thumbnailUrl).toBeNull();
  });

  it("空・未設定・対応外は null", () => {
    for (const v of [null, undefined, "", "   ", "ただの文字列", "https://example.com/video.mp4"]) {
      expect(parseVideoUrl(v)).toBeNull();
    }
    expect(isSupportedVideoUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(true);
    expect(isSupportedVideoUrl("https://example.com")).toBe(false);
  });
});

describe("尺の表示と入力", () => {
  it.each([
    [null, null],
    [0, null],
    [-5, null],
    [45, "45秒"],
    [180, "3分"],
    [200, "3分"],
    [210, "4分"],
    [3600, "1時間"],
    [3900, "1時間5分"],
  ])("formatDuration(%s) = %s", (input, expected) => {
    expect(formatDuration(input as number | null)).toBe(expected);
  });

  it.each([
    ["", null],
    ["3:20", 200],
    ["1:02:03", 3723],
    ["3分20秒", 200],
    ["3分", 180],
    ["90秒", 90],
    ["200", 200],
    ["3:99", null],
    ["あ", null],
  ])("parseDurationInput(%s) = %s", (input, expected) => {
    expect(parseDurationInput(input)).toBe(expected);
  });

  it("「3:20」と「200」が同じ秒数になる（素の数字は分ではなく秒）", () => {
    expect(parseDurationInput("200")).toBe(parseDurationInput("3:20"));
  });
});

describe("DB（migration）", () => {
  const sql = read(MIGRATION);

  it("テナント境界が RESTRICTIVE で入っている", () => {
    expect(sql).toMatch(/CREATE POLICY tenant_isolation ON public\.gym_videos AS RESTRICTIVE/);
    expect(sql).toContain("tenant_id = public.get_my_tenant_id()");
  });

  it("🔴 お客様には公開済みだけ見せる（トレーナーは予約公開分も見える）", () => {
    expect(sql).toMatch(
      /gym_videos_select[\s\S]*?USING \(public\.has_role\(auth\.uid\(\), 'trainer'::app_role\) OR published_at <= now\(\)\)/,
    );
  });

  it("🔴 書き込みは trainer だけ（お客様が動画を足せない）", () => {
    for (const op of ["insert", "update", "delete"]) {
      const m = sql.match(new RegExp(`CREATE POLICY gym_videos_${op}[\\s\\S]*?;`));
      expect(m, `${op} のポリシーが無い`).not.toBeNull();
      expect(m![0], `${op} が trainer に限定されていない`).toContain("has_role(auth.uid(), 'trainer'::app_role)");
    }
  });

  it("🔴 動画ファイル用のバケットを作っていない（URL方式を守る）", () => {
    // ここに storage.buckets が現れたら、原価の話（席数だけの価格表）に戻る必要がある
    expect(sql).not.toMatch(/storage\.buckets/i);
    expect(sql).not.toMatch(/storage\.objects/i);
  });

  it("show_nav_videos は既定 true（いま在るジムの見え方を変えない）", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS show_nav_videos BOOLEAN NOT NULL DEFAULT true");
  });
});

describe("閉店時の消し込み", () => {
  const fn = read(DELETE_GYM);

  it("delete_my_gym が gym_videos を消す", () => {
    expect(fn).toMatch(/DELETE FROM public\.gym_videos\s+WHERE tenant_id = v_tenant_id;/);
  });

  it("最新の版から写している（間に増えたテーブルを落としていない）", () => {
    // 直前の版（20260826020000）にあった消し込みが1つも消えていないこと
    const prev = read("supabase/migrations/20260826020000_delete_gym_email_log.sql");
    const tables = [...prev.matchAll(/DELETE FROM public\.([a-z_]+)/g)].map((m) => m[1]);
    const missing = tables.filter((t) => !new RegExp(`DELETE FROM public\\.${t}\\b`).test(fn));
    expect(missing, `古い版から書き直したため消し込みが失われています: ${missing.join(", ")}`).toEqual([]);
  });
});

describe("配線", () => {
  it("トレーナー側のタブが表示トグルに登録されている", () => {
    const entry = NAV_TAB_TOGGLES.find((n) => n.tab === "videos");
    expect(entry, "NAV_TAB_TOGGLES に videos が無い（設定画面に出てこない）").toBeTruthy();
    expect(entry!.column).toBe("show_nav_videos");
  });

  it("tenants の列が select グループと既定 true の両方に登録されている", () => {
    // 片方だけだと「設定にはあるのに読めない」ズレになる（tenantColumns.ts 冒頭参照）
    expect(TENANT_OPTIONAL_COL_GROUPS.some((g) => g.includes("show_nav_videos"))).toBe(true);
    expect(TENANT_DEFAULT_TRUE_COLS).toContain("show_nav_videos");
  });

  it("simple プリセットでは出さない / standard 以上では出す", () => {
    expect(presetToValues("simple").show_nav_videos).toBe(false);
    expect(presetToValues("standard").show_nav_videos).toBe(true);
    expect(presetToValues("full").show_nav_videos).toBe(true);
  });

  it("🔴 お客様の下部ナビには足していない（足すと全テナントに出る）", () => {
    // お客様側にはジムごとの表示ON/OFFの仕組みが無い。入口はホームのカードだけ。
    expect(read(BOTTOM_NAV)).not.toContain('"videos"');
  });

  it("🔴 ホームのカードは動画が0本なら出さない（自己ゲート）", () => {
    const home = read(HOME);
    expect(home).toContain("useGymVideoCount");
    expect(home, "0本でもカードが出る書き方になっている").toMatch(/\{videoCount > 0 && \(/);
  });
});

describe("お客様の画面", () => {
  const src = read(CUSTOMER);

  it("開けないURLの動画は一覧に出さない（押しても何も起きないカードを作らない）", () => {
    expect(src).toMatch(/if \(!parseVideoUrl\(v\.video_url\)\) continue;/);
  });

  it("WebView で再生できないときの逃げ道がある", () => {
    // 埋め込みを禁止した動画・年齢制限などで再生できないことがある
    expect(src).toContain("openExternalUrl(parsed.watchUrl)");
  });

  it("公開日時のフィルタをクライアント側でも掛けている（RLS との二重掛け）", () => {
    expect(read("src/hooks/useGymVideos.ts")).toContain('q.lte("published_at"');
  });
});

describe("トレーナーの画面", () => {
  const src = read(TRAINER);

  it("保存する前に、貼ったURLをその場で再生して確かめられる", () => {
    expect(src).toContain("preview.embedUrl");
  });

  it("解析できないURLは保存させない", () => {
    expect(src).toMatch(/if \(!preview\) \{ toast\.error\(t\("gymVideo\.errUrl"\)\); return; \}/);
  });

  it("🔴 更新時に tenant_id を送らない（テナントの付け替えを許さない）", () => {
    const hook = read("src/hooks/useGymVideos.ts");
    const updateFn = hook
      .slice(hook.indexOf("const update ="), hook.indexOf("const remove ="))
      // コメントには tenant_id の話が書いてあるので、コードだけを見る
      .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(updateFn).not.toContain("withTenant");
    expect(updateFn).not.toContain("tenant_id");
  });
});

describe("i18n（5言語）", () => {
  const LOCALES = ["ja", "en", "ko", "zh-CN", "zh-TW"];
  const VIDEO_KEYS = ["title", "subtitle", "empty", "uncategorized", "openExternal", "homeCardDesc"];
  const MANAGER_KEYS = [
    "title", "desc", "add", "empty", "urlLabel", "urlHelp", "previewTitle",
    "titleLabel", "titlePlaceholder", "descLabel", "descPlaceholder",
    "categoryLabel", "durationLabel", "scheduleLabel", "scheduleNow", "scheduleLater",
    "scheduled", "badUrl", "openExternal", "moveUp", "moveDown",
    "deleteTitle", "deleteDesc", "errTitle", "errUrl", "errSchedule", "errDuration",
    "createdToast", "updatedToast", "deletedToast", "saveFailed", "deleteFailed", "loadFailed",
  ];

  it.each(LOCALES)("%s にキーが揃っている", (loc) => {
    const d = JSON.parse(read(`src/locales/${loc}.json`));
    for (const k of VIDEO_KEYS) expect(d.videos?.[k], `${loc}: videos.${k} が無い`).toBeTruthy();
    for (const k of MANAGER_KEYS) expect(d.gymVideo?.[k], `${loc}: gymVideo.${k} が無い`).toBeTruthy();
    expect(d.trainerNav?.videos, `${loc}: trainerNav.videos が無い`).toBeTruthy();
    expect(d.trainerNav?.mVideos, `${loc}: trainerNav.mVideos が無い`).toBeTruthy();
  });
});
