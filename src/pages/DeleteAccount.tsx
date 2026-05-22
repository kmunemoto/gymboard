import { Link } from "react-router-dom";
import { ArrowLeft, Mail, Settings, Trash2, AlertCircle, Database } from "lucide-react";

const BackLink = () => (
  <Link
    to="/"
    className="inline-flex items-center gap-1.5 text-sm text-accent hover:text-accent/80 transition-colors font-bold"
  >
    <ArrowLeft className="w-4 h-4" />
    アプリに戻る
  </Link>
);

const DeleteAccount = () => {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-5 py-8 sm:px-8 sm:py-12 leading-relaxed">
        <div className="mb-6">
          <BackLink />
        </div>

        <header className="mb-10">
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">アカウントの削除について</h1>
          <p className="text-sm text-muted-foreground mt-2">
            ジムボード / gymboardアプリ
          </p>
        </header>

        <article className="space-y-10 text-[15px]">
          <section>
            <p>
              gymboardアプリでは、お客様ご自身でアカウントを削除いただけます。以下の方法のいずれかでお手続きください。
            </p>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3 flex items-center gap-2">
              <Settings className="w-5 h-5 text-accent" />
              アプリ内で削除する方法
            </h2>
            <ol className="list-decimal pl-6 space-y-2">
              <li>gymboardアプリにログインします。</li>
              <li>画面下部のメニューから「設定」を開きます。</li>
              <li>設定画面の最下部にある「アカウントを削除する」ボタンをタップします。</li>
              <li>確認ダイアログで「削除する」を選択すると、アカウントが削除されます。</li>
            </ol>

            <div className="mt-4 bg-card border rounded-xl p-4 flex gap-3">
              <AlertCircle className="w-5 h-5 text-accent shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-bold mb-1">ジムオーナーの方へ</p>
                <p>
                  ジムオーナーのアカウントは、ジムの登録が残っている状態では削除できません。先にジムを削除いただくか、別のオーナーへ引き継いだ後にアカウント削除をお願いいたします。
                </p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3 flex items-center gap-2">
              <Mail className="w-5 h-5 text-accent" />
              アプリにアクセスできない場合
            </h2>
            <p className="mb-3">
              アプリをアンインストール済みの場合や、ログインできない場合は、下記メールアドレス宛にアカウント削除のリクエストをお送りください。ご本人確認のうえ、運営にて削除対応をいたします。
            </p>
            <div className="bg-card border rounded-xl p-4 space-y-1">
              <p className="text-sm font-bold">アカウント削除リクエスト送信先</p>
              <p className="text-sm">
                <a
                  href="mailto:k.munemoto@kyoto-salute.com?subject=gymboard%20アカウント削除リクエスト"
                  className="text-accent underline hover:text-accent/80"
                >
                  k.munemoto@kyoto-salute.com
                </a>
              </p>
              <p className="text-xs text-muted-foreground pt-2">
                件名「gymboard アカウント削除リクエスト」とし、ご登録のお名前・メールアドレスを本文に記載してください。
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3 flex items-center gap-2">
              <Database className="w-5 h-5 text-accent" />
              削除されるデータ
            </h2>
            <p className="mb-3">アカウント削除時には、以下のデータが削除または匿名化されます。</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>プロフィール情報（氏名、メールアドレス、電話番号、生年月日、性別など）</li>
              <li>身体情報（身長、体重、体脂肪率など）</li>
              <li>予約情報・キャンセル履歴</li>
              <li>トレーニング記録</li>
              <li>食事記録および食事画像</li>
              <li>姿勢分析の結果および姿勢画像</li>
              <li>トレーナー・お客様間のメッセージ</li>
              <li>カウンセリング情報、健康情報</li>
              <li>Google連携情報、LINE連携情報</li>
            </ul>
            <p className="mt-3 text-sm text-muted-foreground">
              法令上または業務上必要な保存期間を除き、合理的な期間内にデータを削除または匿名化いたします。一度削除されたデータの復元はできません。
            </p>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3 flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-accent" />
              ご注意
            </h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>アカウントを削除すると、再度同じデータを利用することはできません。</li>
              <li>有料プランをご利用中の場合、削除前に解約手続きをお済ませください。</li>
              <li>ご不明な点は、上記メールアドレスまでお問い合わせください。</li>
            </ul>
          </section>
        </article>

        <footer className="mt-12 pt-6 border-t text-sm text-muted-foreground space-y-2">
          <p>最終更新日：2026年5月22日</p>
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

export default DeleteAccount;
