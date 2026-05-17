import React from "react";

type IconComponent = React.FC<{ className?: string }>;

const BenchPressIcon: IconComponent = ({ className }) => (
  <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <line x1="8" y1="14" x2="40" y2="14" />
    <circle cx="6" cy="14" r="3" />
    <circle cx="42" cy="14" r="3" />
    <circle cx="24" cy="24" r="4" />
    <line x1="24" y1="28" x2="24" y2="38" />
    <line x1="24" y1="32" x2="16" y2="18" />
    <line x1="24" y1="32" x2="32" y2="18" />
    <line x1="20" y1="38" x2="28" y2="38" />
  </svg>
);

const SquatIcon: IconComponent = ({ className }) => (
  <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="24" cy="10" r="4" />
    <line x1="12" y1="18" x2="36" y2="18" />
    <line x1="24" y1="14" x2="24" y2="28" />
    <line x1="24" y1="18" x2="16" y2="22" />
    <line x1="24" y1="18" x2="32" y2="22" />
    <line x1="24" y1="28" x2="18" y2="38" />
    <line x1="24" y1="28" x2="30" y2="38" />
    <line x1="18" y1="38" x2="16" y2="42" />
    <line x1="30" y1="38" x2="32" y2="42" />
  </svg>
);

const DeadliftIcon: IconComponent = ({ className }) => (
  <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="24" cy="8" r="4" />
    <line x1="24" y1="12" x2="24" y2="28" />
    <line x1="24" y1="18" x2="18" y2="36" />
    <line x1="24" y1="18" x2="30" y2="36" />
    <line x1="24" y1="28" x2="18" y2="36" />
    <line x1="24" y1="28" x2="30" y2="36" />
    <line x1="12" y1="36" x2="36" y2="36" />
    <circle cx="10" cy="36" r="3" />
    <circle cx="38" cy="36" r="3" />
  </svg>
);

const PulldownIcon: IconComponent = ({ className }) => (
  <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <line x1="10" y1="6" x2="38" y2="6" />
    <circle cx="24" cy="14" r="4" />
    <line x1="24" y1="18" x2="24" y2="32" />
    <line x1="24" y1="22" x2="14" y2="10" />
    <line x1="24" y1="22" x2="34" y2="10" />
    <line x1="24" y1="32" x2="18" y2="42" />
    <line x1="24" y1="32" x2="30" y2="42" />
  </svg>
);

const RowIcon: IconComponent = ({ className }) => (
  <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="20" cy="12" r="4" />
    <line x1="20" y1="16" x2="24" y2="30" />
    <line x1="24" y1="22" x2="36" y2="20" />
    <line x1="24" y1="22" x2="36" y2="26" />
    <line x1="24" y1="30" x2="16" y2="42" />
    <line x1="24" y1="30" x2="30" y2="42" />
  </svg>
);

const ShoulderIcon: IconComponent = ({ className }) => (
  <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="24" cy="10" r="4" />
    <line x1="24" y1="14" x2="24" y2="30" />
    <line x1="24" y1="18" x2="14" y2="8" />
    <line x1="24" y1="18" x2="34" y2="8" />
    <rect x="12" y="5" width="4" height="6" rx="1" />
    <rect x="32" y="5" width="4" height="6" rx="1" />
    <line x1="24" y1="30" x2="18" y2="42" />
    <line x1="24" y1="30" x2="30" y2="42" />
  </svg>
);

const CurlIcon: IconComponent = ({ className }) => (
  <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="24" cy="10" r="4" />
    <line x1="24" y1="14" x2="24" y2="30" />
    <line x1="24" y1="20" x2="32" y2="24" />
    <line x1="32" y1="24" x2="32" y2="16" />
    <rect x="30" y="12" width="4" height="5" rx="1" />
    <line x1="24" y1="20" x2="16" y2="26" />
    <line x1="24" y1="30" x2="18" y2="42" />
    <line x1="24" y1="30" x2="30" y2="42" />
  </svg>
);

const CoreIcon: IconComponent = ({ className }) => (
  <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="10" cy="24" r="4" />
    <line x1="14" y1="24" x2="34" y2="24" />
    <line x1="14" y1="24" x2="12" y2="32" />
    <line x1="34" y1="24" x2="38" y2="32" />
    <line x1="34" y1="24" x2="38" y2="18" />
  </svg>
);

