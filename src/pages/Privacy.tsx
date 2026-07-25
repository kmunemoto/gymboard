import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { GYMBOARD_SUPPORT_EMAIL } from "@/lib/marketing";

const BackLink = () => {
  const { t } = useTranslation();
  return (
    <Link
      to="/"
      className="inline-flex items-center gap-1.5 text-sm text-accent hover:text-accent/80 transition-colors font-bold"
    >
      <ArrowLeft className="w-4 h-4" />
      {t("privacy.backToApp")}
    </Link>
  );
};

const Privacy = () => {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-5 py-8 sm:px-8 sm:py-12 leading-relaxed">
        <div className="mb-6">
          <BackLink />
        </div>

        <header className="mb-10">
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">{t("privacy.title")}</h1>
          <p className="text-sm text-muted-foreground mt-2">{t("privacy.appSubtitle")}</p>
        </header>

        <article className="space-y-10 text-[15px]">
          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">{t("privacy.s1Title")}</h2>
            <p>{t("privacy.s1Body")}</p>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">{t("privacy.s2Title")}</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>{t("privacy.s2Basic")}</strong>{t("privacy.s2BasicV")}</li>
              <li><strong>{t("privacy.s2Body")}</strong>{t("privacy.s2BodyV")}</li>
              <li>
                <strong>{t("privacy.s2Health")}</strong>{t("privacy.s2HealthV")}
                <p className="mt-1 text-sm text-muted-foreground">{t("privacy.s2HealthNote")}</p>
              </li>
              <li><strong>{t("privacy.s2Image")}</strong>{t("privacy.s2ImageV")}</li>
              <li><strong>{t("privacy.s2Booking")}</strong>{t("privacy.s2BookingV")}</li>
              <li><strong>{t("privacy.s2Google")}</strong>{t("privacy.s2GoogleV")}</li>
              <li><strong>{t("privacy.s2Line")}</strong>{t("privacy.s2LineV")}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">{t("privacy.s3Title")}</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>{t("privacy.s3Item1")}</li>
              <li>{t("privacy.s3Item2")}</li>
              <li>{t("privacy.s3Item3")}</li>
              <li>{t("privacy.s3Item4")}</li>
            </ul>
            <p className="mt-3">{t("privacy.s3Body")}</p>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">{t("privacy.s4Title")}</h2>
            <p className="mb-2">{t("privacy.s4P1")}</p>
            <p className="mb-2">{t("privacy.s4P2")}</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>{t("privacy.s4Item1")}</li>
              <li>{t("privacy.s4Item2")}</li>
              <li>{t("privacy.s4Item3")}</li>
              <li>{t("privacy.s4Item4")}</li>
              <li>{t("privacy.s4Item5")}</li>
            </ul>
            <p className="mt-2">{t("privacy.s4P3")}</p>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">{t("privacy.s5Title")}</h2>
            <p>
              {t("privacy.s5P1Pre")}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline hover:text-accent/80"
              >
                {t("privacy.s5LinkText")}
              </a>
              {t("privacy.s5P1Post")}
            </p>
            <p className="mt-3">{t("privacy.s5P2")}</p>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">{t("privacy.s6Title")}</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>{t("privacy.s6Item1")}</li>
              <li>{t("privacy.s6Item2")}</li>
              <li>{t("privacy.s6Item3")}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">{t("privacy.s7Title")}</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>{t("privacy.s7Item1")}</li>
              <li>{t("privacy.s7Item2")}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">{t("privacy.s8Title")}</h2>
            <p>{t("privacy.s8Body")}</p>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">{t("privacy.s9Title")}</h2>
            <p>{t("privacy.s9Body")}</p>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">{t("privacy.s10Title")}</h2>
            <p>{t("privacy.s10Body")}</p>
          </section>

          <section>
            <h2 className="text-lg sm:text-xl font-bold mb-3 border-l-4 border-accent pl-3">{t("privacy.s11Title")}</h2>
            <div className="bg-card border rounded-xl p-4 space-y-1">
              <p className="font-bold">{t("privacy.contactName")}</p>
              <p className="text-sm">{t("privacy.contactOperator")}</p>
              <p className="text-sm">
                {t("privacy.contactEmailLabel")}
                <a href={`mailto:${GYMBOARD_SUPPORT_EMAIL}`} className="text-accent underline hover:text-accent/80">
                  {GYMBOARD_SUPPORT_EMAIL}
                </a>
              </p>
            </div>
          </section>
        </article>

        <footer className="mt-12 pt-6 border-t text-sm text-muted-foreground space-y-2">
          <p>{t("privacy.establishedDate")}</p>
          <p>{t("privacy.updatedDate")}</p>
          <div className="pt-4 flex flex-wrap gap-4">
            <BackLink />
            <Link to="/terms" className="text-sm text-accent hover:text-accent/80 transition-colors font-bold">
              {t("privacy.linkToTerms")}
            </Link>
            <Link to="/delete-account" className="text-sm text-accent hover:text-accent/80 transition-colors font-bold">
              {t("privacy.linkToDelete")}
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default Privacy;
