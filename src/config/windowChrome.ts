/**
 * Native macOS traffic-light inset, in points.
 *
 * Tauri passes `trafficLightPosition` through as a logical position. Wry
 * converts it with the window backing scale, so these values are points on
 * Retina displays as well as on a 1× display.
 *
 * `inset_traffic_lights` in wry 0.57 does not treat `y` as the distance from
 * the top of the window. It sets the title-bar container height to
 * `buttonHeight + y` and then changes only each button's horizontal origin.
 * AppKit keeps the button's natural `origin.y`, which is the distance from
 * the bottom of that container to the bottom of the button. The top of the
 * close button therefore sits at `y - originY` points from the top of the
 * window. The left edge is `x`, because that origin is written directly.
 *
 * Apple's natural `origin.y` is about 5 pt on Sonoma and Sequoia and about
 * 7 pt on Tahoe. One configured `y` cannot hit both. Vidra uses the midpoint,
 * 6 pt, so the visible top margin is the chosen corner margin ±1 pt.
 *
 * On Tahoe the default title bar is already 32 pt tall with 14 pt buttons.
 * A `y` of 18 rebuilds that same 32 pt bar, so the buttons stay at the
 * system position. The `y` below is larger than 18, so the bar actually grows.
 */

/** Distance from the window edge to the close button's frame, in points. */
export const TRAFFIC_LIGHT_MARGIN = 16;

/** AppKit's natural button origin.y inside the title-bar container. */
export const TRAFFIC_LIGHT_ORIGIN_Y = {
  sonomaSequoia: 5,
  tahoe: 7,
} as const;

/** Midpoint of the two measured origins. */
export const TRAFFIC_LIGHT_ORIGIN_Y_MIDPOINT =
  (TRAFFIC_LIGHT_ORIGIN_Y.sonomaSequoia + TRAFFIC_LIGHT_ORIGIN_Y.tahoe) / 2;

/** Frame size of the standard window buttons on current macOS releases. */
export const TRAFFIC_LIGHT_BUTTON_SIZE = 14;

/** Tahoe's default title-bar height. A matching requested height does not move the buttons. */
export const TAHOE_DEFAULT_TITLEBAR_HEIGHT = 32;

/**
 * `trafficLightPosition` for wry. `x` is the left margin. `y` is not the top
 * margin; see the module comment.
 */
export function trafficLightPosition(margin = TRAFFIC_LIGHT_MARGIN): { x: number; y: number } {
  return {
    x: margin,
    y: margin + TRAFFIC_LIGHT_ORIGIN_Y_MIDPOINT,
  };
}

/** Distance from the top of the window to the top of the close button. */
export function trafficLightTopMargin(insetY: number, originY: number): number {
  return insetY - originY;
}

/** Title-bar container height wry creates from a y inset and the live button frame. */
export function trafficLightTitlebarHeight(insetY: number, buttonSize = TRAFFIC_LIGHT_BUTTON_SIZE): number {
  return buttonSize + insetY;
}
