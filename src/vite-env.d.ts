/// <reference types="vite/client" />

/** Application version injected at build time from package.json. */
declare const __VIDRA_VERSION__: string | undefined;

/** True only in a build made by the release workflow. Other builds do not check for updates at startup. */
declare const __VIDRA_OFFICIAL_BUILD__: boolean;
