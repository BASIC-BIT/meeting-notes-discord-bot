import type { Request, Response } from "express";
import type { Profile } from "passport-discord";

export type AuthedProfile = Profile & { accessToken?: string };

export type TrpcContext = {
  req: Request;
  res: Response;
  user: AuthedProfile | null;
};

export function createContext({
  req,
  res,
}: {
  req: Request;
  res: Response;
}): TrpcContext {
  const user =
    typeof req.isAuthenticated === "function" && req.isAuthenticated()
      ? (req.user as AuthedProfile)
      : null;
  return { req, res, user };
}
