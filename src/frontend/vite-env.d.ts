/// <reference types="vite/client" />

interface Navigator {
  userAgentData?: {
    mobile?: boolean;
  };
}

interface ImportMetaEnv {
  readonly VITE_MOCK_FIXED_NOW?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
