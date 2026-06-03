import path from "node:path";
import fs from "node:fs";
import express, { type Request, type Response, type NextFunction, type RequestHandler } from "express";
import {
  initDb,
  getDbStatus,
  getTenantBySlug,
  DbNotConfiguredError,
  listCategories,
  createCategory,
  updateCategory,
  listServices,
  createService,
  updateService,
  createVariant,
  updateVariant,
  listRooms,
  createRoom,
  updateRoom,
} from "@prodigy/db";
import { APP_NAME, APP_VERSION, type HealthResponse, type TenantContext } from "@prodigy/contracts";

const DEFAULT_TENANT_SLUG = "prodigy";

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function reqString(v: unknown, field: string): string {
  if (typeof v !== "string" || v.trim() === "") throw new ValidationError(`'${field}' is required`);
  return v.trim();
}
function optString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new ValidationError("expected a string");
  const t = v.trim();
  return t === "" ? undefined : t;
}
function reqInt(v: unknown, field: string, min = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isInteger(n) || n < min) throw new ValidationError(`'${field}' must be a whole number >= ${min}`);
  return n;
}
function optInt(v: unknown, field: string, min = 0): number | undefined {
  if (v === undefined || v === null) return undefined;
  return reqInt(v, field, min);
}
function optBool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

type AsyncHandler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: AsyncHandler): RequestHandler => (req, res, next) => {
  fn(req, res).catch(next);
};

function tenantOf(req: Request): TenantContext {
  if (!req.tenant) throw new Error("tenant context not resolved");
  return req.tenant;
}

const app = express();
app.use(express.json());

// Public health endpoint (no tenant). Registered before the tenant router.
app.get(
  "/api/health",
  wrap(async (_req, res) => {
    const database = await getDbStatus();
    const body: HealthResponse = {
      status: "ok",
      service: APP_NAME,
      version: APP_VERSION,
      tenantSlug: DEFAULT_TENANT_SLUG,
      timezone: "America/Los_Angeles",
      database,
      serverTimeUtc: new Date().toISOString(),
    };
    res.json(body);
  })
);

// Per-request tenant resolution. Seam for real auth/identity later; for now a
// single tenant resolved by slug (defaults to Prodigy), so every query is scoped.
const resolveTenant: RequestHandler = (req, res, next) => {
  const header = req.header("x-tenant-slug");
  const slug = typeof header === "string" && header.trim() !== "" ? header.trim() : DEFAULT_TENANT_SLUG;
  getTenantBySlug(slug)
    .then((tenant) => {
      if (!tenant) {
        res.status(404).json({ error: `Unknown tenant '${slug}'` });
        return;
      }
      req.tenant = tenant;
      next();
    })
    .catch(next);
};

const api = express.Router();
api.use(resolveTenant);

api.get(
  "/catalog",
  wrap(async (req, res) => {
    const t = tenantOf(req);
    const [categories, services, rooms] = await Promise.all([
      listCategories(t.id),
      listServices(t.id),
      listRooms(t.id),
    ]);
    res.json({ categories, services, rooms });
  })
);

// Categories
api.post(
  "/categories",
  wrap(async (req, res) => {
    const t = tenantOf(req);
    const name = reqString(req.body?.name, "name");
    const sortOrder = optInt(req.body?.sortOrder, "sortOrder");
    res.status(201).json(await createCategory(t.id, { name, sortOrder }));
  })
);
api.patch(
  "/categories/:id",
  wrap(async (req, res) => {
    const t = tenantOf(req);
    const updated = await updateCategory(t.id, req.params.id, {
      name: req.body?.name === undefined ? undefined : reqString(req.body.name, "name"),
      sortOrder: optInt(req.body?.sortOrder, "sortOrder"),
      isActive: optBool(req.body?.isActive),
    });
    if (!updated) {
      res.status(404).json({ error: "Category not found" });
      return;
    }
    res.json(updated);
  })
);

// Services
api.post(
  "/services",
  wrap(async (req, res) => {
    const t = tenantOf(req);
    const name = reqString(req.body?.name, "name");
    const categoryId = optString(req.body?.categoryId) ?? null;
    const description = optString(req.body?.description) ?? null;
    res.status(201).json(await createService(t.id, { name, categoryId, description }));
  })
);
api.patch(
  "/services/:id",
  wrap(async (req, res) => {
    const t = tenantOf(req);
    const updated = await updateService(t.id, req.params.id, {
      name: req.body?.name === undefined ? undefined : reqString(req.body.name, "name"),
      categoryId: req.body?.categoryId === undefined ? undefined : optString(req.body.categoryId) ?? null,
      description: req.body?.description === undefined ? undefined : optString(req.body.description) ?? null,
      isActive: optBool(req.body?.isActive),
    });
    if (!updated) {
      res.status(404).json({ error: "Service not found" });
      return;
    }
    res.json(updated);
  })
);

// Variants
api.post(
  "/services/:id/variants",
  wrap(async (req, res) => {
    const t = tenantOf(req);
    const name = reqString(req.body?.name, "name");
    const durationMinutes = reqInt(req.body?.durationMinutes, "durationMinutes", 1);
    const priceCents = reqInt(req.body?.priceCents, "priceCents", 0);
    const created = await createVariant(t.id, req.params.id, { name, durationMinutes, priceCents });
    if (!created) {
      res.status(404).json({ error: "Service not found" });
      return;
    }
    res.status(201).json(created);
  })
);
api.patch(
  "/variants/:id",
  wrap(async (req, res) => {
    const t = tenantOf(req);
    const updated = await updateVariant(t.id, req.params.id, {
      name: req.body?.name === undefined ? undefined : reqString(req.body.name, "name"),
      durationMinutes: optInt(req.body?.durationMinutes, "durationMinutes", 1),
      priceCents: optInt(req.body?.priceCents, "priceCents", 0),
      isActive: optBool(req.body?.isActive),
    });
    if (!updated) {
      res.status(404).json({ error: "Variant not found" });
      return;
    }
    res.json(updated);
  })
);

// Rooms
api.post(
  "/rooms",
  wrap(async (req, res) => {
    const t = tenantOf(req);
    const name = reqString(req.body?.name, "name");
    res.status(201).json(await createRoom(t.id, { name }));
  })
);
api.patch(
  "/rooms/:id",
  wrap(async (req, res) => {
    const t = tenantOf(req);
    const updated = await updateRoom(t.id, req.params.id, {
      name: req.body?.name === undefined ? undefined : reqString(req.body.name, "name"),
      isActive: optBool(req.body?.isActive),
    });
    if (!updated) {
      res.status(404).json({ error: "Room not found" });
      return;
    }
    res.json(updated);
  })
);

app.use("/api", api);

// Static web client + SPA fallback for non-API GETs.
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

// Error handler (last middleware).
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof DbNotConfiguredError) {
    res.status(503).json({ error: "Database is not configured yet." });
    return;
  }
  if (err instanceof ValidationError) {
    res.status(400).json({ error: err.message });
    return;
  }
  console.error("[api] error:", err);
  res.status(500).json({ error: "Internal server error" });
});

const port = Number(process.env.PORT) || 3000;
initDb()
  .catch((err) => console.error("[db] init failed (continuing without persistence):", (err as Error).message))
  .finally(() => {
    app.listen(port, () => console.log(`[${APP_NAME}] listening on :${port}`));
  });
