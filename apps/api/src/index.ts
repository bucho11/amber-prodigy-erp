import path from "node:path";
import fs from "node:fs";
import express from "express";
import { initDb, getDbStatus } from "@prodigy/db";
import { APP_NAME, APP_VERSION, type HealthResponse } from "@prodigy/contracts";

const app = express();
app.use(express.json());

app.get("/api/health", async (_req, res) => {
  const database = await getDbStatus();
  const body: HealthResponse = {
    status: "ok",
    service: APP_NAME,
    version: APP_VERSION,
    tenantSlug: "prodigy",
    timezone: "America/Los_Angeles",
    database,
    serverTimeUtc: new Date().toISOString(),
  };
  res.json(body);
});

// Serve the built web client if present, with SPA fallback for non-API GETs.
const webDist = path.resolve(__dirname, "../../web/dist");
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.use((req, res, next) => {
    if (req.method === "GET" && !req.path.startsWith("/api")) {
      res.sendFile(path.join(webDist, "index.html"));
    } else {
      next();
    }
  });
} else {
  app.get("/", (_req, res) => {
    res.type("text/plain").send(`${APP_NAME} ${APP_VERSION} - API up. Web client not built.`);
  });
}

const port = Number(process.env.PORT) || 3000;

initDb()
  .catch((err) =>
    console.error("[db] init failed (continuing without persistence):", (err as Error).message)
  )
  .finally(() => {
    app.listen(port, () => console.log(`[${APP_NAME}] listening on :${port}`));
  });
