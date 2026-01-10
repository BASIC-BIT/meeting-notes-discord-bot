import type session from "express-session";

export type SessionWithOauthRedirect = Partial<session.Session> & {
  oauthRedirect?: string;
};

export type RequestWithOauthRedirect = {
  session?: SessionWithOauthRedirect;
  oauthRedirect?: string;
};

export const stashOauthRedirectFromSession = (
  req: RequestWithOauthRedirect,
): string | undefined => {
  const stored = req.session?.oauthRedirect;
  if (!stored) return undefined;
  delete req.session?.oauthRedirect;
  req.oauthRedirect = stored;
  return stored;
};

export const readOauthRedirectFromRequest = (
  req: RequestWithOauthRedirect,
): string | undefined => req.oauthRedirect;
