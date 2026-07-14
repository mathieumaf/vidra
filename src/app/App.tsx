import { useEffect, useState } from "react";
import { ConvertView } from "../components/convert/ConvertView";
import { DragRegion } from "../components/layout/DragRegion";
import { Sidebar } from "../components/layout/Sidebar";
import { Toolbar } from "../components/layout/Toolbar";
import { Icon } from "../components/ui/Icon";
import { HistoryView } from "../components/views/HistoryView";
import { QueueView } from "../components/views/QueueView";
import { SettingsView } from "../components/views/SettingsView";
import { QUALITY_LEVELS } from "../config/quality";
import { canCopyAudioToMp4, canCopyVideoToMp4 } from "../config/encoding";
import {
  advancedSettings as getAdvancedSettings,
  DEFAULT_ADVANCED_SETTINGS,
  usesAdvancedSettings,
  type AdvancedEncodingSettings,
} from "../config/advanced";
import {
  compatibleProfileSettings,
  encodingSettingsEqual,
} from "../config/profiles";
import { useEncodingQueue } from "../hooks/useEncodingQueue";
import { useConversionHistory } from "../hooks/useConversionHistory";
import { useEncodingProfiles } from "../hooks/useEncodingProfiles";
import { useFfmpegStatus } from "../hooks/useFfmpegStatus";
import type {
  AudioMode,
  EncodeQueueItem,
  EncodingSettings,
  EncodingSpeed,
  OutputContainer,
  OutputResolution,
  VideoCodec,
  View,
} from "../types/media";
import { viewMeta } from "./viewMeta";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/shell.css";
import "../styles/conversion.css";
import "../styles/views.css";

