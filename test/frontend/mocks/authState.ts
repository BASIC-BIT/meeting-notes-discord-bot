export type MockAuthState = {
  state: "unknown" | "authenticated" | "unauthenticated";
  loginUrl: string;
  loading: boolean;
  refresh: () => Promise<void>;
};

const defaultLoginUrl = "https://example.com/login";

export const authState: MockAuthState = {
  state: "unauthenticated",
  loginUrl: defaultLoginUrl,
  loading: false,
  refresh: async () => {},
};

export const resetAuthState = () => {
  authState.state = "unauthenticated";
  authState.loginUrl = defaultLoginUrl;
  authState.loading = false;
  authState.refresh = async () => {};
};
