import {
  ArrowRightLeft,
  FileVideo,
  History,
  ListTodo,
  Plus,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import type { View } from "../../types/media";

export type IconName = View | "plus" | "file" | "shield";

const icons: Record<IconName, LucideIcon> = {
  convert: ArrowRightLeft,
  queue: ListTodo,
  history: History,
  settings: Settings,
  plus: Plus,
  file: FileVideo,
  shield: ShieldCheck,
};

export function Icon({ name }: { name: IconName }) {
  const LucideIcon = icons[name];

  return <LucideIcon aria-hidden="true" size={18} strokeWidth={1.8} />;
}
