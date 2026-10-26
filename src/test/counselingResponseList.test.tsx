import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import i18n from "@/lib/i18n";

// counseling.purpose のラベルが i18n から動的に引かれることの回帰テスト。
// 以前は PURPOSE_KEYS という固定配列がコードに直書きされており、業種特化フォークが
// vertical.ja.json に業種固有の目的を足しても選択肢が増えなかった（2026-08 監査で指摘）。
// 配列を無くして i18n のキー集合をそのまま使う形に直したので、
// (a) 既知キーが ja.json のラベルで表示されること (b) 未知キーでも落ちずに素通しされること
// の両方を確認する。

afterEach(() => {
  cleanup();
  vi.resetModules();
});

const RESPONSE_BASE = {
  id: "r1",
  last_name: "山田",
  first_name: "太郎",
  last_name_kana: null,
  first_name_kana: null,
  age: null,
  gender: null,
  phone: null,
  email: null,
  ward: null,
  experience_level: null,
  target_frequency: null,
  exercise_habit: null,
  diet_pattern: null,
  sleep_hours: null,
  pain_areas: null,
  medical_history: null,
  notes: null,
  trainer_memo: null,
  reviewed: true,
  created_at: "2026-08-01T00:00:00Z",
  user_id: null,
};

const setup = async (purposes: string[]) => {
  vi.doMock("@/hooks/useCounselingResponses", () => ({
    useCounselingResponses: () => ({
      responses: [{ ...RESPONSE_BASE, purposes }],
      isLoading: false,
      markReviewed: { mutate: vi.fn() },
      updateMemo: { mutateAsync: vi.fn() },
      linkToClient: { mutateAsync: vi.fn() },
    }),
  }));
  vi.doMock("@/hooks/useProfile", () => ({
    useAllCustomerProfiles: () => ({ profiles: [], loading: false }),
  }));

  const { default: CounselingResponseList } = await import("@/components/trainer/CounselingResponseList");
  render(<CounselingResponseList />);
};

describe("CounselingResponseList の目的ラベル（i18n動的化）", () => {
  it("ja.json に定義済みの目的キーは対応する日本語ラベルで表示される", async () => {
    await setup(["posture", "rehab"]);
    expect(screen.getByText(i18n.t("counseling.purpose.posture") + "・" + i18n.t("counseling.purpose.rehab"))).toBeInTheDocument();
  });

  it("ja.json に無い未知の目的キーはラベル解決に失敗せず、キーそのものが表示される（フォークの業種固有キー追加を想定）", async () => {
    await setup(["custom_purpose_from_fork"]);
    expect(screen.getByText("custom_purpose_from_fork")).toBeInTheDocument();
  });
});
