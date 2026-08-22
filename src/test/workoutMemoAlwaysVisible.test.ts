import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// トレーニング記録の「その日のメモ」を一覧で常時表示する（2026-08-22）
//
// 実店舗の要望:「メモが編集画面を開かないと読めない。過去のセッションを
// スクロールしているだけで常に見えるようにしてほしい」。
// メモは日単位で、保存時にその日の全行へ同じ値が書かれる（handleSave の rows）。
// 表示は「その日の行のうち notes が空でない最初の行」から拾う
// （openEdit の existingMemo と同じ規則。規則がずれると編集画面と一覧で
// 違うメモが出るので、この一致をソースで固定する）。

const SRC = "src/components/trainer/TrainerClientDetail.tsx";

describe("トレーニング記録のメモは一覧で常時表示", () => {
  const src = readFileSync(SRC, "utf8");

  it("記録タブと概要タブの両方の一覧にメモ表示がある（日単位・openEdit と同じ規則）", () => {
    const rule = src.match(/groupedRecords\[date\]\.find\(\(r\) => r\.notes && r\.notes\.trim\(\)\)\?\.notes/g) || [];
    expect(rule.length, "一覧のメモ表示（記録タブ＋概要タブ）が2箇所あるはず").toBe(2);
    // 編集画面へ引き継ぐ既存の規則も同じ（find + trim）で残っている
    expect(src).toMatch(/records\.find\(r => r\.notes && r\.notes\.trim\(\)\)\?\.notes/);
  });

  it("改行を保持し、長文でもはみ出さない", () => {
    const memoP = src.match(/whitespace-pre-wrap break-words min-w-0/g) || [];
    expect(memoP.length).toBeGreaterThanOrEqual(2);
  });
});
