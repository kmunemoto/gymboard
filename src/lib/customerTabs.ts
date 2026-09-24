// お客様画面のタブの識別子。
//
// なぜ lib に置くか: 「開いていた画面を戻す」（src/lib/screenRestore.ts）が、
// 保存してあった値が本物のタブかを確かめるのに**値の一覧**を要る。
// 型だけだと実行時に確かめられない。trainerTabs.ts と同じ理由・同じ形。
//
// 🔴 lib はコンポーネントに依存しない（CustomerView はここから re-export している）。

export const CUSTOMER_TABS = [
  "home",
  "booking",
  "training",
  "meals",
  "chat",
  "settings",
  "posture",
  "report",
  "photos",
  "videos",
] as const;

export type CustomerTab = (typeof CUSTOMER_TABS)[number];
