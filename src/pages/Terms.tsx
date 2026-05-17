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

const Terms = () => {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-5 py-8 sm:px-8 sm:py-12 leading-relaxed">
        <div className="mb-6">
          <BackLink />
        </div>

        <header className="mb-10">
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">利用規約</h1>
          <p className="text-sm text-muted-foreground mt-2">
            パーソナルジムSalute御所南 / kyoto-saluteアプリ
          </p>
        </header>

        <article className="space-y-10 text-[15px]">
          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">第1条（適用）</h2>
            <p>
              本規約は、パーソナルジムSalute 御所南（以下「当ジム」）がkyoto-saluteアプリ（以下「本アプリ」）において提供するサービス（以下「本サービス」）の利用に関する条件を定めるものです。
            </p>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">第2条（利用登録）</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>本サービスは当ジムのお客様のみが利用できます</li>
              <li>虚偽の情報を登録した場合、利用を制限する場合があります</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">第3条（禁止事項）</h2>
            <p className="mb-2">以下の行為を禁止します：</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>法令または公序良俗に違反する行為</li>
              <li>犯罪行為に関連する行為</li>
              <li>本アプリの運営を妨害する行為</li>
              <li>他のユーザーに迷惑をかける行為</li>
              <li>当ジムのサーバーに過度な負荷をかける行為</li>
              <li>他者のアカウントを不正に利用する行為</li>
              <li>その他当ジムが不適切と判断する行為</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">第4条（本サービスの提供の停止等）</h2>
            <p className="mb-2">以下の場合、事前通知なしにサービスを停止することがあります：</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>システムメンテナンス</li>
              <li>地震、停電、天災等の不可抗力</li>
              <li>その他運営上やむを得ない場合</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">第5条（利用制限）</h2>
            <p>
              禁止事項に違反した場合、アカウントの利用を制限または削除する場合があります。
            </p>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">第6条（免責事項）</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>本アプリのAI機能（骨格診断、食事管理等）は参考情報であり、医学的診断を代替するものではありません</li>
              <li>AIによる分析結果について当ジムは正確性を保証するものではありません</li>
              <li>本アプリの利用によって生じた損害について、当ジムは一切の責任を負いません</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">第7条（サービス内容の変更等）</h2>
            <p>
              当ジムは事前通知なくサービス内容を変更・追加・停止する場合があります。
            </p>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">第8条（利用規約の変更）</h2>
            <p>
              当ジムは必要に応じて本規約を変更できるものとします。変更後の規約はアプリ内で通知します。
            </p>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">第9条（準拠法・裁判管轄）</h2>
            <p>
              本規約の解釈は日本法を準拠法とし、京都地方裁判所を第一審の専属的合意管轄裁判所とします。
            </p>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">第10条（お問い合わせ）</h2>
            <div className="bg-card border rounded-xl p-4 space-y-1">
              <p className="font-bold">パーソナルジムSalute 御所南</p>
              <p className="text-sm">所在地：〒604-0862 京都府京都市中京区毘沙門町533-1 プラザ御所南2階</p>
              <p className="text-sm">
                メール：
                <a href="mailto:k.munemoto@kyoto-salute.com" className="text-accent underline hover:text-accent/80">
                  k.munemoto@kyoto-salute.com
                </a>
              </p>
            </div>
          </section>
        </article>

        <footer className="mt-12 pt-6 border-t text-sm text-muted-foreground space-y-2">
          <p>制定日：2026年4月20日</p>
          <p>最終更新日：2026年4月20日</p>
          <div className="pt-4 flex flex-wrap gap-4">
            <BackLink />
            <Link to="/privacy" className="text-sm text-accent hover:text-accent/80 transition-colors font-bold">
              プライバシーポリシーはこちら →
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default Terms;
