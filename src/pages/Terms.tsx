import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";

const BackLink = () => {
  const { t } = useTranslation();
  return (
    <Link
      to="/"
      className="inline-flex items-center gap-1.5 text-sm text-accent hover:text-accent/80 transition-colors font-bold"
    >
      <ArrowLeft className="w-4 h-4" />
      {t("terms.backToApp")}
    </Link>
  );
};

const Terms = () => {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-5 py-8 sm:px-8 sm:py-12 leading-relaxed">
        <div className="mb-6">
          <BackLink />
        </div>

        <header className="mb-10">
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">{t("terms.title")}</h1>
          <p className="text-sm text-muted-foreground mt-2">{t("terms.appSubtitle")}</p>
        </header>

        <article className="space-y-10 text-[15px]">
          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">{t("terms.s1Title")}</h2>
            <p>{t("terms.s1Body")}</p>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">{t("terms.s2Title")}</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>{t("terms.s2Item1")}</li>
              <li>{t("terms.s2Item2")}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">{t("terms.s3Title")}</h2>
            <p className="mb-2">{t("terms.s3Intro")}</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>{t("terms.s3Item1")}</li>
              <li>{t("terms.s3Item2")}</li>
              <li>{t("terms.s3Item3")}</li>
              <li>{t("terms.s3Item4")}</li>
              <li>{t("terms.s3Item5")}</li>
              <li>{t("terms.s3Item6")}</li>
              <li>{t("terms.s3Item7")}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">{t("terms.s4Title")}</h2>
            <p className="mb-2">{t("terms.s4Intro")}</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>{t("terms.s4Item1")}</li>
              <li>{t("terms.s4Item2")}</li>
              <li>{t("terms.s4Item3")}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">{t("terms.s5Title")}</h2>
            <p>{t("terms.s5Body")}</p>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">{t("terms.s6Title")}</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>{t("terms.s6Item1")}</li>
              <li>{t("terms.s6Item2")}</li>
              <li>{t("terms.s6Item3")}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">{t("terms.s7Title")}</h2>
            <p>{t("terms.s7Body")}</p>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">{t("terms.s8Title")}</h2>
            <p>{t("terms.s8Body")}</p>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">{t("terms.s9Title")}</h2>
            <p>{t("terms.s9Body")}</p>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">{t("terms.s10Title")}</h2>
            <div className="bg-card border rounded-xl p-4 space-y-1">
              <p className="font-bold">{t("terms.contactName")}</p>
              <p className="text-sm">{t("terms.contactAddressLabel")}</p>
              <p className="text-sm">
                {t("terms.contactEmailLabel")}
                <a href="mailto:info@gymboard.app" className="text-accent underline hover:text-accent/80">
                  info@gymboard.app
                </a>
              </p>
            </div>
          </section>
        </article>

        <footer className="mt-12 pt-6 border-t text-sm text-muted-foreground space-y-2">
          <p>{t("terms.establishedDate")}</p>
          <p>{t("terms.updatedDate")}</p>
          <div className="pt-4 flex flex-wrap gap-4">
            <BackLink />
            <Link to="/privacy" className="text-sm text-accent hover:text-accent/80 transition-colors font-bold">
              {t("terms.linkToPrivacy")}
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default Terms;
