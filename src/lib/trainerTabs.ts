// トレーナー画面のタブの識別子。
//
// なぜ lib に置くか: `gymDisplaySettings.ts`（表示設定）がこの型を要る。
// もともと `TrainerView.tsx` に定義があり、lib がコンポーネントを import していた。
//
// 🔴 **lib はコンポーネントに依存しない。** 依存の向きが逆だと、
//    lib を型検査するだけでコンポーネントの木が丸ごと引きずり込まれる。
//    実際そのせいで、lib だけを strict にしようとしたときに
//    無関係な画面のエラーが13件出た（tsconfig.strict.json を入れたときに判明）。

//
// 値の一覧（TRAINER_TABS）も持つ。「開いていた画面を戻す」（src/lib/screenRestore.ts）が、
// 保存してあった値が本物のタブかを実行時に確かめるため。型は一覧から作るので、2つがズレない。

export const TRAINER_TABS = [
  "dashboard",
  "clients",
  "schedule",
  "messages",
  "exercises",
  "counseling",
  "announcements",
  "videos",
  "notifications",
  "trial-followups",
  "gym-settings",
] as const;

export type TrainerTab = (typeof TRAINER_TABS)[number];
