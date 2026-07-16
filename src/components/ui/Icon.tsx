import {
  ArrowRightLeft,
  ChevronDown,
  ChevronUp,
  FileVideo,
  FolderSearch,
  History,
  ListTodo,
  Music2,
  Pause,
  Play,
  Plus,
  Settings,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import type { View } from "../../types/media";

export type IconName = View | "plus" | "file" | "shield" | "audio" | "up" | "down" | "remove" | "pause" | "resume" | "reveal" | "delete" | "warning";

const icons: Record<IconName, LucideIcon> = {
  convert: ArrowRightLeft,
  queue: ListTodo,
  history: History,
  settings: Settings,
  plus: Plus,
  file: FileVideo,
  shield: ShieldCheck,
  audio: Music2,
  up: ChevronUp,
  down: ChevronDown,
  remove: X,
  pause: Pause,
  resume: Play,
  reveal: FolderSearch,
  delete: Trash2,
  warning: TriangleAlert,
};

export function Icon({ name }: { name: IconName }) {
  const LucideIcon = icons[name];

  return <LucideIcon aria-hidden="true" size={18} strokeWidth={1.8} />;
}
