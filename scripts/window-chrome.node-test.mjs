import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chrome = readFileSync(new URL("../src/config/windowChrome.ts", import.meta.url), "utf8");
const tokens = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
const shell = readFileSync(new URL("../src/styles/shell.css", import.meta.url), "utf8");
const failure = readFileSync(new URL("../src/styles/failure.css", import.meta.url), "utf8");

function constant(name) {
  const match = chrome.match(new RegExp(`export const ${name} = (\\d+);`));
  assert.ok(match, `${name} is exported as an integer from windowChrome.ts`);
  return Number(match[1]);
}

test("the header band CSS uses the shared window chrome constants", () => {
  const headerBandHeight = constant("HEADER_BAND_HEIGHT");
  const trafficLightInsetX = constant("TRAFFIC_LIGHT_INSET_X");
  const sidebarInlinePadding = constant("SIDEBAR_INLINE_PADDING");
  const trafficLightGroupWidth = constant("TRAFFIC_LIGHT_ORIGIN_SPACING")
    * (constant("TRAFFIC_LIGHT_BUTTON_COUNT") - 1)
    + constant("TRAFFIC_LIGHT_BUTTON_SIZE");
  const sidebarHeaderContentInset = trafficLightInsetX + trafficLightGroupWidth + constant("SIDEBAR_HEADER_GAP");

  assert.match(
    chrome,
    /export const SIDEBAR_HEADER_CONTENT_INSET =\n {2}TRAFFIC_LIGHT_INSET_X \+ TRAFFIC_LIGHT_GROUP_WIDTH \+ SIDEBAR_HEADER_GAP;/,
  );

  assert.match(tokens, new RegExp(`--header-band-height: ${headerBandHeight}px;`));
  assert.match(tokens, new RegExp(`--traffic-light-inset-x: ${trafficLightInsetX}px;`));
  assert.match(tokens, new RegExp(`--sidebar-inline-padding: ${sidebarInlinePadding}px;`));
  assert.match(tokens, new RegExp(`--sidebar-header-content-inset: ${sidebarHeaderContentInset}px;`));
  assert.match(shell, /height: var\(--header-band-height\)/);
  assert.match(shell, /padding-left: var\(--sidebar-header-content-inset\)/);
  assert.match(shell, /grid-template-rows: var\(--header-band-height\)/);
  assert.match(failure, /grid-template-rows: var\(--header-band-height\)/);
});
