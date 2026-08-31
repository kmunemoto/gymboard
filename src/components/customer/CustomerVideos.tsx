import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, PlayCircle, Clock, Video as VideoIcon, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";
import { openExternalUrl } from "@/lib/nativeBridge";
import { useGymVideos, type GymVideo } from "@/hooks/useGymVideos";
import { parseVideoUrl, formatDuration } from "@/lib/videoEmbed";

// お客様が自宅で見る動画の一覧・再生。
//
// 入口はホームのカードだけで、下部ナビには足していない（月次レポート・体の変化と同じ扱い）。
// お客様側にはジムごとの表示ON/OFFの仕組みが無いので、ナビに足すと19のジム全部に出てしまう。
// カードは「公開中の動画が1本以上あるジム」にしか出ない（useGymVideoCount）。
//
// 🔴 再生は videoEmbed.parseVideoUrl が組み立てた埋め込みURLだけを使う。
//    DBに入っている生のURLを iframe の src に入れる経路はここに無い。

interface Props {
  onBack: () => void;
}

const CustomerVideos = ({ onBack }: Props) => {
  const { t } = useTranslation();
  const { items, loading } = useGymVideos();
  const [selected, setSelected] = useState<GymVideo | null>(null);

  // カテゴリーごとにまとめる。並びは sort_order（＝一覧の並び）で最初に出てきた順
  const groups = useMemo(() => {
    const map = new Map<string, GymVideo[]>();
    for (const v of items) {
      // 開けないURL（対応外・壊れている）は最初から出さない。
      // 押しても何も起きないカードは、無いほうがまし。
      if (!parseVideoUrl(v.video_url)) continue;
      const key = v.category?.trim() || t("videos.uncategorized");
      const list = map.get(key);
      if (list) list.push(v);
      else map.set(key, [v]);
    }
    return [...map.entries()];
  }, [items, t]);

  const visibleCount = groups.reduce((n, [, list]) => n + list.length, 0);

  if (selected) {
    const parsed = parseVideoUrl(selected.video_url);
    const duration = formatDuration(selected.duration_seconds);
    return (
      <div className="p-4 space-y-4 fade-in">
        <button onClick={() => setSelected(null)} className="flex items-center gap-1 text-sm text-muted-foreground">
          <ArrowLeft className="w-4 h-4" /> {t("common.back")}
        </button>

        {parsed && (
          /* 16:9 の枠を先に確保してから読み込む（再生開始で下の文章が飛ばないように） */
          <div className="relative w-full overflow-hidden rounded-xl bg-black" style={{ aspectRatio: "16 / 9" }}>
            <iframe
              key={parsed.embedUrl}
              src={parsed.embedUrl}
              title={selected.title}
              className="absolute inset-0 w-full h-full"
              /* playsinline は埋め込みURL側にも入れている。iOS で全画面に奪われないため */
              allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              allowFullScreen
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
        )}

        <div className="space-y-2">
          <h2 className="text-xl font-bold leading-tight break-all">{selected.title}</h2>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="px-2 py-0.5 rounded-full bg-accent/10 text-accent font-bold">{selected.category}</span>
            {duration && (
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {duration}
              </span>
            )}
          </div>
          {selected.description && (
            <p className="text-sm text-foreground leading-relaxed pt-1" style={{ whiteSpace: "pre-wrap" }}>
              {selected.description}
            </p>
          )}
        </div>

        {parsed && (
          /* WebView 内で再生できないとき（年齢制限・埋め込み禁止など）の逃げ道。
             ネイティブでは外部ブラウザ、Web では新しいタブで開く。 */
          <Button variant="outline" className="w-full h-11" onClick={() => openExternalUrl(parsed.watchUrl)}>
            <ExternalLink className="w-4 h-4 mr-1.5" />
            {t("videos.openExternal")}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 fade-in">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="w-4 h-4" /> {t("common.back")}
      </button>

      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <VideoIcon className="w-5 h-5 text-accent" />
          {t("videos.title")}
        </h1>
        <p className="text-xs text-muted-foreground mt-1">{t("videos.subtitle")}</p>
      </div>

      {loading ? (
        <div className="py-12 flex justify-center">
          <DumbbellLoader />
        </div>
      ) : visibleCount === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">{t("videos.empty")}</div>
      ) : (
        groups.map(([category, list]) => (
          <section key={category} className="space-y-2">
            <h2 className="text-sm font-bold text-muted-foreground">{category}</h2>
            <div className="space-y-2">
              {list.map((v) => {
                const parsed = parseVideoUrl(v.video_url);
                const duration = formatDuration(v.duration_seconds);
                return (
                  <button
                    key={v.id}
                    onClick={() => setSelected(v)}
                    className="w-full text-left bg-card border border-border/60 rounded-xl overflow-hidden flex gap-3 items-center hover:bg-muted/40 transition-colors"
                  >
                    <div className="w-28 shrink-0 bg-muted relative" style={{ aspectRatio: "16 / 9" }}>
                      {/* 代替の絵を常に下に敷いておく。サムネが読めなかったとき
                          （限定公開ではなく非公開だった・消された・圏外）に
                          壊れた画像アイコンが出るのを防ぐ */}
                      <div className="absolute inset-0 flex items-center justify-center">
                        <VideoIcon className="w-6 h-6 text-muted-foreground" />
                      </div>
                      {parsed?.thumbnailUrl && (
                        <img
                          src={parsed.thumbnailUrl}
                          alt=""
                          className="absolute inset-0 w-full h-full object-cover"
                          loading="lazy"
                          onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
                        />
                      )}
                      <span className="absolute inset-0 flex items-center justify-center">
                        <PlayCircle className="w-8 h-8 text-white drop-shadow" />
                      </span>
                    </div>
                    <div className="min-w-0 flex-1 py-2 pr-3">
                      <p className="text-sm font-bold leading-tight break-all">{v.title}</p>
                      {duration && (
                        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {duration}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
};

export default CustomerVideos;
