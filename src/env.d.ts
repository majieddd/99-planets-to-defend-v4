/// <reference types="vite/client" />

/** Short git SHA of the build, injected by vite.config.ts. */
declare const __BUILD_SHA__: string;

/** Whether public/assets/manifest.json existed when vite.config.ts loaded, injected by vite.config.ts. */
declare const __HAS_ASSET_MANIFEST__: boolean;

/** Debug handle that pages expose for browser tests and the agent. */
interface P99Debug {
  ready: boolean;
  page: string;
  [key: string]: unknown;
}

interface Window {
  __P99__?: P99Debug;
}
