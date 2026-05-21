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

const Privacy = () => {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-5 py-8 sm:px-8 sm:py-12 leading-relaxed">
        <div className="mb-6">
          <BackLink />
        </div>

        <header className="mb-10">
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">プライバシーポリシー</h1>
          <p className="text-sm text-muted-foreground mt-2">
            ジムボード / gymboardアプリ
          </p>
        </header>

        <article className="space-y-10 text-[15px]">
          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">1. はじめに</h2>
            <p>
              ジムボード（以下「当社」）が提供するgymboardアプリ（以下「本アプリ」）は、お客様の個人情報を適切に保護することを重要な責務と考えています。
            </p>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">2. 取得する情報</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>基本情報：</strong>氏名、メールアドレス、電話番号、生年月日、性別</li>
              <li><strong>身体情報：</strong>身長、体重、体脂肪率、トレーニング記録</li>
              <li>
                <strong>健康情報：</strong>既往歴、アレルギー、服用中の薬、運動習慣（カウンセリングシートで取得）
                <p className="mt-1 text-sm text-muted-foreground">
                  健康状態、既往歴、アレルギー、服用中の薬等の情報は、トレーニング指導および安全管理のために、お客様の同意に基づいて取得します。
                </p>
              </li>
              <li><strong>画像データ：</strong>AI姿勢分析用の姿勢写真、AIによる食事内容の推定・記録補助用の食事写真</li>
              <li><strong>予約情報：</strong>予約日時、キャンセル履歴</li>
              <li><strong>Google連携情報：</strong>Googleカレンダーへの予約情報同期（ユーザーが許可した場合）</li>
              <li><strong>LINE連携情報：</strong>LINEユーザーID（LINE通知を希望する場合）</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">3. 利用目的</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>予約管理、トレーニング記録の管理</li>
              <li>AI姿勢分析、AIによる食事内容の推定・記録補助、月間レポート生成</li>
              <li>LINE通知、Googleカレンダー連携</li>
              <li>お客様へのサービス提供・改善</li>
            </ul>
            <p className="mt-3">
              当社は、取得した個人情報を、利用目的の達成に必要な範囲を超えて利用しません。
            </p>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">4. 第三者提供および外部サービスへの委託・連携</h2>
            <p className="mb-2">
              当社は、法令に基づく場合を除き、お客様の同意なく第三者に個人情報を提供することはありません。
            </p>
            <p className="mb-2">
              ただし、本アプリの提供に必要な範囲で、以下の外部サービスにデータ処理を委託または連携する場合があります。
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Supabase：認証、データベース、ファイル保存</li>
              <li>Google API：Googleカレンダー連携</li>
              <li>LINE Messaging API：LINE通知</li>
              <li>OpenAI API等：AIによる姿勢分析、食事内容の推定補助</li>
              <li>Stripe：決済処理を利用する場合</li>
            </ul>
            <p className="mt-2">
              これらの外部サービスには、サービス提供に必要な範囲でのみ情報を送信します。
            </p>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">5. Google API利用について</h2>
            <p>
              本アプリがGoogle APIから取得した情報の使用および他のアプリへの転送は、
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline hover:text-accent/80"
              >
                Google APIサービス利用者データポリシー
              </a>
              （限定使用要件を含む）に準拠します。
            </p>
            <p className="mt-3">
              AI分析に利用する画像・テキストデータは、分析結果の生成のために外部AIサービスへ送信される場合があります。当社は、送信する情報をサービス提供に必要な範囲に限定し、AIモデルの学習目的で利用しない設定・契約条件のもとで利用します。
            </p>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">6. データの保管・セキュリティ</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>データはSupabaseのセキュアなサーバーに暗号化して保存されます</li>
              <li>定期的なセキュリティ対策を実施しています</li>
              <li>退会後は、法令上または業務上必要な保存期間を除き、合理的な期間内に個人情報を削除または匿名化します</li>
            </ul>
          </section>


          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">7. お客様の権利</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>ご自身の個人情報の開示、訂正、削除を請求する権利があります</li>
              <li>請求は下記お問い合わせ先までご連絡ください</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">8. Cookieおよび類似技術</h2>
            <p>
              本アプリではサービス提供のためCookieを使用する場合があります。ブラウザの設定で無効化できますが、一部機能が利用できなくなる可能性があります。
            </p>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">9. 未成年の方について</h2>
            <p>
              18歳未満の方が本アプリを利用する場合は、保護者の同意が必要です。
            </p>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">10. プライバシーポリシーの変更</h2>
            <p>
              本ポリシーは必要に応じて改定される場合があります。重要な変更がある場合はアプリ内で通知いたします。
            </p>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">11. お問い合わせ</h2>
            <div className="bg-card border rounded-xl p-4 space-y-1">
              <p className="font-bold">ジムボード</p>
              <p className="text-sm">運営者：宗本 寛太（KantaAppLab）</p>
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
            <Link to="/terms" className="text-sm text-accent hover:text-accent/80 transition-colors font-bold">
              利用規約はこちら →
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default Privacy;
