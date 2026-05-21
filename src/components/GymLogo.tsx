import { useTenant } from "@/hooks/useTenant";

interface GymLogoProps {
  size?: "sm" | "lg";
}

const GymLogo = ({ size = "sm" }: GymLogoProps) => {
  const { tenant, loading } = useTenant();
  const dim = size === "lg" ? "w-24 h-24" : "w-8 h-8";

  if (loading) {
    return <div className={`${dim} rounded bg-muted animate-pulse`} />;
  }

  if (tenant?.logo_url) {
    return (
      <img
        src={tenant.logo_url}
        alt="ジムロゴ"
        className={`${dim} rounded object-contain`}
      />
    );
  }

  return (
    <div className={`${dim} rounded bg-muted flex items-center justify-center text-[8px] text-muted-foreground`}>
      LOGO
    </div>
  );
};

export default GymLogo;
