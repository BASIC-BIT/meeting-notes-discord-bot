import type { Request, Response } from "express";
import type { Profile } from "passport-discord";
import { config } from "../services/configService";
import { getMockUser } from "../repositories/mockStore";

export type AuthedProfile = Profile & {
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: number;
};

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
  const user = config.mock.enabled
    ? getMockUser()
    : typeof req.isAuthenticated === "function" && req.isAuthenticated()
      ? (req.user as AuthedProfile)
      : null;
  return { req, res, user };
}
