import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

const BackLink = () => (
  <Link
    to="/"
    className="inline-flex items-center gap-1.5 text-sm text-accent hover:text-accent/80 transition-colors font-bold"
  >
    <ArrowLeft className="w-4 h-4" />
    アプリに戻る
  </Link>
);

type Row = { label: string; value: React.ReactNode };

const Section = ({ title, rows }: { title: string; rows: Row[] }) => (
  <section>
    <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">{title}</h2>
    <dl className="rounded-xl border bg-card overflow-hidden">
      {rows.map((row, i) => (
        <div
          key={row.label}
          className={`grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-1 sm:gap-4 px-4 py-3 text-[15px] ${
            i !== rows.length - 1 ? "border-b" : ""
          }`}
        >
          <dt className="text-sm font-bold text-muted-foreground sm:text-foreground">{row.label}</dt>
          <dd className="break-all">{row.value}</dd>
        </div>
      ))}
    </dl>
  </section>
);

const Tokushoho = () => {
  const businessRows: Row[] = [
    { label: "販売事業者名", value: "宗本寛太" },
    { label: "屋号", value: "KantaAppLab" },
    { label: "運営統括責任者", value: "宗本寛太" },
    { label: "所在地", value: "京都府京都市山科区大宅細田町98-38" },
    {
      label: "電話番号",
      value: (
        <>
          090-8386-0894
          <p className="text-xs text-muted-foreground mt-1">
            電話に出られない場合があるため、お問い合わせはメールを推奨します。
          </p>
        </>
      ),
    },
    {
      label: "メールアドレス",
      value: (
        <a
          href="mailto:k.munemoto@kyoto-salute.com"
          className="text-accent underline hover:text-accent/80"
        >
          k.munemoto@kyoto-salute.com
        </a>
      ),
    },
    { label: "サービス名", value: "GymBoard（ジムボード）" },
  ];

  const priceRows: Row[] = [
    { label: "Free", value: "無料" },
    { label: "Starter", value: "月額 4,980円 / 年額 49,800円" },
    { label: "Standard", value: "月額 6,980円 / 年額 69,800円" },
    { label: "Pro", value: "月額 9,800円 / 年額 98,000円" },
    {
      label: "備考",
      value: "表示価格はすべて消費税込みです。",
    },
  ];

  const otherRows: Row[] = [
    {
      label: "商品代金以外の必要料金",
      value: "インターネット接続料金・通信料金等はお客様のご負担となります。",
    },
    { label: "支払方法", value: "クレジットカード（Stripeを通じた決済）" },
    {
      label: "支払時期",
      value: (
        <ul className="list-disc pl-5 space-y-1">
          <li>月額プラン：お申し込み時に初回課金、以降毎月同日に自動更新・課金</li>
          <li>年額プラン：お申し込み時に初回課金、以降毎年同日に自動更新・課金</li>
        </ul>
      ),
    },
    {
      label: "役務の提供時期",
      value: "決済完了後、ただちにご利用いただけます。",
    },
    {
      label: "返品・キャンセル（解約）",
      value: (
        <ul className="list-disc pl-5 space-y-1">
          <li>サービスの性質上、購入後の返品・返金はお受けできません。</li>
          <li>
            解約はカスタマーポータルからいつでも可能です。解約手続き後、現在の請求期間の終了をもって課金を停止します（日割り返金はありません）。
          </li>
          <li>解約後も請求期間の終了日まではサービスをご利用いただけます。</li>
        </ul>
      ),
    },
    {
      label: "動作環境",
      value: "最新のWebブラウザ（Google Chrome、Safari 等）、および iOS / Android アプリ。",
    },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-5 py-8 sm:px-8 sm:py-12 leading-relaxed">
        <div className="mb-6">
          <BackLink />
        </div>

        <header className="mb-10">
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">
            特定商取引法に基づく表記
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            GymBoard（ジムボード）
          </p>
        </header>

        <article className="space-y-10 text-[15px]">
          <Section title="事業者情報" rows={businessRows} />
          <Section title="販売価格" rows={priceRows} />
          <Section title="お支払い・提供条件" rows={otherRows} />
        </article>

        <footer className="mt-12 pt-6 border-t text-sm text-muted-foreground space-y-2">
          <p>最終更新日：2026年5月25日</p>
          <div className="pt-4 flex flex-wrap gap-4">
            <BackLink />
            <Link to="/terms" className="text-sm text-accent hover:text-accent/80 transition-colors font-bold">
              利用規約はこちら →
            </Link>
            <Link to="/privacy" className="text-sm text-accent hover:text-accent/80 transition-colors font-bold">
              プライバシーポリシーはこちら →
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default Tokushoho;
