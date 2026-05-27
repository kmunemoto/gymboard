import { Card, CardContent } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  BookOpen,
  Users,
  CalendarDays,
  Dumbbell,
  Megaphone,
  ClipboardList,
  MessageCircle,
  Ticket,
  Smartphone,
  AlertTriangle,
  ListChecks,
  CreditCard,
} from "lucide-react";

const TrainerHelpGuide = () => {
  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
            <BookOpen className="w-4 h-4 text-accent" />
          </div>
          <div>
            <h3 className="font-bold text-sm">使い方ガイド</h3>
            <p className="text-xs text-muted-foreground">
              GymBoardの基本操作と、お客様の招待方法をまとめています
            </p>
          </div>
        </div>

        <Accordion type="single" collapsible className="w-full">
          {/* 1. 基本機能 */}
          <AccordionItem value="basics">
            <AccordionTrigger className="text-sm font-bold">
              <span className="flex items-center gap-2">
                <ListChecks className="w-4 h-4 text-accent" />
                1. オーナー側でできること
              </span>
            </AccordionTrigger>
            <AccordionContent className="text-sm text-muted-foreground space-y-3 pt-2">
              <p>左側メニュー（PC）／下部ナビ（スマホ）から各機能にアクセスできます。</p>
              <ul className="space-y-2">
                <li className="flex gap-2">
                  <Users className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                  <span>
                    <b className="text-foreground">顧客一覧</b>：参加中のお客様の確認、
                    プラン割り当て、トレーニング履歴・食事記録・体組成・予約状況の閲覧、
                    代理予約など。
                  </span>
                </li>
                <li className="flex gap-2">
                  <CalendarDays className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                  <span>
                    <b className="text-foreground">スケジュール</b>：予約一覧の確認、
                    時間帯のブロック（休業・施術中などで埋める）、代理予約の作成。
                  </span>
                </li>
                <li className="flex gap-2">
                  <Dumbbell className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                  <span>
                    <b className="text-foreground">種目管理</b>：お客様がトレーニング記録で
                    選べる種目マスタの登録・編集。
                  </span>
                </li>
                <li className="flex gap-2">
                  <Megaphone className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                  <span>
                    <b className="text-foreground">お知らせ管理</b>：お客様のアプリ上に
                    表示するお知らせを作成・配信。
                  </span>
                </li>
                <li className="flex gap-2">
                  <ClipboardList className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                  <span>
                    <b className="text-foreground">カウンセリング</b>：体験・カウンセリング
                    フォームからの回答一覧。
                  </span>
                </li>
                <li className="flex gap-2">
                  <MessageCircle className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                  <span>
                    <b className="text-foreground">メッセージ</b>：お客様との1対1チャット。
                    新着はヘッダーのアイコンに通知バッジが付きます。
                  </span>
                </li>
              </ul>
            </AccordionContent>
          </AccordionItem>

          {/* 2. お客様の招待 */}
          <AccordionItem value="invite">
            <AccordionTrigger className="text-sm font-bold">
              <span className="flex items-center gap-2">
                <Ticket className="w-4 h-4 text-accent" />
                2. お客様の招待・登録方法
              </span>
            </AccordionTrigger>
            <AccordionContent className="text-sm text-muted-foreground space-y-3 pt-2">
              <p>
                お客様の参加は <b className="text-foreground">招待コード</b>（または招待リンク）
                で行います。ジムごとに固有のコードが自動発行されています。
              </p>
              <ol className="space-y-3 list-decimal list-inside">
                <li>
                  <b className="text-foreground">招待コード／リンクを取得</b>
                  <p className="ml-5 mt-1">
                    ジム設定の「招待コード」カードから、コードまたは
                    招待リンク（<code className="text-xs bg-muted px-1 rounded">/join/コード</code>）
                    をコピーできます。
                  </p>
                </li>
                <li>
                  <b className="text-foreground">お客様に共有</b>
                  <p className="ml-5 mt-1">
                    LINE・メール・口頭など、任意の方法でお客様にお伝えください。
                    招待リンクを送ると入力の手間が省けて確実です。
                  </p>
                </li>
                <li>
                  <b className="text-foreground">お客様がアプリにアクセス</b>
                  <p className="ml-5 mt-1">
                    お客様はスマートフォンのブラウザ（Safari／Chrome 等）で
                    招待リンクを開きます。コードを口頭で伝えた場合は、
                    GymBoardのサイトを開いて「ジムに参加」からコードを入力します。
                  </p>
                </li>
                <li>
                  <b className="text-foreground">アカウント作成（メール＋パスワード）</b>
                  <p className="ml-5 mt-1">
                    未登録のお客様は、その場でメールアドレスとパスワードを設定して
                    新規登録します。メール確認は不要で、登録後すぐにご利用いただけます。
                  </p>
                </li>
                <li>
                  <b className="text-foreground">表示名を入力して参加完了</b>
                  <p className="ml-5 mt-1">
                    ジム名を確認のうえ「参加する」をタップ、表示名（オーナーに
                    表示される名前）を入れると登録が完了します。
                  </p>
                </li>
                <li>
                  <b className="text-foreground">ホーム画面に追加のご案内（任意）</b>
                  <p className="ml-5 mt-1">
                    お客様のアプリ上には「ホーム画面に追加」の案内が表示されます。
                    追加するとアプリのように起動でき、利便性が向上します。
                  </p>
                </li>
              </ol>
            </AccordionContent>
          </AccordionItem>

          {/* 3. お客様側の機能 */}
          <AccordionItem value="customer-features">
            <AccordionTrigger className="text-sm font-bold">
              <span className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-accent" />
                3. お客様がアプリでできること
              </span>
            </AccordionTrigger>
            <AccordionContent className="text-sm text-muted-foreground space-y-2 pt-2">
              <ul className="space-y-2 list-disc list-inside">
                <li>セッションの予約・キャンセル、予約状況・残回数の確認</li>
                <li>トレーニング記録（種目・セット・重量・回数）の入力と推移グラフ</li>
                <li>食事の写真記録とAIによる栄養素の自動分析</li>
                <li>体重・体脂肪率などの体組成記録と推移グラフ</li>
                <li>姿勢分析（写真からの骨格・姿勢チェック）</li>
                <li>月次レポートの閲覧</li>
                <li>オーナーとの1対1チャット、ジムからのお知らせ閲覧</li>
              </ul>
            </AccordionContent>
          </AccordionItem>

          {/* 4. つまずきポイント */}
          <AccordionItem value="troubleshooting">
            <AccordionTrigger className="text-sm font-bold">
              <span className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-accent" />
                4. つまずきやすいポイント
              </span>
            </AccordionTrigger>
            <AccordionContent className="text-sm text-muted-foreground space-y-2 pt-2">
              <ul className="space-y-2 list-disc list-inside">
                <li>
                  <b className="text-foreground">招待リンクが開けない</b>：
                  お客様の端末のメッセージアプリ内ブラウザでは正しく動かない場合があります。
                  「Safariで開く」「Chromeで開く」を案内してください。
                </li>
                <li>
                  <b className="text-foreground">1ユーザー1ジムまで</b>：
                  既に他のジムに参加中のメールアドレスでは、同じアカウントで
                  別のジムに参加することはできません。
                </li>
                <li>
                  <b className="text-foreground">招待コードが見つからない</b>：
                  コードは大文字小文字・ハイフンを無視して照合されますが、
                  全角数字や余分なスペースが入っていると失敗します。
                </li>
                <li>
                  <b className="text-foreground">予約枠が表示されない</b>：
                  ジム設定の営業時間・スロット時間が未設定だと予約枠が出ません。
                  スケジュール画面でブロックを入れすぎていないかも確認してください。
                </li>
                <li>
                  <b className="text-foreground">プラン上限の超過</b>：
                  ご契約プランの顧客数上限を超えると、新規予約や記録の追加が
                  制限されます。プラン変更または顧客整理で解除されます。
                </li>
              </ul>
            </AccordionContent>
          </AccordionItem>

          {/* 5. プランのご契約方法 */}
          <AccordionItem value="plan-subscription">
            <AccordionTrigger className="text-sm font-bold">
              <span className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-accent" />
                5. プランのご契約方法
              </span>
            </AccordionTrigger>
            <AccordionContent className="text-sm text-muted-foreground space-y-3 pt-2">
              <p>
                GymBoardの有料プランはWeb版の管理画面からご契約いただけます。
                アプリと同じアカウントでログインしてください。
              </p>
              <ol className="space-y-3 list-decimal list-inside">
                <li>
                  <b className="text-foreground">Webの管理サイトにアクセス</b>
                  <p className="ml-5 mt-1">
                    スマートフォンまたはPCのブラウザで
                    <code className="text-xs bg-muted px-1 rounded">https://gymboard.lovable.app</code>
                    を開き、アプリと同じメールアドレス・パスワードでログインします。
                  </p>
                </li>
                <li>
                  <b className="text-foreground">「プラン・お支払い」を開く</b>
                  <p className="ml-5 mt-1">
                    管理画面の「ジム設定」から「プラン・お支払い」セクションを
                    選択します。
                  </p>
                </li>
                <li>
                  <b className="text-foreground">プランと支払い周期を選ぶ</b>
                  <p className="ml-5 mt-1">
                    Starter / Standard / Pro の中からご希望のプランを選び、
                    月額または年額（2ヶ月分お得）を選択します。
                  </p>
                </li>
                <li>
                  <b className="text-foreground">決済を完了する</b>
                  <p className="ml-5 mt-1">
                    画面の案内にそってクレジットカード情報を入力し、
                    決済を完了させます。請求情報や領収書は後から
                    カスタマーポータルで確認できます。
                  </p>
                </li>
                <li>
                  <b className="text-foreground">アプリに反映される</b>
                  <p className="ml-5 mt-1">
                    契約完了後、アプリの「現在のプラン」表示に反映されます。
                    反映には数分かかる場合があります。
                  </p>
                </li>
              </ol>
              <p className="text-xs">
                <b className="text-foreground">注意</b>：
                プランの変更・解約はWeb版のカスタマーポータルから行えます。
                アプリ内では閲覧のみとなります。
              </p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
};

export default TrainerHelpGuide;
