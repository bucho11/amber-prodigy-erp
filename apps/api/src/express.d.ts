import "express-serve-static-core";
import type { TenantContext } from "@prodigy/contracts";

declare module "express-serve-static-core" {
  interface Request {
    tenant?: TenantContext;
  }
}
