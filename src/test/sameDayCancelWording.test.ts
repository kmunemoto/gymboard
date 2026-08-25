import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

// 当日キャンセルの消化扱いについて、お客様/トレーナーの目に触れる日本語を
// 「当日キャンセル」に統一していることを見張る。
//
// 以前は「同日キャンセル」と「当日キャンセル」が混在していた。しかも
// ジム設定のトグルはタイトルが「同日キャンセルを…」で説明文が「当日キャンセルされた予約は…」と、
// 同じブロックの中で食い違っていた。メールは「同日」、画面とプッシュは「当日」。
//
// 「当日」に寄せた理由: お客様がキャンセルを確定する直前に見る警告
// （booking.sameDayForfeitWarningDesc）が「当日キャンセルは…」であり、
// 他の4言語（same-day / 당일 / 当天 / 當天）とも語義が一致するため。

/** DBに保存される status 値。既存行がこの文字列なので変更してはいけない。 */
const DB_STATUS_VALUE = "同日キャンセル済み";

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

describe("当日キャンセルの用語", () => {
  it("日本語のUI文言に「同日キャンセル」が残っていない", () => {
    const src = readFileSync("src/locales/ja.json", "utf8");
    expect(src, "ja.json に「同日キャンセル」が残っている").not.toContain("同日キャンセル");
  });

  it("メールテンプレートに「同日キャンセル」が残っていない", () => {
    const dir = "supabase/functions/_shared/transactional-email-templates";
    const offenders = [...walk(dir)].filter((f) =>
      readFileSync(f, "utf8").includes("同日キャンセル"),
    );
    expect(offenders).toEqual([]);
  });

  it("プッシュ/LINEの文面に「同日キャンセル」が残っていない", () => {
    // 見るのは**文字列リテラルの中だけ**。コードコメントは対象外にしている。
    // コメント側は DB の status 値（SAME_DAY_FORFEIT_STATUS = "同日キャンセル済み"）を
    // 指して「同日キャンセル消化」と書いており、そこだけ「当日」に直すと
    // 定数名と食い違って逆に読みにくくなるため、意図的に据え置いている。
    const quoted = /["'`][^"'`]*同日キャンセル/;
    const offenders: string[] = [];
    for (const file of walk("src")) {
      if (!/\.tsx?$/.test(file) || file.startsWith("src/test/")) continue;
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        if (line.includes(DB_STATUS_VALUE)) return;             // DBのstatus値
        if (quoted.test(line)) offenders.push(`${file}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("DBのstatus値は「同日キャンセル済み」のまま（変更すると既存の予約が迷子になる）", () => {
    // 本番の bookings.status に既にこの文字列が入っている。用語統一に巻き込んで
    // 書き換えると、消化数カウントも予定表の表示も既存行を拾えなくなる。
    // 定義は src/lib/bookingStatus.ts（2026-08-26 に hooks から降ろした。
    // lib が hooks を import しないようにするため。mem/ops/strict-ratchet.md）
    const src = readFileSync("src/lib/bookingStatus.ts", "utf8");
    expect(src).toContain(`export const SAME_DAY_FORFEIT_STATUS = "${DB_STATUS_VALUE}";`);
  });

  it("useBookings から今も import できる（呼び出し側を壊さない）", () => {
    // 移動しても `@/hooks/useBookings` から取れるようにしてある。
    // 再エクスポートを消すと、既存の import が静かに壊れる
    const hook = readFileSync("src/hooks/useBookings.ts", "utf8");
    expect(hook).toContain('export { SAME_DAY_FORFEIT_STATUS } from "@/lib/bookingStatus";');
  });

  it("設定画面のタイトルと説明文で用語が食い違っていない", () => {
    // ここが元々ちぐはぐだった箇所。
    const ja = JSON.parse(readFileSync("src/locales/ja.json", "utf8"));
    const trainer = ja.settings.trainer;
    expect(trainer.sameDayPenaltyTitle).toContain("当日キャンセル");
    expect(trainer.sameDayPenaltyDesc).toContain("当日キャンセル");
  });

  it("「毎月同日に自動更新」など別の意味の『同日』は残す", () => {
    // 課金日の「同日」は当日キャンセルとは無関係。巻き込んで消していないことを確認する。
    const src = readFileSync("src/locales/ja.json", "utf8");
    expect(src).toContain("毎月同日に自動更新");
  });
});
