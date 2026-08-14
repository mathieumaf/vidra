/// <reference types="vite/client" />

/** Application version injected at build time from package.json. */
declare const __VIDRA_VERSION__: string | undefined;

/** Exact GitHub tag injected by the release workflow, including any prerelease suffix. */
declare const __VIDRA_RELEASE_TAG__: string | null;
