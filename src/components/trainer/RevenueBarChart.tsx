import { useTranslation } from "react-i18next";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from "recharts";

/**
 * ホーム画面の月別売上グラフ。**recharts を使うのはこのファイルだけ**にしてある。
 *
 * ## 🔴 なぜ切り出したか（2026-09-19）
 *
 * 宗本さん:「店舗側のジムボードアプリの読み込みが遅すぎる」
 *
 * ビルドを実測したところ、店舗ホームまでに落ちる JS は **1,774KB / 38ファイル**で、
 * そのうち **recharts が 366KB（約2割）**あった。しかも `TrainerDashboard` が
 * recharts を**静的 import** していたため、
 *
 *   - ジム設定で「売上グラフ」をOFFにしていても落ちてくる
 *   - 起動 → TrainerView → TrainerDashboard → recharts と**直列で3回**取りに行く
 *
 * という状態だった。グラフは画面のいちばん下（760行中の720行目あたり）にあり、
 * 最初の描画には要らない。
 *
 * 🔴 **`TrainerDashboard` から recharts を直接 import し直さないこと。**
 *    戻すと店舗ホームの初回読み込みに 366KB が戻る。
 *    `src/test/trainerBundle.test.ts` が見張っている。
 *
 * ⚠️ 同じ理由で、このファイルは **`lazy()` 経由でだけ**読むこと
 *    （`TrainerDashboard` 側で `lazy(() => import("./RevenueBarChart"))`）。
 */
export interface RevenuePoint {
  month: string;
  revenue: number;
}

const RevenueBarChart = ({ data }: { data: RevenuePoint[] }) => {
  const { t } = useTranslation();

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(30, 10%, 92%)" />
        <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(220, 6%, 55%)" axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fontSize: 10 }}
          stroke="hsl(220, 6%, 55%)"
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `${v / 10000}${t("dashboard.monthMan")}`}
          width={40}
        />
        <Tooltip
          formatter={(value: number) => [`¥${value.toLocaleString()}`, t("dashboard.revenueLabel")]}
          contentStyle={{
            background: 'hsl(0, 0%, 100%)',
            border: 'none',
            borderRadius: '12px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
            fontSize: '12px',
          }}
        />
        <Bar dataKey="revenue" fill="hsl(174, 65%, 50%)" radius={[8, 8, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
};

export default RevenueBarChart;
