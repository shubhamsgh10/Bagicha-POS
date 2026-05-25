/// <reference types="vite/client" />

/** Set in vite.config from VITE_API_BASE_URL in repo-root .env */
declare const __BAGICHA_API_BASE_URL__: string;

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_PUSHER_KEY?: string;
  readonly VITE_PUSHER_CLUSTER?: string;
  readonly VITE_PUSHER_CHANNEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
