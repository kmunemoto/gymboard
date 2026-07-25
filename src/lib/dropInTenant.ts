/**
 * ドロップイン予約（¥8,000・単発・現地決済）を提供しているジム。
 *
 * この機能は Salute御所南 が観光客向けに独自に始めたもので、
 * **他のジムには提供していない**。以下が固定値のため、そのまま他ジムに出せない:
 *   - 料金 ¥8,000（ジムごとに設定する仕組みが無い）
 *   - 画面が英語のみ（訪日観光客向けという前提）
 *   - 現地決済（オンライン決済の導線が無い）
 *
 * そのため、このテナント以外で `/drop-in/:tenantId` を開いても予約できないようにしている
 * （画面側と `drop-in-book` Edge Function の両方で弾く）。
 *
 * 将来ほかのジムにも提供するなら、まず tenants に料金・通貨・提供有無の列を足し、
 * この定数による判定を「そのジムがドロップインを有効にしているか」に置き換えること。
 * 詳細: mem/features/drop-in-booking.md
 */
export const DROP_IN_TENANT_ID = "ceda19b0-d5e0-4928-ab2e-996a0b823af4";

/** そのテナントがドロップイン予約を提供しているか */
export const isDropInAvailable = (tenantId: string | null | undefined): boolean =>
  tenantId === DROP_IN_TENANT_ID;
