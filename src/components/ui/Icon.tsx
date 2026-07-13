import {
  ArrowRightLeft,
  ChevronDown,
  ChevronUp,
  FileVideo,
  History,
  ListTodo,
  Pause,
  Play,
  Plus,
  Settings,
  ShieldCheck,
  X,
  type LucideIcon,
} from "lucide-react";
import type { View } from "../../types/media";

export type IconName = View | "plus" | "file" | "shield" | "up" | "down" | "remove" | "pause" | "resume";

const icons: Record<IconName, LucideIcon> = {
  convert: ArrowRightLeft,
  queue: ListTodo,
  history: History,
  settings: Settings,
  plus: Plus,
  file: FileVideo,
  shield: ShieldCheck,
  up: ChevronUp,
  down: ChevronDown,
  remove: X,
  pause: Pause,
  resume: Play,
};

export function Icon({ name }: { name: IconName }) {
  const LucideIcon = icons[name];

  return <LucideIcon aria-hidden="true" size={18} strokeWidth={1.8} />;
}