const LungeIcon: IconComponent = ({ className }) => (
  <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="24" cy="8" r="4" />
    <line x1="24" y1="12" x2="24" y2="26" />
    <line x1="24" y1="18" x2="18" y2="24" />
    <line x1="24" y1="18" x2="30" y2="24" />
    <line x1="24" y1="26" x2="14" y2="40" />
    <line x1="24" y1="26" x2="34" y2="36" />
    <line x1="34" y1="36" x2="36" y2="42" />
  </svg>
);

const HipThrustIcon: IconComponent = ({ className }) => (
  <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="20" r="4" />
    <line x1="16" y1="20" x2="28" y2="16" />
    <line x1="28" y1="16" x2="36" y2="26" />
    <line x1="28" y1="16" x2="24" y2="26" />
    <line x1="12" y1="30" x2="12" y2="26" />
    <line x1="36" y1="26" x2="38" y2="32" />
  </svg>
);

const LegPressIcon: IconComponent = ({ className }) => (
  <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="16" cy="14" r="4" />
    <line x1="16" y1="18" x2="18" y2="30" />
    <line x1="18" y1="30" x2="32" y2="22" />
    <line x1="32" y1="22" x2="38" y2="30" />
    <line x1="16" y1="22" x2="10" y2="28" />
    <line x1="16" y1="22" x2="22" y2="26" />
  </svg>
);

const TricepsIcon: IconComponent = ({ className }) => (
  <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="18" cy="12" r="4" />
    <line x1="18" y1="16" x2="22" y2="28" />
    <line x1="22" y1="22" x2="36" y2="22" />
    <rect x="34" y="19" width="4" height="6" rx="1" />
    <line x1="22" y1="22" x2="12" y2="22" />
    <line x1="22" y1="28" x2="16" y2="40" />
    <line x1="22" y1="28" x2="28" y2="40" />
  </svg>
);

const FlyIcon: IconComponent = ({ className }) => (
  <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="24" cy="10" r="4" />
    <line x1="24" y1="14" x2="24" y2="30" />
    <line x1="24" y1="20" x2="10" y2="16" />
    <line x1="24" y1="20" x2="38" y2="16" />
    <rect x="6" y="14" width="5" height="4" rx="1" />
    <rect x="37" y="14" width="5" height="4" rx="1" />
    <line x1="24" y1="30" x2="18" y2="42" />
    <line x1="24" y1="30" x2="30" y2="42" />
  </svg>
);

export function getExerciseIcon(exerciseName: string): IconComponent {
  const name = exerciseName.toLowerCase();
  const n = exerciseName;

  if (n.includes("ベンチプレス") || n.includes("チェストプレス") || n.includes("ダンベルプレス") || n.includes("インクライン")) return BenchPressIcon;
  if (n.includes("フライ") || n.includes("ケーブルフライ")) return FlyIcon;

  if (n.includes("ラットプル") || n.includes("懸垂") || n.includes("チンニング")) return PulldownIcon;
  if (n.includes("ロー") || n.includes("シーテッド") || n.includes("ワンハンド") || n.includes("ベントオーバー")) return RowIcon;
  if (n.includes("デッドリフト")) return DeadliftIcon;

  if (n.includes("ショルダー") || n.includes("アーノルド") || n.includes("レイズ") || n.includes("サイドレイズ") || n.includes("フロントレイズ") || n.includes("リアレイズ")) return ShoulderIcon;

  if (n.includes("スクワット") || n.includes("スミス")) return SquatIcon;
  if (n.includes("レッグプレス") || n.includes("レッグエクステンション") || n.includes("レッグカール")) return LegPressIcon;
  if (n.includes("ランジ") || n.includes("ブルガリアン")) return LungeIcon;
  if (n.includes("ヒップ")) return HipThrustIcon;

  if (n.includes("カール") || n.includes("ハンマー")) return CurlIcon;
  if (n.includes("トライセプス") || n.includes("キックバック")) return TricepsIcon;

  if (n.includes("クランチ") || n.includes("プランク") || n.includes("レッグレイズ") || n.includes("アブ")) return CoreIcon;

  void name;
  return CurlIcon;
}
