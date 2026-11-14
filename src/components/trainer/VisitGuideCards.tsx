import ArrivalLeadCard from "./ArrivalLeadCard";
import PreVisitNoteCard from "./PreVisitNoteCard";
import BookingPageNoteCard from "./BookingPageNoteCard";

/**
 * 予約のルールに置く「来店の案内」3枚: 来店の目安時刻（2026-10-10）・ご来店前のお願い（2026-10-27）・
 * 予約画面のご案内（2026-11-14）。
 *
 * TrainerGymSettings.tsx は行数の上限（`qualityRatchet.test.ts`・1600）に達しているので、
 * カードを足すときはここに足す（あちらは1行のまま）。
 */
const VisitGuideCards = () => (
  <>
    <ArrivalLeadCard />
    <PreVisitNoteCard />
    <BookingPageNoteCard />
  </>
);

export default VisitGuideCards;
