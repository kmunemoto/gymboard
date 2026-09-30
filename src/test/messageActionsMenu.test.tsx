/**
 * 吹き出しの長押しメニュー（返信・送信取消・リアクション）が、指で押して効くこと（2026-10-01）。
 *
 * 宗本さん「チャットの返信取り消し機能が機能してないんだけど」。
 *
 * メニューは「外側を触ったら閉じる」ために window の pointerdown を拾っていたが、
 * **メニューの中を触っても閉じていた**。ボタンに指を置いた瞬間（pointerdown）に
 * メニューが消え、指を離したときにはボタンがもう無いので click が届かない。
 * 送信取消・返信・リアクションが**一度も効いていなかった**。
 *
 * それまでのテストは click だけを直接撃っていたので、この順番（pointerdown → click）を
 * 通っておらず気づけなかった。ここでは実際の指と同じ順で押す。
 * （本物のブラウザ（Chromium、マウスとタッチの両方）でも再現し、直ったことを確認済み）
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import i18n from "@/lib/i18n";
import MessageActions from "@/components/messages/MessageActions";

const UNSEND = () => i18n.t("chat.unsend");
const REPLY = () => i18n.t("chat.reply");

const openMenu = async () => {
  fireEvent.contextMenu(screen.getByText("こんにちは"));
  // 「外側を触ったら閉じる」の登録は次のフレーム（setTimeout 0）。それを待ってから触る
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

/** 本物の指と同じ順: 指を置く（pointerdown）→ 画面が更新される → 指を離す（click） */
const pressLikeAFinger = async (el: HTMLElement) => {
  fireEvent.pointerDown(el);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  // 指を置いた時点でボタンが消えていたら、ブラウザは click を届けない
  if (!el.isConnected) return false;
  fireEvent.pointerUp(el);
  fireEvent.click(el);
  return true;
};

const setup = () => {
  const onReply = vi.fn();
  const onUnsend = vi.fn();
  const onReact = vi.fn();
  render(
    <MessageActions onReply={onReply} onUnsend={onUnsend} onReact={onReact}>
      <div>こんにちは</div>
    </MessageActions>,
  );
  return { onReply, onUnsend, onReact };
};

describe("吹き出しのメニューを指で押す", () => {
  it("🔴 送信取消: 指を置いてもメニューが消えず、押したら取り消しが走る", async () => {
    const { onUnsend } = setup();
    await openMenu();
    const reached = await pressLikeAFinger(screen.getByRole("button", { name: UNSEND() }));
    expect(reached).toBe(true);
    expect(onUnsend).toHaveBeenCalledTimes(1);
    // 押したあとはメニューを閉じる
    expect(screen.queryByRole("button", { name: UNSEND() })).toBeNull();
  });

  it("返信も同じく効く", async () => {
    const { onReply } = setup();
    await openMenu();
    const reached = await pressLikeAFinger(screen.getByRole("button", { name: REPLY() }));
    expect(reached).toBe(true);
    expect(onReply).toHaveBeenCalledTimes(1);
  });

  it("リアクションも同じく効く", async () => {
    const { onReact } = setup();
    await openMenu();
    const menu = screen.getByRole("button", { name: REPLY() }).parentElement!;
    const firstReaction = menu.querySelector("button")!;
    const reached = await pressLikeAFinger(firstReaction as HTMLElement);
    expect(reached).toBe(true);
    expect(onReact).toHaveBeenCalledTimes(1);
  });

  it("メニューの外を触ったら閉じる（今まで通り）", async () => {
    setup();
    await openMenu();
    expect(screen.getByRole("button", { name: UNSEND() })).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.queryByRole("button", { name: UNSEND() })).toBeNull();
  });
});
