/**
 * macOS window chrome shared by the native traffic lights and the sidebar header.
 *
 * Values are in points. Tauri passes `trafficLightPosition` as a logical
 * position, and wry converts it with the window's backing scale, so a Retina
 * display does not need a 2× multiplier. In the macOS web view, one CSS pixel
 * is one point, which is why the same numbers are written into `tokens.css`.
 *
 * Tauri 2.12 (wry 0.57 and tao 0.37) applies the position in
 * `inset_traffic_lights`. That sets the title-bar container height to
 * `buttonHeight + y` and changes each button's horizontal origin. It leaves
 * the button's vertical origin alone. AppKit's natural `origin.y` is the
 * distance from the bottom of that container to the bottom of the button, so
 * the top of the close button lands at `y - originY` points from the top of
 * the window.
 *
 * Apple changed that rest position when the title bar grew:
 * - macOS Sonoma and Sequoia: origin about 5 pt, shorter than a 32 pt bar
 * - macOS Tahoe (26): origin about 7 pt, and the default title bar is already
 *   32 pt with 14 pt buttons. A y value that only rebuilds that 32 pt bar
 *   (button height 14 + y 18) does not move the controls.
 *
 * The inset below uses the midpoint of those two origins. The buttons then
 * sit within 1 pt of the header band's center on either release, and the
 * title-bar container is taller than Tahoe's 32 pt default so the inset
 * applies there too.
 */

/** Height of the shared top band, in points. Matches a full-size macOS toolbar. */
export const HEADER_BAND_HEIGHT = 52;

/** Left edge of the close button, in points from the window's top-left. */
export const TRAFFIC_LIGHT_INSET_X = 20;

/** Horizontal padding inside the sidebar column, in points. */
export const SIDEBAR_INLINE_PADDING = 12;

/** Frame size of the circular close, minimize, and zoom buttons. */
export const TRAFFIC_LIGHT_BUTTON_SIZE = 14;

/** How many standard window buttons macOS shows. */
export const TRAFFIC_LIGHT_BUTTON_COUNT = 3;

/**
 * Distance between button origins. wry keeps AppKit's current spacing when
 * it shifts the group; on macOS 11 and later that pitch is 20 pt.
 */
export const TRAFFIC_LIGHT_ORIGIN_SPACING = 20;

/** Open space between the zoom button and the sidebar logo. */
export const SIDEBAR_HEADER_GAP = 16;

export const TRAFFIC_LIGHT_GROUP_WIDTH =
  TRAFFIC_LIGHT_ORIGIN_SPACING * (TRAFFIC_LIGHT_BUTTON_COUNT - 1) + TRAFFIC_LIGHT_BUTTON_SIZE;

/** Left edge of the logo, clear of the zoom button. */
export const SIDEBAR_HEADER_CONTENT_INSET =
  TRAFFIC_LIGHT_INSET_X + TRAFFIC_LIGHT_GROUP_WIDTH + SIDEBAR_HEADER_GAP;

/** AppKit's natural button origin.y before the title bar is resized. */
export const TRAFFIC_LIGHT_ORIGIN_Y = {
  sonomaSequoia: 5,
  tahoe: 7,
} as const;

/** Tahoe's default title-bar container. A shorter requested bar is a no-op. */
export const TAHOE_DEFAULT_TITLEBAR_HEIGHT = 32;

const TRAFFIC_LIGHT_ORIGIN_Y_COMPROMISE =
  (TRAFFIC_LIGHT_ORIGIN_Y.sonomaSequoia + TRAFFIC_LIGHT_ORIGIN_Y.tahoe) / 2;

/**
 * `trafficLightPosition.y` for wry and tao.
 * This is not the button's top coordinate. See the module comment.
 */
export function trafficLightInsetY(
  headerBandHeight = HEADER_BAND_HEIGHT,
  buttonSize = TRAFFIC_LIGHT_BUTTON_SIZE,
  originY = TRAFFIC_LIGHT_ORIGIN_Y_COMPROMISE,
): number {
  return (headerBandHeight - buttonSize) / 2 + originY;
}

/** Distance from the top of the window to the center of the close button. */
export function trafficLightCenterFromTop(
  insetY: number,
  originY: number,
  buttonSize = TRAFFIC_LIGHT_BUTTON_SIZE,
): number {
  return insetY - originY + buttonSize / 2;
}

/** Title-bar container height wry creates from a y inset. */
export function trafficLightTitlebarHeight(
  insetY: number,
  buttonSize = TRAFFIC_LIGHT_BUTTON_SIZE,
): number {
  return buttonSize + insetY;
}

export const TRAFFIC_LIGHT_POSITION = {
  x: TRAFFIC_LIGHT_INSET_X,
  y: trafficLightInsetY(),
} as const;
