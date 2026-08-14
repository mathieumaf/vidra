import type { AvailableApplicationUpdate } from "../../services/updates";
import { Icon } from "../ui/Icon";

type UpdateAvailableNoticeProps = {
  update: AvailableApplicationUpdate;
  onDismiss: () => void;
  onViewUpdate: () => void;
};

export function UpdateAvailableNotice({
  update,
  onDismiss,
  onViewUpdate,
}: UpdateAvailableNoticeProps) {
  return (
    <aside className="update-available-notice" role="status">
      <div className="update-notice-mark"><Icon name="download" /></div>
      <div>
        <strong>Vidra {update.version} is available</strong>
        <p>Review the update and install it when the conversion queue is empty.</p>
        <button type="button" onClick={onViewUpdate}>View update</button>
      </div>
      <button
        aria-label="Dismiss update notification"
        className="update-notice-dismiss"
        type="button"
        onClick={onDismiss}
      >
        <Icon name="remove" />
      </button>
    </aside>
  );
}
