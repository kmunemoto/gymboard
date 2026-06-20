import { Link } from "react-router-dom";
import { ArrowLeft, Mail, Settings, Trash2, AlertCircle, Database } from "lucide-react";
import { useTranslation } from "react-i18next";

const BackLink = () => {
  const { t } = useTranslation();
  return (
    <Link
      to="/"
      className="inline-flex items-center gap-1.5 text-sm text-accent hover:text-accent/80 transition-colors font-bold"
    >
      <ArrowLeft className="w-4 h-4" />
      {t("deleteAccount.backToApp")}
    </Link>
  );
};

const DeleteAccount = () => {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-5 py-8 sm:px-8 sm:py-12 leading-relaxed">
        <div className="mb-6">
          <BackLink />
        </div>

        <header className="mb-10">
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">{t("deleteAccount.title")}</h1>
          <p className="text-sm text-muted-foreground mt-2">{t("deleteAccount.appSubtitle")}</p>
        </header>

        <article className="space-y-10 text-[15px]">
          <section>
            <p>{t("deleteAccount.intro")}</p>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3 flex items-center gap-2">
              <Settings className="w-5 h-5 text-accent" />
              {t("deleteAccount.inAppTitle")}
            </h2>
            <ol className="list-decimal pl-6 space-y-2">
              <li>{t("deleteAccount.inAppStep1")}</li>
              <li>{t("deleteAccount.inAppStep2")}</li>
              <li>{t("deleteAccount.inAppStep3")}</li>
              <li>{t("deleteAccount.inAppStep4")}</li>
            </ol>

            <div className="mt-4 bg-card border rounded-xl p-4 flex gap-3">
              <AlertCircle className="w-5 h-5 text-accent shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-bold mb-1">{t("deleteAccount.ownerTitle")}</p>
                <p>{t("deleteAccount.ownerBody")}</p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3 flex items-center gap-2">
              <Mail className="w-5 h-5 text-accent" />
              {t("deleteAccount.noAccessTitle")}
            </h2>
            <p className="mb-3">{t("deleteAccount.noAccessBody")}</p>
            <div className="bg-card border rounded-xl p-4 space-y-1">
              <p className="text-sm font-bold">{t("deleteAccount.requestLabel")}</p>
              <p className="text-sm">
                <a
                  href="mailto:k.munemoto@kyoto-salute.com?subject=gymboard%20アカウント削除リクエスト"
                  className="text-accent underline hover:text-accent/80"
                >
                  k.munemoto@kyoto-salute.com
                </a>
              </p>
              <p className="text-xs text-muted-foreground pt-2">{t("deleteAccount.requestNote")}</p>
            </div>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3 flex items-center gap-2">
              <Database className="w-5 h-5 text-accent" />
              {t("deleteAccount.dataTitle")}
            </h2>
            <p className="mb-3">{t("deleteAccount.dataIntro")}</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>{t("deleteAccount.dataItem1")}</li>
              <li>{t("deleteAccount.dataItem2")}</li>
              <li>{t("deleteAccount.dataItem3")}</li>
              <li>{t("deleteAccount.dataItem4")}</li>
              <li>{t("deleteAccount.dataItem5")}</li>
              <li>{t("deleteAccount.dataItem6")}</li>
              <li>{t("deleteAccount.dataItem7")}</li>
              <li>{t("deleteAccount.dataItem8")}</li>
              <li>{t("deleteAccount.dataItem9")}</li>
            </ul>
            <p className="mt-3 text-sm text-muted-foreground">{t("deleteAccount.dataNote")}</p>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3 flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-accent" />
              {t("deleteAccount.noticeTitle")}
            </h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>{t("deleteAccount.noticeItem1")}</li>
              <li>{t("deleteAccount.noticeItem2")}</li>
              <li>{t("deleteAccount.noticeItem3")}</li>
            </ul>
          </section>
        </article>

        <footer className="mt-12 pt-6 border-t text-sm text-muted-foreground space-y-2">
          <p>{t("deleteAccount.updatedDate")}</p>
          <div className="pt-4 flex flex-wrap gap-4">
            <BackLink />
            <Link to="/privacy" className="text-sm text-accent hover:text-accent/80 transition-colors font-bold">
              {t("deleteAccount.linkToPrivacy")}
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default DeleteAccount;
