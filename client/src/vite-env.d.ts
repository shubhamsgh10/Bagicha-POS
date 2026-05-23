/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_PUSHER_KEY?: string;
  readonly VITE_PUSHER_CLUSTER?: string;
  readonly VITE_PUSHER_CHANNEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
