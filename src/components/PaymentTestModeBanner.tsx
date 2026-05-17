const clientToken = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN;

export function PaymentTestModeBanner() {
  if (!clientToken?.startsWith("pk_test_")) return null;
  return (
    <div className="w-full bg-orange-100 border-b border-orange-300 px-3 py-1.5 text-center text-xs text-orange-800">
      テスト決済モードです。実際の請求は発生しません。
    </div>
  );
}