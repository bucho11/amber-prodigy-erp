# Prodigy ERP (`amber-prodigy-erp`)

Multi-tenant wellness operating system. Tenant #1: **Prodigy Massage and Wellness**.

See **BUILD_BIBLE.md** for architecture, conventions, commands, and the decision log.

## Quick start
    npm install
    npm run dev        # build + start on $PORT (default 3000)
    # http://localhost:3000      -> status page
    # GET /api/health            -> JSON status

Set `DATABASE_URL` (Postgres) to activate persistence; without it the app boots
in degraded (no-DB) mode so deploys are always green.
