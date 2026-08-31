// ジムが配る動画（自宅ストレッチ等）のURLを、埋め込み用の形に直す。
//
// 🔴 **貼られたURLをそのまま iframe の src に入れない。**
//    ここは自由入力なので、`javascript:` や `data:` を入れられると
//    そのまま実行される。この関数は**動画IDだけを抜き出し**、
//    こちらが持っている雛形に流し込んで埋め込みURLを組み立て直す。
//    IDは英数字と `-` `_` に限る（ID_RE）ので、抜き出せなかったものは null になる。
//    DB 側にも https 限定の CHECK がある（20260831010000_gym_videos.sql）。
//
// 対応するのは YouTube と Vimeo だけ。どちらも「限定公開」を持っているので、
// 検索には出ないがURLを知っていれば見られる、という配り方ができる。
//
// 見張り: src/test/gymVideos.test.ts

export type VideoProvider = "youtube" | "vimeo";

export interface ParsedVideo {
  provider: VideoProvider;
  /** 動画ID（YouTube は 11 文字、Vimeo は数字） */
  id: string;
  /** 限定公開 Vimeo のハッシュ（`vimeo.com/123/abc` の abc）。無ければ null */
  privacyHash: string | null;
  /** iframe に入れる URL。**必ずこの関数が組み立てたものを使う** */
  embedUrl: string;
  /** ブラウザで開くときの URL（正規化済み） */
  watchUrl: string;
  /** 一覧用のサムネイル。取得できない提供元では null */
  thumbnailUrl: string | null;
}

/** 動画ID・ハッシュに許す文字。ここを緩めると埋め込みURLに任意の文字を混ぜられる */
const ID_RE = /^[A-Za-z0-9_-]+$/;

const isSafeId = (v: string, max: number): boolean =>
  v.length > 0 && v.length <= max && ID_RE.test(v);

/** ホスト名の末尾一致（`evil-youtube.com` を YouTube と誤認しないため） */
const hostIs = (host: string, ...domains: string[]): boolean =>
  domains.some((d) => host === d || host.endsWith(`.${d}`));

const youtubeIdFrom = (url: URL): string | null => {
  // https://youtu.be/<id>
  if (hostIs(url.hostname, "youtu.be")) {
    return url.pathname.slice(1).split("/")[0] || null;
  }
  if (!hostIs(url.hostname, "youtube.com", "youtube-nocookie.com")) return null;
  // https://www.youtube.com/watch?v=<id>
  const v = url.searchParams.get("v");
  if (v) return v;
  // https://www.youtube.com/embed/<id> · /shorts/<id> · /live/<id> · /v/<id>
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length >= 2 && ["embed", "shorts", "live", "v"].includes(parts[0])) return parts[1];
  return null;
};

/**
 * 貼られたURLを解析する。対応外・壊れている・IDが取れないときは null。
 *
 * 🔴 null を返したら**画面に出さない**こと（一覧では「開けない動画」として印を出す）。
 *    ここで弾いたものが後段で生URLとして使われると、この関数を置いた意味が無くなる。
 */
export const parseVideoUrl = (raw: string | null | undefined): ParsedVideo | null => {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  // http: や javascript: は受けない（DB の CHECK と同じ線）
  if (url.protocol !== "https:") return null;

  const host = url.hostname.toLowerCase();

  if (hostIs(host, "youtu.be", "youtube.com", "youtube-nocookie.com")) {
    const id = youtubeIdFrom(url);
    if (!id || !isSafeId(id, 20)) return null;
    return {
      provider: "youtube",
      id,
      privacyHash: null,
      // nocookie ドメイン: 視聴するまで広告用の Cookie を置かない。
      // playsinline=1 は iOS の WebView で全画面に奪われないために要る。
      // rel=0 で関連動画を同じチャンネル内に絞る（他人の動画が出るのを避ける）。
      embedUrl: `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&playsinline=1`,
      watchUrl: `https://www.youtube.com/watch?v=${id}`,
      thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    };
  }

  if (hostIs(host, "vimeo.com")) {
    // https://vimeo.com/<id> · https://vimeo.com/<id>/<hash>（限定公開）
    // https://player.vimeo.com/video/<id>?h=<hash>
    const parts = url.pathname.split("/").filter(Boolean);
    const idIdx = parts[0] === "video" ? 1 : 0;
    const id = parts[idIdx];
    if (!id || !/^[0-9]+$/.test(id) || id.length > 15) return null;
    const hashRaw = parts[idIdx + 1] ?? url.searchParams.get("h") ?? null;
    const privacyHash = hashRaw && isSafeId(hashRaw, 40) ? hashRaw : null;
    const q = privacyHash ? `?h=${privacyHash}&` : "?";
    return {
      provider: "vimeo",
      id,
      privacyHash,
      embedUrl: `https://player.vimeo.com/video/${id}${q}playsinline=1`,
      watchUrl: privacyHash ? `https://vimeo.com/${id}/${privacyHash}` : `https://vimeo.com/${id}`,
      // Vimeo のサムネイルは oEmbed を叩かないと分からない。一覧では代替の絵を出す
      thumbnailUrl: null,
    };
  }

  return null;
};

/** 貼られたURLが対応形式か（入力欄のその場検証用） */
export const isSupportedVideoUrl = (raw: string | null | undefined): boolean =>
  parseVideoUrl(raw) !== null;

/** 秒 → 「3分」「1時間5分」。0以下・未設定は null（画面に何も出さない） */
export const formatDuration = (seconds: number | null | undefined): string | null => {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return m > 0 ? `${h}時間${m}分` : `${h}時間`;
  if (m > 0) return s >= 30 ? `${m + 1}分` : `${m}分`;
  return `${total}秒`;
};

/**
 * 「3:20」「200」「3分20秒」のような入力を秒に直す。解釈できなければ null。
 * トレーナーが動画の尺を手で入れる欄で使う（任意項目なので空も null）。
 */
export const parseDurationInput = (raw: string | null | undefined): number | null => {
  const v = (raw ?? "").trim();
  if (!v) return null;
  // mm:ss / hh:mm:ss
  const colon = v.match(/^(\d{1,2}):([0-5]?\d)(?::([0-5]?\d))?$/);
  if (colon) {
    const a = Number(colon[1]);
    const b = Number(colon[2]);
    const c = colon[3] === undefined ? null : Number(colon[3]);
    return c === null ? a * 60 + b : a * 3600 + b * 60 + c;
  }
  // 3分20秒 / 3分 / 90秒
  const jp = v.match(/^(?:(\d{1,3})分)?(?:(\d{1,4})秒)?$/);
  if (jp && (jp[1] || jp[2])) return Number(jp[1] ?? 0) * 60 + Number(jp[2] ?? 0);
  // 素の数字は「分」ではなく「秒」として読む（3:20 と 200 が同じ意味になるように）
  if (/^\d{1,5}$/.test(v)) return Number(v);
  return null;
};
