import { Capacitor } from "@capacitor/core";
import { ANDROID_BILLING_GUIDANCE_ENABLED, IOS_BILLING_GUIDANCE_ENABLED } from "@/lib/featureFlags";

/**
 * その端末で、ジムボードの有料プランの購入導線を出してよいか（2026-10-07）。
 *
 * App Store の審査で却下された（ガイドライン 3.1.1）ため、iPhone では止めている。
 * 何を消すか・どう戻すかは `featureFlags.ts` の `IOS_BILLING_GUIDANCE_ENABLED`。
 *
 * Web は審査が無いので常に出す。
 */
export function billingGuidanceShownOn(platform: string): boolean {
  if (platform === "ios") return IOS_BILLING_GUIDANCE_ENABLED;
  if (platform === "android") return ANDROID_BILLING_GUIDANCE_ENABLED;
  return true;
}

export const showsAppBillingGuidance = (): boolean => billingGuidanceShownOn(Capacitor.getPlatform());
