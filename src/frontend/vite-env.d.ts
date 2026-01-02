/// <reference types="vite/client" />

interface Navigator {
  userAgentData?: {
    mobile?: boolean;
  };
}

interface ImportMetaEnv {
  readonly VITE_MOCK_FIXED_NOW?: string;
  readonly VITE_VISUAL_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
