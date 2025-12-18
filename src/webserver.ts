import cors from "cors";
import express from "express";
import session from "express-session";
import passport from "passport";
import { Profile, Strategy as DiscordStrategy } from "passport-discord";
import { User } from "discord.js";
import Stripe from "stripe";
import { registerBillingRoutes } from "./api/billing";
import { registerGuildRoutes } from "./api/guilds";
import { config } from "./services/configService";
import { DynamoSessionStore } from "./services/sessionStore";
import { writeGuildInstaller } from "./db";
import { metricsMiddleware, metricsRegistry } from "./metrics";

export function setupWebServer() {
  const app = express();
  const PORT = config.server.port;

  // Trust first proxy (needed for secure cookies behind ALB/CloudFront)
  app.set("trust proxy", 1);

  // CORS (allow static frontend domain to call API with credentials)
  app.use(
    cors({
      origin:
        config.frontend.allowedOrigins.length > 0
          ? config.frontend.allowedOrigins
          : undefined,
      credentials: true,
    }),
  );

  // Body parsers
  app.use("/api/billing/webhook", express.raw({ type: "application/json" }));
  app.use(express.json());

  // Metrics middleware (must come before routes)
  app.use(metricsMiddleware);

  // Health check endpoint
  app.get("/health", (_, res) => {
    const healthCheck = {
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: config.server.nodeEnv,
      version: config.server.npmPackageVersion,
    };
    res.status(200).json(healthCheck);
  });

  // Prometheus metrics
  app.get("/metrics", async (_req, res) => {
    res.set("Content-Type", metricsRegistry.contentType);
    res.end(await metricsRegistry.metrics());
  });

  // Configure session management (Dynamo-backed, swappable later)
  const isLocalhost =
    config.server.nodeEnv === "development" &&
    config.frontend.siteUrl.startsWith("http://localhost");

  app.use(
    session({
      store: new DynamoSessionStore(),
      secret: config.server.oauthSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        // In dev on localhost we can't set Secure; in prod we should.
        secure: !isLocalhost && config.server.nodeEnv === "production",
        // SameSite=None is required for cross-origin cookies, but Chrome requires Secure.
        // When developing on localhost over http, fall back to lax so cookies are accepted.
        sameSite:
          !isLocalhost && config.frontend.allowedOrigins.length > 0
            ? ("none" as const)
            : ("lax" as const),
        maxAge: 1000 * 60 * 60 * 24 * 7,
      },
    }),
  );

  // Initialize Passport
  app.use(passport.initialize());
  app.use(passport.session());

  // Configure Passport with Discord strategy
  passport.use(
    new DiscordStrategy(
      {
        clientID: config.discord.clientId,
        clientSecret: config.discord.clientSecret,
        callbackURL: config.discord.callbackUrl,
        scope: ["identify", "email", "guilds"],
      },
      (accessToken, refreshToken, profile, done) => {
        // Preserve access token for API calls (e.g., guild listing)
        (profile as Profile & { accessToken?: string }).accessToken =
          accessToken;
        // Here you can save the profile information to your database if needed
        return done(null, profile);
      },
    ),
  );

  // Serialize and deserialize user
  passport.serializeUser((user, done) => {
    done(null, user);
  });

  passport.deserializeUser((obj, done) => {
    done(null, obj as User);
  });

  // Discord OAuth routes
  app.get("/auth/discord", passport.authenticate("discord"));

  app.get(
    "/auth/discord/callback",
    passport.authenticate("discord", {
      failureRedirect: "/",
    }),
    (req, res) => {
      const guildId = req.query.guild_id as string | undefined;
      const profile = req.user as Profile;
      const redirectParam =
        typeof req.query.redirect === "string" ? req.query.redirect : undefined;
      if (guildId) {
        writeGuildInstaller({
          guildId,
          installerId: profile.id,
          installedAt: new Date().toISOString(),
        }).catch((err) =>
          console.error("Failed to persist installer mapping", err),
        );
      }
      const fallback =
        config.frontend.siteUrl && config.frontend.siteUrl.length > 0
          ? config.frontend.siteUrl
          : "/";
      res.redirect(redirectParam || fallback);
    },
  );

  app.get("/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        console.error(err);
      }
      res.redirect("/");
    });
  });

  app.get("/user", (req, res) => {
    if (req.isAuthenticated()) {
      res.json(req.user as Profile);
    } else {
      res.status(401).json({ error: "User not authenticated" });
    }
  });
  // Stripe integration (shared routes live in src/api)
  const stripe =
    config.stripe.secretKey && config.stripe.secretKey.length
      ? new Stripe(config.stripe.secretKey, { apiVersion: "2023-10-16" })
      : null;

  registerBillingRoutes(app, stripe);
  registerGuildRoutes(app);

  app.listen(PORT, () => {
    console.log(`Server is running and listening on port ${PORT}`);
  });
}
