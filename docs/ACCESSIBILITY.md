# Accessibility

Vidra is meant to be usable from the keyboard alone and understandable with macOS VoiceOver. The interface keeps the native desktop layout: the window does not scroll as a document, and custom controls are used for quality, resolution, and appearance.

## What is supported

- **Keyboard workflow.** Add videos with Choose videos, Add videos, or New conversion. Change format, codec, quality, resolution, audio, and profiles from the keyboard. Start, pause, cancel, reorder, and remove queue items with their buttons. Browse history, settings, notices, and update prompts the same way. Dragging files onto the window is optional; the same actions are buttons.
- **Focus.** A skip link moves to the current view. Focus rings use the `--focus-ring` token and stay visible in light appearance, dark appearance, and forced colors. Dialogs keep focus inside, close with Escape, and return focus to the control that opened them. The background is marked inert while a dialog is open.
- **Names and values.** Icon-only actions have accessible names. Segmented choices are radio groups: arrow keys, Home, and End move the selection, and only the selected option is in the tab order. Sliders expose the current quality in text, not only a number. Disabled choices include the reason they are unavailable.
- **Status.** Encoding start, pause, resume, and progress at each quarter are announced, as are queue additions, removals, and status changes. Errors and blocking color warnings use an alert. Field errors for a profile name are tied to that field with `aria-invalid` and `aria-describedby`.
- **Appearance.** Secondary text and accent-button labels meet WCAG 2.2 contrast in the light and dark tokens. `prefers-reduced-motion: reduce` removes CSS animation and transitions, including the indeterminate progress animation.

Window dragging on the title bar is a system pointer action. Move the window with macOS window controls. Choosing files and confirming Clear history use the system dialogs.

## Manual VoiceOver checklist

These checks need macOS VoiceOver in the Vidra window. Turn VoiceOver on with Command-F5, then walk this list with the VoiceOver cursor and with Tab.

1. From the empty Convert screen, Tab to Choose videos, activate it, and confirm the system file dialog is announced. Cancel it, then drop a file with the pointer and confirm the drop overlay does not trap the VoiceOver cursor.
2. With a video selected, move through Simple and Advanced, the profile menu, format, codec, quality slider, resolution, and audio. Each radio group should speak its name, the selected choice, and the position in the group. Arrow keys should change the selection. The quality slider should speak the preset name, such as Balanced, rather than only a number from 0 to 4.
3. Open Save as profile, leave the name empty, and leave the field. VoiceOver should announce the profile-name error. Escape should close the editor and return to the control that opened it.
4. Start a conversion. VoiceOver should announce that encoding started, then paused, resumed, and roughly quarter progress, without speaking every percent tick. Completion, cancellation, and failure should be announced. The progress bar itself should speak percent when focused.
5. In the queue, reorder with Move up and Move down, and confirm each icon button’s name includes the file name. Status changes for a row should be announced.
6. Open Settings. Change appearance with the arrow keys. Open Third-party notices, scroll the notice list from the keyboard, close it with Escape, and confirm focus returns to View notices.
7. Trigger the restore-queue dialog if a previous queue was left unfinished. Focus should start on Restore queue, Tab should stay inside the dialog, and Escape should choose Start fresh.
8. Switch macOS between light and dark appearance, and turn on Reduce motion. Focus rings should remain visible, accent buttons should keep readable labels, and the indeterminate progress bar should not travel.
9. Open the failure panel by forcing a view error if you have a debug build, and confirm focus lands on Try again and the alert is announced.

## Not verified in this change

This change was checked with Vitest and jsdom, including focus movement, dialog trapping, names, and contrast math for the tokens. It was not run in the Tauri web view with VoiceOver. In particular, confirm on a Mac:

- VoiceOver speech and the rotor for buttons, radio groups, sliders, and live regions inside the WKWebView, which can differ from Safari or Chrome.
- The system open, save, and confirmation dialogs.
- Focus rings and contrast under the real macOS light and dark appearance, including Increase contrast.
- Reduced motion from System Settings, not only the CSS media query.
- The title-bar drag region, which is pointer-only by design.

The completed check mark on a success message is a symbol next to the text “Encoding complete”. Its white-on-green contrast is about 3:1. The text label carries the meaning. Queue and history status marks are hidden from VoiceOver because the text label is announced.
