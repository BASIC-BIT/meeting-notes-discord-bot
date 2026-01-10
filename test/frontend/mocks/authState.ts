export type MockAuthState = {
  state: "unknown" | "authenticated" | "unauthenticated";
  loginUrl: string;
  loading: boolean;
  refresh: () => Promise<void>;
  user?: {
    id?: string;
    username?: string;
    avatar?: string | null;
    isSuperAdmin?: boolean;
  } | null;
};

const defaultLoginUrl = "https://example.com/login";

export const authState: MockAuthState = {
  state: "unauthenticated",
  loginUrl: defaultLoginUrl,
  loading: false,
  refresh: async () => {},
  user: null,
};

export const resetAuthState = () => {
  authState.state = "unauthenticated";
  authState.loginUrl = defaultLoginUrl;
  authState.loading = false;
  authState.refresh = async () => {};
  authState.user = null;
};
