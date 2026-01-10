import type { RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";

type AuthRateLimitConfig = {
  enabled: boolean;
  windowMs: number;
  limit: number;
};

const passThrough: RequestHandler = (_req, _res, next) => {
  next();
};

export const createAuthRateLimiter = ({
  enabled,
  windowMs,
  limit,
}: AuthRateLimitConfig): RequestHandler => {
  if (!enabled) {
    return passThrough;
  }

  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: "Too many authentication attempts, please try again later.",
  });
};
