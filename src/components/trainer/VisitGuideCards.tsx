import ArrivalLeadCard from "./ArrivalLeadCard";
import PreVisitNoteCard from "./PreVisitNoteCard";

/**
 * 予約のルールに置く「来店の案内」2枚: 来店の目安時刻（2026-10-10）とご来店前のお願い（2026-10-27）。
 *
 * TrainerGymSettings.tsx は行数の上限（`qualityRatchet.test.ts`・1600）に達しているので、
 * カードを足すときはここに足す（あちらは1行のまま）。
 */
const VisitGuideCards = () => (
  <>
    <ArrivalLeadCard />
    <PreVisitNoteCard />
  </>
);

export default VisitGuideCards;
