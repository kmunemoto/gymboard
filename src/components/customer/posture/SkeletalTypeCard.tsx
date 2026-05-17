import { Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { SkeletalDiagnosis, SkeletalType } from "./types";

const TYPE_INFO: Record<SkeletalType, { label: string; color: string; desc: string; traits: string[] }> = {
  straight: {
    label: "ストレート",
    color: "hsl(174, 65%, 50%)",
    desc: "上半身に重心があり、立体的でメリハリのあるボディラインが特徴です。",
    traits: ["筋肉にハリがある", "上半身に厚みがある", "手足が身体に対して小さめ"],
  },
  wave: {
    label: "ウェーブ",
    color: "hsl(280, 45%, 55%)",
    desc: "下半身に重心があり、柔らかな曲線と華奢な上半身が特徴です。",
    traits: ["肌質が柔らかい", "ウエスト位置が低め", "上半身が華奢"],
  },
  natural: {
    label: "ナチュラル",
    color: "hsl(160, 40%, 45%)",
    desc: "骨格のフレームがしっかりしており、手足が長くスタイリッシュな印象が特徴です。",
    traits: ["骨や関節が目立つ", "手足が大きめ", "肩幅がしっかり"],
  },
};

type Props = {
  diagnosis: SkeletalDiagnosis | null;
};

const SkeletalTypeCard = ({ diagnosis }: Props) => {
  if (!diagnosis) return null;

  const info = TYPE_INFO[diagnosis.type];

  return (
    <Card className="border-accent/40 bg-gradient-to-br from-accent/5 to-accent/10">
      <CardContent className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-accent" />
          <span className="text-sm font-bold">AI骨格タイプ診断</span>
        </div>

        {/* Result badge */}
        <div className="flex items-center gap-3">
          <div
            className="flex items-center justify-center w-16 h-16 rounded-2xl text-white font-bold text-lg shrink-0"
            style={{ backgroundColor: info.color }}
          >
            {info.label.slice(0, 2)}
          </div>
          <div>
            <p className="text-lg font-bold" style={{ color: info.color }}>
              {info.label}タイプ
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({diagnosis.confidence}%)
              </span>
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{info.desc}</p>
          </div>
        </div>

        {/* Score bars */}
        <div className="space-y-2">
          {(["straight", "wave", "natural"] as const).map((t) => {
            const ti = TYPE_INFO[t];
            return (
              <div key={t} className="space-y-0.5">
                <div className="flex justify-between text-xs">
                  <span className="font-medium">{ti.label}</span>
                  <span className="text-muted-foreground">{diagnosis.scores[t]}%</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${diagnosis.scores[t]}%`,
                      backgroundColor: ti.color,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Traits */}
        <div className="pt-1">
          <p className="text-xs font-semibold mb-1.5">{info.label}タイプの特徴：</p>
          <ul className="space-y-1">
            {info.traits.map((trait, i) => (
              <li key={i} className="text-xs text-muted-foreground flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: info.color }} />
                {trait}
              </li>
            ))}
          </ul>
        </div>

        {/* Metrics (collapsible details) */}
        <details className="pt-1">
          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
            計測データを見る
          </summary>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <div className="bg-background/60 rounded-lg p-2">
              <p className="text-[10px] text-muted-foreground">肩/ヒップ比</p>
              <p className="text-sm font-bold">{diagnosis.metrics.shoulderHipRatio}</p>
            </div>
            <div className="bg-background/60 rounded-lg p-2">
              <p className="text-[10px] text-muted-foreground">上半身比率</p>
              <p className="text-sm font-bold">{(diagnosis.metrics.upperBodyRatio * 100).toFixed(0)}%</p>
            </div>
            <div className="bg-background/60 rounded-lg p-2">
              <p className="text-[10px] text-muted-foreground">四肢/胴比</p>
              <p className="text-sm font-bold">{diagnosis.metrics.limbTorsoRatio}</p>
            </div>
          </div>
        </details>

        <p className="text-[10px] text-muted-foreground">
          ※写真の角度やポーズにより結果が変動する場合があります。正面からの全身写真で最も正確な結果が得られます。
        </p>
      </CardContent>
    </Card>
  );
};

export default SkeletalTypeCard;
