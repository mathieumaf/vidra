import { Icon, type IconName } from "../ui/Icon";

type EmptyStateProps = {
  icon: IconName;
  title: string;
  copy: string;
  action: () => void;
};

export function EmptyState({ icon, title, copy, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="utility-icon"><Icon name={icon} /></div>
      <h2>{title}</h2>
      <p>{copy}</p>
      <button className="secondary-button" type="button" onClick={action}>Go to Convert</button>
    </div>
  );
}