export default function App() {
  const [view, setView] = useState<View>("convert");
  const [qualityIndex, setQualityIndex] = useState(2);
  const [outputContainer, setOutputContainer] = useState<OutputContainer>("mp4");
  const [videoCodec, setVideoCodec] = useState<VideoCodec>("h264");
  const [encodingSpeed, setEncodingSpeed] = useState<EncodingSpeed>("efficient");
  const [audioMode, setAudioMode] = useState<AudioMode>("auto");
  const [outputResolution, setOutputResolution] = useState<OutputResolution>("source");
  const [isAdvancedMode, setIsAdvancedMode] = useState(false);
  const [advancedSettings, setAdvancedSettings] = useState<AdvancedEncodingSettings>(
    DEFAULT_ADVANCED_SETTINGS,
  );
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>("built-in-balanced");
  const { status, isReady } = useFfmpegStatus();
  const profileStore = useEncodingProfiles();
  const quality = QUALITY_LEVELS[qualityIndex];
  const queue = useEncodingQueue({
    isReady,
    quality,
    outputContainer,
    videoCodec,
    encodingSpeed,
    audioMode,
    outputResolution,
    advancedSettings,
  });
  const history = useConversionHistory();
  const [title, subtitle] = viewMeta(view, queue.items, history.items.length);

  useEffect(() => {
    const item = queue.primaryItem;
    if (!item || item.status !== "ready") return;
    const index = QUALITY_LEVELS.findIndex((level) => level.id === item.settings.quality);
    setQualityIndex(index >= 0 ? index : 2);
    setOutputContainer(item.settings.container);
    setVideoCodec(item.settings.videoCodec);
    setEncodingSpeed(item.settings.encodingSpeed);
    setAudioMode(item.settings.audioMode);
    setOutputResolution(item.settings.outputResolution);
    setAdvancedSettings(getAdvancedSettings(item.settings));
    const preferredProfile = profileStore.profiles.find((profile) => (
      profile.id === selectedProfileId
      && encodingSettingsEqual(
        compatibleProfileSettings(profile.settings, item.media),
        item.settings,
      )
    ));
    const matchedProfile = preferredProfile ?? profileStore.profiles.find((profile) => (
      encodingSettingsEqual(
        compatibleProfileSettings(profile.settings, item.media),
        item.settings,
      )
    ));
    setSelectedProfileId(matchedProfile?.id ?? null);
    setIsAdvancedMode(matchedProfile?.isAdvanced ?? usesAdvancedSettings(item.settings));
  }, [queue.primaryItem?.clientId]);

  async function addVideos(preferredView: View) {
    const added = await queue.selectVideos();
    if (added > 0) setView(preferredView);
  }

  async function startEncoding() {
    const queued = await queue.startEncoding();
    if (queued > 1 || queue.hasActiveJobs) setView("queue");
  }

  async function newConversion() {
    const hasOpenItems = queue.items.some((item) => (
      item.status === "ready" || item.status === "queued" || item.status === "encoding" || item.status === "paused"
    ));
    if (!hasOpenItems) queue.reset();
    await addVideos("convert");
  }

  function commitSettings(settings: EncodingSettings) {
    const index = QUALITY_LEVELS.findIndex((level) => level.id === settings.quality);
    setQualityIndex(index >= 0 ? index : 2);
    setOutputContainer(settings.container);
    setVideoCodec(settings.videoCodec);
    setEncodingSpeed(settings.encodingSpeed);
    setAudioMode(settings.audioMode);
    setOutputResolution(settings.outputResolution);
    setAdvancedSettings(getAdvancedSettings(settings));
    if (queue.primaryItem?.status === "ready") {
      queue.updateItemSettings(queue.primaryItem, settings);
    }
    queue.setError(null);
  }

  function currentSettings(): EncodingSettings {
    return {
      quality: quality.id,
      container: outputContainer,
      videoCodec,
      encodingSpeed,
      audioMode,
      outputResolution,
      ...advancedSettings,
    };
  }

  function changeOutputContainer(container: OutputContainer) {
    const media = queue.primaryItem?.media;
    const incompatibleVideoCopy = videoCodec === "copy"
      && container === "mp4"
      && !canCopyVideoToMp4(media?.video ?? null);
    const incompatibleAudioCopy = audioMode === "copy"
      && container === "mp4"
      && !canCopyAudioToMp4(media?.audio ?? []);
    commitSettings({
      ...currentSettings(),
      container,
      videoCodec: videoCodec === "av1" || incompatibleVideoCopy ? "h264" : videoCodec,
      encodingSpeed: videoCodec === "av1" || incompatibleVideoCopy ? "efficient" : encodingSpeed,
      audioMode: audioMode === "opus" || incompatibleAudioCopy ? "auto" : audioMode,
    });
  }

  function changeVideoCodec(codec: VideoCodec) {
    const needsMkv = codec === "av1"
      || (codec === "copy" && !canCopyVideoToMp4(queue.primaryItem?.media.video ?? null));
    commitSettings({
      ...currentSettings(),
      container: needsMkv ? "mkv" : outputContainer,
      videoCodec: codec,
      encodingSpeed: codec === "copy" || codec === "av1" ? "efficient" : encodingSpeed,
      outputResolution: codec === "copy" ? "source" : outputResolution,
      outputFrameRate: codec === "copy" ? "source" : advancedSettings.outputFrameRate,
      qualityTuning: codec === "copy" ? 0 : advancedSettings.qualityTuning,
    });
  }

  function changeEncodingSpeed(speed: EncodingSpeed) {
    commitSettings({ ...currentSettings(), encodingSpeed: speed });
  }

  function changeAudioMode(mode: AudioMode) {
    const needsMkv = mode === "opus"
      || (mode === "copy" && !canCopyAudioToMp4(queue.primaryItem?.media.audio ?? []));
    commitSettings({
      ...currentSettings(),
      container: needsMkv ? "mkv" : outputContainer,
      audioMode: mode,
      audioBitrate: mode === "copy" || mode === "auto" ? "auto" : advancedSettings.audioBitrate,
      audioChannels: mode === "copy" || mode === "auto" ? "source" : advancedSettings.audioChannels,
    });
  }

  function changeOutputResolution(resolution: OutputResolution) {
    commitSettings({
      ...currentSettings(),
      videoCodec: resolution !== "source" && videoCodec === "copy" ? "h264" : videoCodec,
      encodingSpeed: resolution !== "source" && videoCodec === "copy" ? "efficient" : encodingSpeed,
      outputResolution: resolution,
    });
  }

  function changeAdvancedSettings(patch: Partial<AdvancedEncodingSettings>) {
    const next = { ...advancedSettings, ...patch };
    const changesVideoTiming = next.outputFrameRate !== "source";
    const changesAudio = next.audioBitrate !== "auto" || next.audioChannels !== "source";
    commitSettings({
      ...currentSettings(),
      ...next,
      videoCodec: changesVideoTiming && videoCodec === "copy" ? "h264" : videoCodec,
      encodingSpeed: changesVideoTiming && videoCodec === "copy" ? "efficient" : encodingSpeed,
      audioMode: changesAudio && (audioMode === "auto" || audioMode === "copy")
        ? "aac"
        : audioMode,
    });
  }

  function changeQuality(qualityIndex: number) {
    commitSettings({
      ...currentSettings(),
      quality: QUALITY_LEVELS[qualityIndex].id,
    });
  }

  function selectProfile(profileId: string | null) {
    if (!profileId) {
      setSelectedProfileId(null);
      return;
    }
    const profile = profileStore.profiles.find((candidate) => candidate.id === profileId);
    if (!profile) return;
    commitSettings(compatibleProfileSettings(profile.settings, queue.primaryItem?.media ?? null));
    setIsAdvancedMode(profile.isAdvanced);
    setSelectedProfileId(profile.id);
  }

  function createProfile(name: string) {
    const id = profileStore.createProfile(name, currentSettings(), isAdvancedMode);
    setSelectedProfileId(id);
  }

  function updateSelectedProfile() {
    if (!selectedProfileId) return;
    profileStore.updateProfile(selectedProfileId, currentSettings(), isAdvancedMode);
  }

  function renameSelectedProfile(name: string) {
    if (!selectedProfileId) return;
    profileStore.renameProfile(selectedProfileId, name);
  }

  function deleteSelectedProfile() {
    if (!selectedProfileId) return;
    profileStore.deleteProfile(selectedProfileId);
    setSelectedProfileId(null);
  }

  function deleteProfile(profileId: string) {
    profileStore.deleteProfile(profileId);
    if (selectedProfileId === profileId) setSelectedProfileId(null);
  }

  function editItem(item: EncodeQueueItem) {
    queue.selectItem(item);
    const index = QUALITY_LEVELS.findIndex((quality) => quality.id === item.settings.quality);
    setQualityIndex(index >= 0 ? index : 2);
    setOutputContainer(item.settings.container);
    setVideoCodec(item.settings.videoCodec);
    setEncodingSpeed(item.settings.encodingSpeed);
    setAudioMode(item.settings.audioMode);
    setOutputResolution(item.settings.outputResolution);
    setAdvancedSettings(getAdvancedSettings(item.settings));
    setView("convert");
  }

  const primaryItem = queue.primaryItem;
  const isPrimaryActive = primaryItem?.status === "encoding" || primaryItem?.status === "paused";
  const canEditPrimary = primaryItem?.status === "ready";
  const selectedProfile = profileStore.profiles.find((profile) => profile.id === selectedProfileId) ?? null;
  const isProfileModified = selectedProfile !== null && (
    selectedProfile.isAdvanced !== isAdvancedMode
    || !encodingSettingsEqual(
      compatibleProfileSettings(selectedProfile.settings, primaryItem?.media ?? null),
      currentSettings(),
    )
  );

  return (
    <div className={`desktop-shell${queue.isDraggingFiles ? " dragging-files" : ""}`}>
      <Sidebar
        view={view}
        status={status}
        isReady={isReady}
        queueCount={queue.queueCount}
        onViewChange={setView}
        onNewConversion={() => void newConversion()}
      />

      <section className="main-panel">
        <DragRegion className="native-titlebar" />
        <Toolbar
          view={view}
          title={title}
          subtitle={subtitle}
          hasMedia={queue.items.length > 0}
          isEncoding={queue.hasActiveJobs}
          onAddSources={() => void addVideos("convert")}
        />

        <div className="content-area">
          {view === "convert" && (
            <ConvertView
              media={primaryItem?.media ?? null}
              mediaCount={canEditPrimary ? queue.readyItems.length : 1}
              status={status}
              qualityIndex={qualityIndex}
              outputContainer={outputContainer}
              videoCodec={videoCodec}
              encodingSpeed={encodingSpeed}
              audioMode={audioMode}
              outputResolution={outputResolution}
              isAdvancedMode={isAdvancedMode}
              advancedSettings={advancedSettings}
              profiles={profileStore.profiles}
              selectedProfileId={selectedProfileId}
              isProfileModified={isProfileModified}
              isReady={isReady}
              isProbing={queue.isProbing}
              isActive={isPrimaryActive}
              canEdit={canEditPrimary}
              canResume={!queue.encodingItem && queue.queueControlItem?.clientId === primaryItem?.clientId}
              isPaused={primaryItem?.status === "paused"}
              progress={queue.currentProgress}
              result={primaryItem?.jobId === queue.result?.jobId ? queue.result : null}
              error={queue.error}
              onSelectVideo={() => void addVideos("convert")}
              onQualityChange={changeQuality}
              onOutputContainerChange={changeOutputContainer}
              onVideoCodecChange={changeVideoCodec}
              onEncodingSpeedChange={changeEncodingSpeed}
              onAudioModeChange={changeAudioMode}
              onOutputResolutionChange={changeOutputResolution}
              onAdvancedModeChange={setIsAdvancedMode}
              onAdvancedSettingsChange={changeAdvancedSettings}
              onProfileSelect={selectProfile}
              onProfileCreate={createProfile}
              onProfileUpdate={updateSelectedProfile}
              onProfileRename={renameSelectedProfile}
              onProfileDelete={deleteSelectedProfile}
              onStartEncoding={() => void startEncoding()}
              onTogglePause={() => primaryItem && void queue.togglePause(primaryItem)}
              onCancelEncoding={() => primaryItem && void queue.removeOrCancel(primaryItem)}
            />
          )}
          {view === "queue" && (
            <QueueView
              items={queue.items}
              isReady={isReady}
              isProbing={queue.isProbing}
              error={queue.error}
              controlItem={queue.queueControlItem}
              onAddVideos={() => void addVideos("queue")}
              onStart={() => void startEncoding()}
              onRevealOutput={queue.revealOutput}
              onRemoveOrCancel={queue.removeOrCancel}
              onToggleQueue={queue.toggleQueue}
              onMove={queue.moveItem}
              onEdit={editItem}
              onGoToConvert={() => setView("convert")}
            />
          )}
          {view === "history" && (
            <HistoryView
              items={history.items}
              isLoading={history.isLoading}
              error={history.error}
              onGoToConvert={() => setView("convert")}
              onReveal={history.reveal}
              onDelete={history.remove}
              onClear={history.clear}
            />
          )}
          {view === "settings" && (
            <SettingsView
              status={status}
              isReady={isReady}
              profiles={profileStore.profiles}
              onDuplicateProfile={(profileId) => { profileStore.duplicateProfile(profileId); }}
              onRenameProfile={profileStore.renameProfile}
              onDeleteProfile={deleteProfile}
            />
          )}
        </div>
      </section>

      {queue.isDraggingFiles && (
        <div className="file-drop-overlay" aria-hidden="true">
          <div><Icon name="plus" /><strong>Add videos to the batch</strong></div>
        </div>
      )}
    </div>
  );
}
