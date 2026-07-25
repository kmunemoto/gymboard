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
      {t("tokushoho.backToApp")}
    </Link>
  );
};

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
  const { t } = useTranslation();
  const businessRows: Row[] = [
    { label: t("tokushoho.rowSellerName"), value: t("tokushoho.rowSellerNameV") },
    { label: t("tokushoho.rowBrand"), value: t("tokushoho.rowBrandV") },
    { label: t("tokushoho.rowOwner"), value: t("tokushoho.rowOwnerV") },
    { label: t("tokushoho.rowAddress"), value: t("tokushoho.rowAddressV") },
    {
      label: t("tokushoho.rowPhone"),
      value: (
        <>
          {t("tokushoho.rowPhoneV")}
          <p className="text-xs text-muted-foreground mt-1">{t("tokushoho.rowPhoneNote")}</p>
        </>
      ),
    },
    {
      label: t("tokushoho.rowEmail"),
      value: (
        <a
          href={`mailto:${GYMBOARD_SUPPORT_EMAIL}`}
          className="text-accent underline hover:text-accent/80"
        >
          {GYMBOARD_SUPPORT_EMAIL}
        </a>
      ),
    },
    { label: t("tokushoho.rowService"), value: t("tokushoho.rowServiceV") },
  ];

  const priceRows: Row[] = [
    { label: t("tokushoho.priceFree"), value: t("tokushoho.priceFreeV") },
    { label: t("tokushoho.priceStarter"), value: t("tokushoho.priceStarterV") },
    { label: t("tokushoho.priceStandard"), value: t("tokushoho.priceStandardV") },
    { label: t("tokushoho.pricePro"), value: t("tokushoho.priceProV") },
    { label: t("tokushoho.priceNote"), value: t("tokushoho.priceNoteV") },
  ];

  const otherRows: Row[] = [
    { label: t("tokushoho.rowExtraCost"), value: t("tokushoho.rowExtraCostV") },
    { label: t("tokushoho.rowPayment"), value: t("tokushoho.rowPaymentV") },
    {
      label: t("tokushoho.rowPaymentTiming"),
      value: (
        <ul className="list-disc pl-5 space-y-1">
          <li>{t("tokushoho.rowPaymentTiming1")}</li>
          <li>{t("tokushoho.rowPaymentTiming2")}</li>
        </ul>
      ),
    },
    { label: t("tokushoho.rowDelivery"), value: t("tokushoho.rowDeliveryV") },
    {
      label: t("tokushoho.rowRefund"),
      value: (
        <ul className="list-disc pl-5 space-y-1">
          <li>{t("tokushoho.rowRefund1")}</li>
          <li>{t("tokushoho.rowRefund2")}</li>
          <li>{t("tokushoho.rowRefund3")}</li>
        </ul>
      ),
    },
    { label: t("tokushoho.rowEnv"), value: t("tokushoho.rowEnvV") },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-5 py-8 sm:px-8 sm:py-12 leading-relaxed">
        <div className="mb-6">
          <BackLink />
        </div>

        <header className="mb-10">
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight">{t("tokushoho.title")}</h1>
          <p className="text-sm text-muted-foreground mt-2">{t("tokushoho.appSubtitle")}</p>
        </header>

        <article className="space-y-10 text-[15px]">
          <Section title={t("tokushoho.sectionBusiness")} rows={businessRows} />
          <Section title={t("tokushoho.sectionPrice")} rows={priceRows} />
          <Section title={t("tokushoho.sectionOther")} rows={otherRows} />
        </article>

        <footer className="mt-12 pt-6 border-t text-sm text-muted-foreground space-y-2">
          <p>{t("tokushoho.updatedDate")}</p>
          <div className="pt-4 flex flex-wrap gap-4">
            <BackLink />
            <Link to="/terms" className="text-sm text-accent hover:text-accent/80 transition-colors font-bold">
              {t("tokushoho.linkToTerms")}
            </Link>
            <Link to="/privacy" className="text-sm text-accent hover:text-accent/80 transition-colors font-bold">
              {t("tokushoho.linkToPrivacy")}
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default Tokushoho;
