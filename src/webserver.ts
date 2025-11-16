import express from "express";
import session from "express-session";
import passport from "passport";
import { Profile, Strategy as DiscordStrategy } from "passport-discord";
import { User } from "discord.js";
import { config } from "./services/configService";

export function setupWebServer() {
  const app = express();
  const PORT = config.server.port;

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

  // Configure session management
  app.use(
    session({
      secret: config.server.oauthSecret,
      resave: false,
      saveUninitialized: false,
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
      res.redirect("/"); // Redirect to your desired route after successful login
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

  app.listen(PORT, () => {
    console.log(`Server is running and listening on port ${PORT}`);
  });
}
