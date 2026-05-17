import RPGEngine from "./RPGEngine";
import { rivelVillage } from "./maps/rivelVillage";

interface Props {
  onBack: () => void;
}

const LuminasChronicle = ({ onBack }: Props) => {
  return <RPGEngine map={rivelVillage} onExit={onBack} />;
};

export default LuminasChronicle;