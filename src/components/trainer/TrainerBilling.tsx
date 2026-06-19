import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { openExternalUrl } from "@/lib/nativeBridge";
import {
  PLAN_CARDS,
  lookupKeyFor,
  detectStripeEnvironment,
  formatLimit,
  type GymboardPeriod,
  type GymboardPlan,
} from "@/lib/gymboardPlans";
import { Check, CreditCard, ExternalLink, Users, Info } from "lucide-react";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";
import { useTranslation } from "react-i18next";

const isEmbeddedPreview = () => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
};

const navigateTopLevel = (url: string) => {
  if (isEmbeddedPreview()) {
    try {
      window.top!.location.href = url;
      return;
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
  }
  window.location.href = url;
};

const TrainerBilling = () => {
  const { t } = useTranslation();
  const { tenant, role, refetch } = useTenant();
  const [period, setPeriod] = useState<GymboardPeriod>("monthly");
  const [loadingPlan, setLoadingPlan] = useState<GymboardPlan | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);

  const isNative = Capacitor.isNativePlatform();
  const isOwner = role === "owner";
  const currentPlan: GymboardPlan = (tenant?.gymboard_plan as GymboardPlan) || "free";
  const hasPaidPlan = currentPlan !== "free";

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("billing") === "success") {
      toast.success(t("settings.billing.paymentSuccess"));
      const t1 = setTimeout(() => refetch(), 1500);
      const t2 = setTimeout(() => refetch(), 5000);
      window.history.replaceState({}, "", window.location.pathname);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
    if (params.get("billing") === "cancel") {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [refetch, t]);

  const handleCheckout = async (plan: GymboardPlan) => {
    if (!tenant || !isOwner) return;
    const lookup_key = lookupKeyFor(plan, period);
    if (!lookup_key) return;
    setLoadingPlan(plan);
    try {
      const origin = window.location.origin;
      const path = window.location.pathname;
      const environment = detectStripeEnvironment(window.location.hostname);
      const { data, error } = await supabase.functions.invoke("gymboard-create-checkout", {
        body: {
          tenant_id: tenant.id,
          lookup_key,
          environment,
          success_url: `${origin}${path}?billing=success`,
          cancel_url: `${origin}${path}?billing=cancel`,
        },
      });
      let serverError: string | undefined = (data as any)?.error;
      if (!serverError && error && (error as any).context?.json) {
        try {
          const body = await (error as any).context.json();
          serverError = body?.error;
        } catch { /* ignore */ }
      }
      if (error || serverError || !data?.url) {
        throw new Error(serverError || error?.message || t("settings.billing.checkoutFailed"));
      }
      navigateTopLevel(data.url);
    } catch (e: any) {
      console.error("gymboard-create-checkout failed:", e);
      toast.error(e?.message || t("settings.billing.genericError"));
    } finally {
      setLoadingPlan(null);
    }
  };

  const handlePortal = async () => {
    if (!tenant || !isOwner) return;
    setPortalLoading(true);
    try {
      const environment = detectStripeEnvironment(window.location.hostname);
      const { data, error } = await supabase.functions.invoke("gymboard-customer-portal", {
        body: {
          tenant_id: tenant.id,
          return_url: window.location.href,
          environment,
        },
      });
      let serverError: string | undefined = (data as any)?.error;
      if (!serverError && error && (error as any).context?.json) {
        try {
          const body = await (error as any).context.json();
          serverError = body?.error;
        } catch { /* ignore */ }
      }
      if (error || serverError || !data?.url) {
        throw new Error(serverError || error?.message || t("settings.billing.portalFailed"));
      }
      navigateTopLevel(data.url);
    } catch (e: any) {
      console.error("gymboard-customer-portal failed:", e);
      toast.error(e?.message || t("settings.billing.genericError"));
    } finally {
      setPortalLoading(false);
    }
  };

  if (!tenant) return null;

  // ===== Native (iOS/Android) view =====
  if (isNative) {
    const currentCard = PLAN_CARDS.find((p) => p.plan === currentPlan)!;
    const webPlansUrl = "https://gymboard.lovable.app/?tab=billing";
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">{t("settings.billing.currentPlan")}</p>
                <p className="text-lg font-bold">{currentCard.name}</p>
              </div>
              <CreditCard className="w-5 h-5 text-accent" />
            </div>
            <div className="flex items-center gap-1.5 text-sm">
              <Users className="w-4 h-4 text-muted-foreground" />
              <span>{t("settings.billing.customers", { count: formatLimit(currentCard.maxCustomers) })}</span>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-center gap-2">
          <div className="inline-flex rounded-xl border border-border bg-muted/40 p-1">
            <button
              type="button"
              onClick={() => setPeriod("monthly")}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                period === "monthly" ? "bg-background shadow-sm" : "text-muted-foreground"
              }`}
            >
              {t("settings.billing.monthly")}
            </button>
            <button
              type="button"
              onClick={() => setPeriod("yearly")}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                period === "yearly" ? "bg-background shadow-sm" : "text-muted-foreground"
              }`}
            >
              {t("settings.billing.yearly")}
              <span className="ml-1.5 text-[10px] font-bold text-accent">{t("settings.billing.yearlyBadge")}</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {PLAN_CARDS.map((card) => {
            const isCurrent = card.plan === currentPlan;
            const isFree = card.plan === "free";
            const price = period === "yearly" ? card.yearlyPrice : card.monthlyPrice;
            const priceSuffix = isFree ? "" : period === "yearly" ? t("settings.billing.perYear") : t("settings.billing.perMonth");
            return (
              <Card key={card.plan} className={isCurrent ? "border-accent ring-2 ring-accent/30" : ""}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold">{card.name}</p>
                      <p className="text-[11px] text-muted-foreground">{card.description}</p>
                    </div>
                    {isCurrent && (
                      <span className="text-[10px] font-bold text-accent bg-accent/10 px-2 py-0.5 rounded-full">
                        {t("settings.billing.currentBadge")}
                      </span>
                    )}
                  </div>
                  <div className="text-xl font-black">
                    ¥{price.toLocaleString()}
                    <span className="text-xs font-normal text-muted-foreground">{priceSuffix}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs">
                    <Check className="w-3.5 h-3.5 text-accent" />
                    {t("settings.billing.customers", { count: formatLimit(card.maxCustomers) })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {isOwner && (
          <Card>
            <CardContent className="p-4 space-y-2">
              <p className="text-sm font-bold">{t("settings.billing.applyTitle")}</p>
              <p className="text-xs text-muted-foreground">
                {t("settings.billing.applyDesc")}
              </p>
              <Button
                size="sm"
                className="w-full"
                onClick={() => openExternalUrl(webPlansUrl)}
              >
                <ExternalLink className="w-4 h-4 mr-1" />
                {t("settings.billing.applyWeb")}
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-[11px] text-muted-foreground">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <p>{t("settings.billing.portalInfo")}</p>
        </div>
      </div>
    );
  }

  // ===== Web view =====
  if (!isOwner) {
    const card = PLAN_CARDS.find((p) => p.plan === currentPlan)!;
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground">{t("settings.billing.currentPlan")}</p>
          <p className="text-lg font-bold">{card.name}</p>
          <p className="text-xs text-muted-foreground mt-2">{t("settings.billing.notOwner")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Period toggle */}
      <div className="flex items-center justify-center gap-2">
        <div className="inline-flex rounded-xl border border-border bg-muted/40 p-1">
          <button
            type="button"
            onClick={() => setPeriod("monthly")}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
              period === "monthly" ? "bg-background shadow-sm" : "text-muted-foreground"
            }`}
          >
            {t("settings.billing.monthly")}
          </button>
          <button
            type="button"
            onClick={() => setPeriod("yearly")}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
              period === "yearly" ? "bg-background shadow-sm" : "text-muted-foreground"
            }`}
          >
            {t("settings.billing.yearly")}
            <span className="ml-1.5 text-[10px] font-bold text-accent">{t("settings.billing.yearlyBadge")}</span>
          </button>
        </div>
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {PLAN_CARDS.map((card) => {
          const isCurrent = card.plan === currentPlan;
          const isFree = card.plan === "free";
          const price = period === "yearly" ? card.yearlyPrice : card.monthlyPrice;
          const priceSuffix = isFree ? "" : period === "yearly" ? t("settings.billing.perYear") : t("settings.billing.perMonth");
          return (
            <Card
              key={card.plan}
              className={isCurrent ? "border-accent ring-2 ring-accent/30" : ""}
            >
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold">{card.name}</p>
                    <p className="text-[11px] text-muted-foreground">{card.description}</p>
                  </div>
                  {isCurrent && (
                    <span className="text-[10px] font-bold text-accent bg-accent/10 px-2 py-0.5 rounded-full">
                      {t("settings.billing.currentBadge")}
                    </span>
                  )}
                </div>
                <div className="text-2xl font-black">
                  ¥{price.toLocaleString()}
                  <span className="text-xs font-normal text-muted-foreground">{priceSuffix}</span>
                </div>
                <ul className="space-y-1 text-xs">
                  <li className="flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5 text-accent" />
                    {t("settings.billing.customers", { count: formatLimit(card.maxCustomers) })}
                  </li>
                </ul>
                {isFree ? (
                  <Button disabled variant="outline" size="sm" className="w-full">
                    {isCurrent ? t("settings.billing.currentBadge") : "—"}
                  </Button>
                ) : isCurrent ? (
                  <Button disabled variant="outline" size="sm" className="w-full">
                    {t("settings.billing.currentBadge")}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => handleCheckout(card.plan)}
                    disabled={loadingPlan !== null}
                  >
                    {loadingPlan === card.plan ? (
                      <><DumbbellLoader className="w-4 h-4 mr-1" />{t("common.processing")}</>
                    ) : (
                      <>{t("settings.billing.selectThis")}</>
                    )}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* 法定リンク */}
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <Link to="/tokushoho" className="hover:text-accent underline transition-colors">
          {t("settings.tokushoho")}
        </Link>
        <span aria-hidden="true">·</span>
        <Link to="/terms" className="hover:text-accent underline transition-colors">
          {t("settings.terms")}
        </Link>
      </div>


      {/* Portal */}
      {hasPaidPlan && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-accent" />
              <p className="text-sm font-bold">{t("settings.billing.portalManage")}</p>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("settings.billing.portalDesc")}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={handlePortal}
              disabled={portalLoading}
            >
              {portalLoading ? (
                <><DumbbellLoader className="w-4 h-4 mr-1" />{t("common.processing")}</>
              ) : (
                <><ExternalLink className="w-4 h-4 mr-1" />{t("settings.billing.openPortal")}</>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-[11px] text-muted-foreground">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <p>{t("settings.billing.freeNote")}</p>
      </div>
    </div>
  );
};

export default TrainerBilling;
