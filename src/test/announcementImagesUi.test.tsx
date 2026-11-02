/**
 * お知らせの画像の画面（2026-11-01）。置き場・DB の決まりは announcementImages.test.ts。
 *
 * 🔴 壊しやすいもの:
 *   1. 上げ終わる前に保存できる → 画像が付かないまま配信される
 *   2. 保存せずに閉じたのに、上げた画像が置き場に残る（どのお知らせにも付かないごみ）
 *   3. 編集で外した画像を、保存する前に消す → 保存しなかったのに、配信済みのお知らせから画像が消える
 *   4. 閉じたあとに上がり終わった画像が、次に開いたフォームに混ざる
 *   5. 全画面の画像が、お知らせのパネル（glass）の中に閉じ込められる
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within, act } from "@testing-library/react";
import i18n from "@/lib/i18n";

const T = "00000000-0000-4000-8000-00000000000a";
const P = (n: number) => `${T}/00000000-0000-4000-8000-${String(n).padStart(12, "0")}.jpg`;

type Row = {
  id: string; title: string; body: string; icon: string; target: string;
  published_at: string; created_at: string; announcement_audience?: { user_id: string }[]; image_paths?: string[];
};

const m = vi.hoisted(() => ({
  rows: [] as Row[],
  deleted: [] as string[],
  rpc: vi.fn(),
  invoke: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  sign: vi.fn(),
  toastError: vi.fn(),
  announcements: [] as Row[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    let isDelete = false;
    const b = {
      select: () => b,
      order: () => b,
      in: () => b,
      eq: (_c: string, v: string) => { if (isDelete) m.deleted.push(v); return b; },
      delete: () => { isDelete = true; return b; },
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({
          data: isDelete ? [{ id: m.deleted[m.deleted.length - 1] }] : table === "announcements" ? m.rows : [],
          error: null,
        }).then(resolve),
    };
    return b;
  };
  return {
    supabase: {
      from: (table: string) => builder(table),
      rpc: (name: string, args: Record<string, unknown>) => m.rpc(name, args),
      functions: { invoke: (...a: unknown[]) => m.invoke(...a) },
    },
  };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner-1" } }) }));
vi.mock("@/hooks/useTenant", () => ({ useTenant: () => ({ tenant: { id: T }, isLimitedStaff: false }) }));
vi.mock("@/hooks/useProfile", () => ({ useAllCustomerProfiles: () => ({ profiles: [], loading: false, refetch: vi.fn() }) }));
vi.mock("@/hooks/useAnnouncements", () => ({
  useAnnouncements: () => ({
    items: m.announcements, readIds: new Set<string>(), loading: false, unreadCount: 0,
    refetch: vi.fn(), markRead: vi.fn(), markAllRead: vi.fn(),
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: (...a: unknown[]) => m.toastError(...a) } }));
vi.mock("@/lib/announcementImages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/announcementImages")>()),
  uploadAnnouncementImage: (...a: unknown[]) => m.upload(...a),
  removeAnnouncementImages: (...a: unknown[]) => m.remove(...a),
  signAnnouncementImageUrls: (...a: unknown[]) => m.sign(...a),
}));

const PAST = "2026-10-01T10:00:00.000Z";
const row = (r: Partial<Row>): Row => ({
  id: r.id ?? "a-1", title: r.title ?? "冬季休業", body: r.body ?? "年末年始のお休み", icon: "Bell",
  target: "all", published_at: PAST, created_at: PAST, announcement_audience: [], image_paths: r.image_paths ?? [],
});

let uploadSeq = 0;
beforeEach(() => {
  m.rows = []; m.deleted = []; m.announcements = [];
  uploadSeq = 0;
  m.rpc.mockReset().mockResolvedValue({ data: "new-id", error: null });
  m.invoke.mockReset().mockResolvedValue({ data: null, error: null });
  m.upload.mockReset().mockImplementation(async () => {
    uploadSeq += 1;
    return { path: P(uploadSeq), previewUrl: `blob:preview-${uploadSeq}` };
  });
  m.remove.mockReset().mockResolvedValue(undefined);
  m.sign.mockReset().mockImplementation(async (paths: string[]) => new Map(paths.map((p) => [p, `https://signed/${p}`])));
  m.toastError.mockReset();
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
});
afterEach(cleanup);

// ── 店側（お知らせ管理） ───────────────────────────────────────────────
const renderManager = async () => {
  const { default: TrainerAnnouncementManager } = await import("@/components/trainer/TrainerAnnouncementManager");
  const view = render(<TrainerAnnouncementManager />);
  await waitFor(() => expect(screen.getByText(i18n.t("announcement.title"))).toBeTruthy());
  return view;
};
const openNew = () => {
  fireEvent.click(screen.getByText(i18n.t("announcement.newBtn")));
  fireEvent.change(screen.getByPlaceholderText(i18n.t("announcement.titlePlaceholder")), { target: { value: "冬季休業" } });
  fireEvent.change(screen.getByPlaceholderText(i18n.t("announcement.bodyPlaceholder")), { target: { value: "年末年始のお休み" } });
};
const file = (name: string) => new File(["img"], name, { type: "image/png" });
const choose = (...names: string[]) =>
  fireEvent.change(screen.getByTestId("announcement-image-input"), { target: { files: names.map(file) } });
const thumbs = () => within(screen.getByTestId("announcement-image-grid")).queryAllByRole("img");
const publish = () => fireEvent.click(screen.getByRole("button", { name: i18n.t("announcement.btnPublish") }));
const cancel = () => fireEvent.click(screen.getByRole("button", { name: i18n.t("common.cancel") }));
const removeNth = (n: number) => fireEvent.click(screen.getByRole("button", { name: i18n.t("announcement.removeImage", { n }) }));

describe("お知らせ管理: 画像を付ける", () => {
  it("選んだ画像を上げて並べ、配信で選んだ順に p_image_paths に渡す", async () => {
    await renderManager();
    openNew();
    choose("front.png", "back.png");
    await waitFor(() => expect(thumbs()).toHaveLength(2));
    expect(m.upload).toHaveBeenCalledTimes(2);
    expect(m.upload.mock.calls.map((c) => [(c[0] as File).name, c[1]])).toEqual([["front.png", T], ["back.png", T]]);
    expect(thumbs()[0].getAttribute("src")).toBe("blob:preview-1");
    publish();
    await waitFor(() => expect(m.rpc).toHaveBeenCalledTimes(1));
    expect(m.rpc.mock.calls[0][0]).toBe("save_announcement");
    expect(m.rpc.mock.calls[0][1]).toMatchObject({ p_title: "冬季休業", p_image_paths: [P(1), P(2)] });
    // 付けた画像は片付けない
    expect(m.remove.mock.calls.flat(2)).not.toContain(P(1));
  });

  it("画像なしで配信すると、空の配列（画像なし）を渡す", async () => {
    await renderManager();
    openNew();
    publish();
    await waitFor(() => expect(m.rpc).toHaveBeenCalledTimes(1));
    expect(m.rpc.mock.calls[0][1]).toMatchObject({ p_image_paths: [] });
  });

  it("🔴 4枚まで。超えた分は上げずに知らせ、追加のボタンも消える", async () => {
    await renderManager();
    openNew();
    choose("1.png", "2.png", "3.png", "4.png", "5.png");
    await waitFor(() => expect(thumbs()).toHaveLength(4));
    expect(m.upload).toHaveBeenCalledTimes(4);
    expect(m.toastError).toHaveBeenCalledWith(i18n.t("announcement.imageTooMany", { max: 4 }));
    expect(screen.queryByRole("button", { name: i18n.t("announcement.addImage") })).toBeNull();
  });

  it("🔴 上げている途中は保存させない", async () => {
    let finish: (v: { path: string; previewUrl: string }) => void = () => {};
    m.upload.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
    await renderManager();
    openNew();
    choose("slow.png");
    await waitFor(() => expect(screen.getByRole("status", { name: i18n.t("announcement.imageUploadingShort") })).toBeTruthy());
    publish();
    await waitFor(() => expect(m.toastError).toHaveBeenCalledWith(i18n.t("announcement.imageUploading")));
    expect(m.rpc).not.toHaveBeenCalled();
    await act(async () => { finish({ path: P(9), previewUrl: "blob:slow" }); });
    await waitFor(() => expect(thumbs()).toHaveLength(1));
    publish();
    await waitFor(() => expect(m.rpc).toHaveBeenCalledTimes(1));
    expect(m.rpc.mock.calls[0][1]).toMatchObject({ p_image_paths: [P(9)] });
  });

  it("上げられなかったら知らせて、並べない", async () => {
    m.upload.mockRejectedValueOnce(new Error("too big"));
    await renderManager();
    openNew();
    choose("broken.png");
    await waitFor(() => expect(m.toastError).toHaveBeenCalledWith(i18n.t("announcement.imageUploadFailed")));
    expect(thumbs()).toHaveLength(0);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("🔴 保存せずに閉じたら、このフォームで上げた画像を片付ける", async () => {
    await renderManager();
    openNew();
    choose("a.png");
    await waitFor(() => expect(thumbs()).toHaveLength(1));
    cancel();
    expect(m.remove).toHaveBeenCalledWith([P(1)]);
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("上げたばかりの画像を×で外すと、すぐ片付ける", async () => {
    await renderManager();
    openNew();
    choose("a.png", "b.png");
    await waitFor(() => expect(thumbs()).toHaveLength(2));
    removeNth(1);
    expect(m.remove).toHaveBeenCalledWith([P(1)]);
    publish();
    await waitFor(() => expect(m.rpc).toHaveBeenCalledTimes(1));
    expect(m.rpc.mock.calls[0][1]).toMatchObject({ p_image_paths: [P(2)] });
  });

  it("フォームを開いたまま画面を離れたら、上げた画像を片付ける", async () => {
    const view = await renderManager();
    openNew();
    choose("a.png");
    await waitFor(() => expect(thumbs()).toHaveLength(1));
    view.unmount();
    expect(m.remove).toHaveBeenCalledWith([P(1)]);
  });

  it("🔴 保存の途中に画面を離れても、上げた画像は消さない（保存が通るとお知らせが消えた画像を指す）", async () => {
    m.rpc.mockImplementation(() => new Promise(() => {}));
    const view = await renderManager();
    openNew();
    choose("a.png");
    await waitFor(() => expect(thumbs()).toHaveLength(1));
    publish();
    await waitFor(() => expect(m.rpc).toHaveBeenCalledTimes(1));
    view.unmount();
    expect(m.remove.mock.calls.flat(2)).not.toContain(P(1));
  });

  it("🔴 閉じたあとに上がり終わった画像は、次のフォームに混ぜずに片付ける", async () => {
    let finish: (v: { path: string; previewUrl: string }) => void = () => {};
    m.upload.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
    await renderManager();
    openNew();
    choose("late.png");
    cancel();
    openNew();
    await act(async () => { finish({ path: P(7), previewUrl: "blob:late" }); });
    await waitFor(() => expect(m.remove).toHaveBeenCalledWith([P(7)]));
    expect(thumbs()).toHaveLength(0);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("お知らせ管理: 画像だけで送る（2026-11-02）", () => {
  // 宗本さん「タイトルと文章入れなくても画像だけでもお知らせ送れる様にして」
  const openBlank = () => fireEvent.click(screen.getByText(i18n.t("announcement.newBtn")));

  it("🔴 画像があれば、タイトルと本文が空でも送れる。タイトルは「画像が送られました」で保存する", async () => {
    await renderManager();
    openBlank();
    choose("flyer.png");
    await waitFor(() => expect(thumbs()).toHaveLength(1));
    publish();
    await waitFor(() => expect(m.rpc).toHaveBeenCalledTimes(1));
    expect(m.rpc.mock.calls[0][1]).toMatchObject({
      p_title: i18n.t("announcement.imageOnlyTitle"), p_body: "", p_image_paths: [P(1)],
    });
    expect(m.toastError).not.toHaveBeenCalled();
  });

  it("画像があれば、タイトルだけ・本文だけでも送れる（入れたものはそのまま）", async () => {
    await renderManager();
    openBlank();
    fireEvent.change(screen.getByPlaceholderText(i18n.t("announcement.bodyPlaceholder")), { target: { value: "今月のチラシです" } });
    choose("flyer.png");
    await waitFor(() => expect(thumbs()).toHaveLength(1));
    publish();
    await waitFor(() => expect(m.rpc).toHaveBeenCalledTimes(1));
    expect(m.rpc.mock.calls[0][1]).toMatchObject({ p_title: i18n.t("announcement.imageOnlyTitle"), p_body: "今月のチラシです" });
  });

  it("🔴 画像が無いときは、今までどおりタイトルと本文の両方が要る", async () => {
    await renderManager();
    openBlank();
    fireEvent.change(screen.getByPlaceholderText(i18n.t("announcement.titlePlaceholder")), { target: { value: "冬季休業" } });
    publish();
    expect(m.toastError).toHaveBeenCalledWith(i18n.t("announcement.errTitleBody"));
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("🔴 画像を上げている途中なら、画像だけのお知らせも保存させない（空のお知らせが配信される）", async () => {
    m.upload.mockImplementation(() => new Promise(() => {}));
    await renderManager();
    openBlank();
    choose("flyer.png");
    publish();
    expect(m.toastError).toHaveBeenCalledWith(i18n.t("announcement.imageUploading"));
    expect(m.rpc).not.toHaveBeenCalled();
  });
});

describe("お客様: 画像だけのお知らせ", () => {
  it("本文が無ければ本文の欄を出さず、画像だけを出す", async () => {
    const imageOnlyTitle = i18n.t("announcement.imageOnlyTitle"); // 保存されるタイトル（フォークの言い換えに追従）
    m.announcements = [row({ id: "a-1", title: imageOnlyTitle, body: "", image_paths: [P(1)] })];
    const { default: AnnouncementsDialog } = await import("@/components/customer/AnnouncementsDialog");
    render(<AnnouncementsDialog open onClose={vi.fn()} />);
    fireEvent.click(screen.getByText(imageOnlyTitle));
    await waitFor(() => expect(m.sign).toHaveBeenCalledWith([P(1)]));
    expect(screen.queryByTestId("announcement-body")).toBeNull();
    expect(screen.getByTestId("announcement-images")).toBeTruthy();
  });

  it("本文があれば今までどおり出す", async () => {
    m.announcements = [row({ id: "a-1", title: "冬季休業", body: "年末年始のお休み" })];
    const { default: AnnouncementsDialog } = await import("@/components/customer/AnnouncementsDialog");
    render(<AnnouncementsDialog open onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("冬季休業"));
    expect(screen.getByTestId("announcement-body").textContent).toContain("年末年始のお休み");
  });
});

describe("お知らせ管理: 保存済みの画像", () => {
  it("編集で開くと保存済みの画像を出す。外して更新すると、更新できてから置き場から消す", async () => {
    m.rows = [row({ id: "a-9", image_paths: [P(1), P(2)] })];
    await renderManager();
    fireEvent.click(screen.getByRole("button", { name: i18n.t("announcement.editAria") }));
    expect(m.sign).toHaveBeenCalledWith([P(1), P(2)]);
    await waitFor(() => expect(thumbs().map((i) => i.getAttribute("src"))).toEqual([`https://signed/${P(1)}`, `https://signed/${P(2)}`]));
    removeNth(1);
    expect(m.remove.mock.calls.flat(2)).not.toContain(P(1));
    fireEvent.click(screen.getByRole("button", { name: i18n.t("announcement.btnUpdate") }));
    await waitFor(() => expect(m.rpc).toHaveBeenCalledTimes(1));
    expect(m.rpc.mock.calls[0][1]).toMatchObject({ p_id: "a-9", p_image_paths: [P(2)] });
    await waitFor(() => expect(m.remove).toHaveBeenCalledWith([P(1)]));
  });

  it("🔴 外しても、保存せずに閉じたら消さない", async () => {
    m.rows = [row({ id: "a-9", image_paths: [P(1)] })];
    await renderManager();
    fireEvent.click(screen.getByRole("button", { name: i18n.t("announcement.editAria") }));
    await waitFor(() => expect(thumbs()).toHaveLength(1));
    removeNth(1);
    cancel();
    expect(m.remove.mock.calls.flat(2)).not.toContain(P(1));
  });

  it("🔴 保存に失敗したら、外した画像は消さない", async () => {
    m.rows = [row({ id: "a-9", image_paths: [P(1)] })];
    m.rpc.mockResolvedValue({ data: null, error: { message: "denied" } });
    await renderManager();
    fireEvent.click(screen.getByRole("button", { name: i18n.t("announcement.editAria") }));
    await waitFor(() => expect(thumbs()).toHaveLength(1));
    removeNth(1);
    fireEvent.click(screen.getByRole("button", { name: i18n.t("announcement.btnUpdate") }));
    await waitFor(() => expect(m.toastError).toHaveBeenCalledWith(i18n.t("announcement.saveFailed", { msg: "denied" })));
    expect(m.remove.mock.calls.flat(2)).not.toContain(P(1));
  });

  it("お知らせを消したら、付いていた画像も片付ける", async () => {
    m.rows = [row({ id: "a-9", image_paths: [P(1), P(2)] })];
    await renderManager();
    fireEvent.click(screen.getByRole("button", { name: i18n.t("announcement.deleteAria") }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: i18n.t("common.delete") }));
    await waitFor(() => expect(m.remove).toHaveBeenCalledWith([P(1), P(2)]));
    expect(m.deleted).toEqual(["a-9"]);
  });

  it("一覧に画像の枚数を出す", async () => {
    m.rows = [row({ id: "a-9", image_paths: [P(1), P(2)] })];
    await renderManager();
    expect(document.body.textContent).toContain(i18n.t("announcement.imagesBadge", { count: 2 }));
  });
});

// ── お客様の画面 ─────────────────────────────────────────────────────
describe("お客様: お知らせの画像", () => {
  const renderDialog = async () => {
    const { default: AnnouncementsDialog } = await import("@/components/customer/AnnouncementsDialog");
    render(<AnnouncementsDialog open onClose={vi.fn()} />);
  };

  it("開くと署名つきの URL を取って本文の下に出す。押すと全画面（パネルの外）で開く", async () => {
    m.announcements = [row({ id: "a-1", title: "冬季休業", image_paths: [P(1), P(2)] })];
    await renderDialog();
    expect(screen.getByLabelText(i18n.t("announcementsDialog.hasImages"))).toBeTruthy();
    fireEvent.click(screen.getByText("冬季休業"));
    await waitFor(() => expect(m.sign).toHaveBeenCalledWith([P(1), P(2)]));
    const images = await screen.findAllByRole("img", { name: /./ });
    const shown = images.filter((i) => i.getAttribute("src")?.startsWith("https://signed/"));
    expect(shown.map((i) => i.getAttribute("src"))).toEqual([`https://signed/${P(1)}`, `https://signed/${P(2)}`]);
    fireEvent.click(screen.getByRole("button", { name: i18n.t("announcementsDialog.openImage", { n: 2 }) }));
    const viewer = screen.getByRole("dialog", { name: i18n.t("announcementsDialog.imageViewer") });
    expect(within(viewer).getByRole("img").getAttribute("src")).toBe(`https://signed/${P(2)}`);
    // パネル（glass = backdrop-filter）の中に置くと、全画面にならずパネルの幅に閉じ込められる
    expect(viewer.closest(".glass")).toBeNull();
    expect(viewer.className).toContain("z-[70]");
  });

  it("取れなかった画像（消された・届いていない）は出さない", async () => {
    m.announcements = [row({ id: "a-1", title: "冬季休業", image_paths: [P(1), P(2)] })];
    m.sign.mockResolvedValue(new Map([[P(2), "https://signed/only-2"]]));
    await renderDialog();
    fireEvent.click(screen.getByText("冬季休業"));
    const imgs = () => Array.from(screen.getByTestId("announcement-images").querySelectorAll("img")).map((i) => i.getAttribute("src"));
    await waitFor(() => expect(imgs()).toEqual(["https://signed/only-2"]));
  });

  it("画像の無いお知らせは取りに行かない", async () => {
    m.announcements = [row({ id: "a-1", title: "冬季休業", image_paths: [] })];
    await renderDialog();
    fireEvent.click(screen.getByText("冬季休業"));
    expect(screen.queryByTestId("announcement-images")).toBeNull();
    expect(m.sign).not.toHaveBeenCalled();
  });
});
