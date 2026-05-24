import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import {
  PLAN_CARDS,
  lookupKeyFor,
  detectStripeEnvironment,
  formatLimit,
  type GymboardPeriod,
  type GymboardPlan,
} from "@/lib/gymboardPlans";
import { Check, CreditCard, ExternalLink, Loader2, Users, UserCog, Info } from "lucide-react";

const isEmbeddedPreview = () => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
};

// Top-level navigation that breaks out of the Lovable preview iframe when needed,
// so Stripe-hosted pages (Checkout / Customer Portal) aren't blocked by X-Frame-Options.
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
  const { tenant, role, refetch } = useTenant();
  const [period, setPeriod] = useState<GymboardPeriod>("monthly");
  const [loadingPlan, setLoadingPlan] = useState<GymboardPlan | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);

  const isNative = Capacitor.isNativePlatform();
  const isOwner = role === "owner";
  const currentPlan: GymboardPlan = (tenant?.gymboard_plan as GymboardPlan) || "free";
  const hasPaidPlan = currentPlan !== "free";

  // Re-fetch tenant a few seconds after returning from Checkout (webhook may take time)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("billing") === "success") {
      toast.success("お支払い手続きが完了しました。プラン情報を更新中です…");
      const t1 = setTimeout(() => refetch(), 1500);
      const t2 = setTimeout(() => refetch(), 5000);
      // strip query
      window.history.replaceState({}, "", window.location.pathname);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
    if (params.get("billing") === "cancel") {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [refetch]);

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
        throw new Error(serverError || error?.message || "Checkoutセッションの作成に失敗しました");
      }
      navigateTopLevel(data.url);
    } catch (e: any) {
      console.error("gymboard-create-checkout failed:", e);
      toast.error(e?.message || "エラーが発生しました。もう一度お試しください。");
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
        throw new Error(serverError || error?.message || "ポータルセッションの作成に失敗しました");
      }
      navigateTopLevel(data.url);
    } catch (e: any) {
      console.error("gymboard-customer-portal failed:", e);
      toast.error(e?.message || "エラーが発生しました。もう一度お試しください。");
    } finally {
      setPortalLoading(false);
    }
  };

  if (!tenant) return null;

  // ===== Native (iOS) view: read-only =====
  if (isNative) {
    const card = PLAN_CARDS.find((p) => p.plan === currentPlan)!;
    return (
      <div className="space-y-3">
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">現在のプラン</p>
                <p className="text-lg font-bold">{card.name}</p>
              </div>
              <CreditCard className="w-5 h-5 text-accent" />
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex items-center gap-1.5">
                <Users className="w-4 h-4 text-muted-foreground" />
                <span>お客様 {formatLimit(card.maxCustomers)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <UserCog className="w-4 h-4 text-muted-foreground" />
                <span>スタッフ {formatLimit(card.maxTrainers)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <p>プランの変更はWebサイトから行えます。</p>
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
          <p className="text-xs text-muted-foreground">現在のプラン</p>
          <p className="text-lg font-bold">{card.name}</p>
          <p className="text-xs text-muted-foreground mt-2">プランの変更はオーナーのみ操作可能です。</p>
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
            月額
          </button>
          <button
            type="button"
            onClick={() => setPeriod("yearly")}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
              period === "yearly" ? "bg-background shadow-sm" : "text-muted-foreground"
            }`}
          >
            年額
            <span className="ml-1.5 text-[10px] font-bold text-accent">2ヶ月分お得</span>
          </button>
        </div>
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {PLAN_CARDS.map((card) => {
          const isCurrent = card.plan === currentPlan;
          const isFree = card.plan === "free";
          const price = period === "yearly" ? card.yearlyPrice : card.monthlyPrice;
          const priceSuffix = isFree ? "" : period === "yearly" ? " / 年" : " / 月";
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
                      現在のプラン
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
                    お客様 {formatLimit(card.maxCustomers)}
                  </li>
                  <li className="flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5 text-accent" />
                    スタッフ {formatLimit(card.maxTrainers)}
                  </li>
                </ul>
                {isFree ? (
                  <Button disabled variant="outline" size="sm" className="w-full">
                    {isCurrent ? "現在のプラン" : "—"}
                  </Button>
                ) : isCurrent ? (
                  <Button disabled variant="outline" size="sm" className="w-full">
                    現在のプラン
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => handleCheckout(card.plan)}
                    disabled={loadingPlan !== null}
                  >
                    {loadingPlan === card.plan ? (
                      <><Loader2 className="w-4 h-4 mr-1 animate-spin" />処理中...</>
                    ) : (
                      <>このプランにする</>
                    )}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Portal */}
      {hasPaidPlan && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-accent" />
              <p className="text-sm font-bold">お支払い・契約の管理</p>
            </div>
            <p className="text-xs text-muted-foreground">
              請求情報の更新、領収書のダウンロード、プランの解約（Freeへの変更）はカスタマーポータルから行えます。
            </p>
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={handlePortal}
              disabled={portalLoading}
            >
              {portalLoading ? (
                <><Loader2 className="w-4 h-4 mr-1 animate-spin" />処理中...</>
              ) : (
                <><ExternalLink className="w-4 h-4 mr-1" />カスタマーポータルを開く</>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-[11px] text-muted-foreground">
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <p>Freeプランへの変更（解約）はカスタマーポータルから行ってください。</p>
      </div>
    </div>
  );
};

export default TrainerBilling;
