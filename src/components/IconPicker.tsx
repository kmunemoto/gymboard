import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ICON_REGISTRY, PICKER_ICON_NAMES, getIconComponent, resolveIconName } from "@/lib/iconRegistry";
import { ChevronDown } from "lucide-react";

interface Props {
  value: string | null | undefined;
  onChange: (name: string) => void;
  className?: string;
}

const IconPicker = ({ value, onChange, className }: Props) => {
  const [open, setOpen] = useState(false);
  const current = resolveIconName(value);
  const CurrentIcon = getIconComponent(current);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className={`justify-between gap-2 ${className || ""}`}>
          <span className="flex items-center gap-2">
            <CurrentIcon className="w-4 h-4" />
            <span className="text-xs">{current}</span>
          </span>
          <ChevronDown className="w-3.5 h-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2">
        <div className="grid grid-cols-6 gap-1">
          {PICKER_ICON_NAMES.map((name) => {
            const Icon = ICON_REGISTRY[name];
            const selected = name === current;
            return (
              <button
                key={name}
                type="button"
                title={name}
                onClick={() => { onChange(name); setOpen(false); }}
                className={`aspect-square rounded-md flex items-center justify-center transition-colors ${
                  selected ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                }`}
              >
                <Icon className="w-4 h-4" />
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default IconPicker;