import { describe, it, expect } from "vitest";
import { getMuscleKey } from "@/lib/muscleMapIcon";

describe("getMuscleKey（使ってる部位の画像の選択）", () => {
  it("部位が明示されていればキーワードより優先する（お尻の種目が脚にならない）", () => {
    expect(getMuscleKey("スミスブルガリアンスクワット", "お尻")).toBe("glutes");
    expect(getMuscleKey("ブルガリアンスクワット", "臀部")).toBe("glutes");
    expect(getMuscleKey("スクワット", "お尻")).toBe("glutes");
  });

  it("部位とキーワードが一致する通常ケース", () => {
    expect(getMuscleKey("ベンチプレス", "胸")).toBe("chest");
    expect(getMuscleKey("ラットプルダウン", "背中")).toBe("back");
    expect(getMuscleKey("スクワット", "脚")).toBe("legs");
  });

  it("部位未設定ならキーワードで推定する", () => {
    expect(getMuscleKey("ブルガリアンスクワット", null)).toBe("legs");
    expect(getMuscleKey("ヒップスラスト", undefined)).toBe("glutes");
    expect(getMuscleKey("ベンチプレス")).toBe("chest");
  });

  it("曖昧な部位「腕」はキーワードで二頭筋/三頭筋に細分化する", () => {
    expect(getMuscleKey("アームカール", "腕")).toBe("biceps");
    expect(getMuscleKey("キックバック", "腕")).toBe("triceps");
    // キーワードでも判別できなければ「腕」の既定（二頭筋）に戻す
    expect(getMuscleKey("謎の腕トレ", "腕")).toBe("biceps");
  });

  it("未知の種目・未知の部位は null", () => {
    expect(getMuscleKey("謎の種目", null)).toBeNull();
    expect(getMuscleKey("謎の種目", "未知の部位")).toBeNull();
  });
});
