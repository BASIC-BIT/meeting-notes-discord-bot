import express from "express";

// TODO: Remove? Fix ECS health checks?
// The following is a web server that literally only exists to make AppRunner's health check happy
export function setupWebServer() {
  const app = express();
  const PORT = process.env.PORT || 3001;

  // Health check endpoint
  app.get("/health", (_, res) => {
    res.status(200).send("OK");
  });

  app.listen(PORT, () => {
    console.log(`Server is running and listening on port ${PORT}`);
  });
}
