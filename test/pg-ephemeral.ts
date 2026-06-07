/**
 * Ephemeral Postgres cluster for tests (no external services required).
 *
 * Mirrors AUTONOMOUS_BUILD_FRAMEWORK.md Appendix A.2: initdb -A trust → pg_ctl start
 * → createdb, then point DATABASE_URL at it. PostgreSQL refuses to run as root, so when
 * we're root (the dev container) we drop privileges to the `postgres` system user via
 * Node's { uid, gid } child-process option (no `su`/PAM, which can hang in containers).
 * The server is forced to listen on TCP 127.0.0.1 so packages/db treats it as local (no SSL).
 * The whole cluster lives in a temp dir and is destroyed on stop().
 *
 * In CI, set TEST_DATABASE_URL (e.g. a `services: postgres` container) and the runner
 * uses that directly instead of spinning a cluster — see test/run.ts.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PG_VERSIONS = ["16", "17", "15", "14", "13"];

function findPgBin(): string {
  for (const v of PG_VERSIONS) {
    const dir = `/usr/lib/postgresql/${v}/bin`;
    if (existsSync(join(dir, "initdb"))) return dir;
  }
  throw new Error("Could not find a PostgreSQL bin dir under /usr/lib/postgresql/*/bin");
}

function runningAsRoot(): boolean {
  return typeof process.getuid === "function" && process.getuid() === 0;
}

/** Resolve the postgres system user's uid/gid (only needed when we're root). */
function postgresIds(): { uid: number; gid: number } | null {
  try {
    const uid = Number(execFileSync("id", ["-u", "postgres"], { encoding: "utf8" }).trim());
    const gid = Number(execFileSync("id", ["-g", "postgres"], { encoding: "utf8" }).trim());
    if (Number.isFinite(uid) && Number.isFinite(gid)) return { uid, gid };
  } catch {
    /* no postgres user */
  }
  return null;
}

function randomPort(): number {
  return 50000 + Math.floor(Math.random() * 9000);
}

export interface EphemeralPg {
  url: string;
  stop: () => void;
}

export async function startEphemeralPg(): Promise<EphemeralPg> {
  const bin = findPgBin();
  const asRoot = runningAsRoot();
  const ids = asRoot ? postgresIds() : null;
  if (asRoot && !ids) {
    throw new Error("Running as root but no `postgres` user to drop to; install postgres or run tests as non-root.");
  }

  const dataDir = mkdtempSync(join(tmpdir(), "prodigy-pgtest-"));
  // The cluster files + the unix-socket dir must be accessible to the postgres user.
  const drop = ids ? { uid: ids.uid, gid: ids.gid } : {};
  const childEnv = { ...process.env, HOME: dataDir, PGUSER: "postgres" };
  const runAsPg = (file: string, args: string[]): void => {
    const res = spawnSync(file, args, { ...drop, env: childEnv, stdio: "pipe", encoding: "utf8" });
    if (res.status !== 0) {
      throw new Error(`${file} ${args.join(" ")} failed (status ${res.status}): ${res.stderr || res.stdout}`);
    }
  };

  if (ids) {
    spawnSync("chown", ["-R", `${ids.uid}:${ids.gid}`, dataDir], { stdio: "pipe" });
  }

  // initdb once.
  runAsPg(join(bin, "initdb"), ["-D", dataDir, "-A", "trust", "-U", "postgres"]);

  let lastErr: unknown;
  for (let attempt = 0; attempt < 6; attempt++) {
    const port = randomPort();
    try {
      runAsPg(join(bin, "pg_ctl"), [
        "-D",
        dataDir,
        // Redirect the postmaster's stdio to a logfile. Without -l the daemonized server
        // inherits our spawnSync pipes and keeps them open, so spawnSync hangs forever
        // waiting for EOF even though pg_ctl itself has exited.
        "-l",
        join(dataDir, "server.log"),
        "-o",
        `-p ${port} -k /tmp -c listen_addresses=127.0.0.1`,
        "-w",
        "-t",
        "30",
        "start",
      ]);
      runAsPg(join(bin, "createdb"), ["-p", String(port), "-h", "127.0.0.1", "-U", "postgres", "prodigy_test"]);
      const url = `postgresql://postgres@127.0.0.1:${port}/prodigy_test`;
      return {
        url,
        stop: () => {
          try {
            runAsPg(join(bin, "pg_ctl"), ["-D", dataDir, "-w", "-t", "20", "stop"]);
          } catch {
            /* best effort */
          }
          try {
            rmSync(dataDir, { recursive: true, force: true });
          } catch {
            /* best effort */
          }
        },
      };
    } catch (err) {
      lastErr = err;
      // Likely a port collision — stop any half-started server and retry on a new port.
      try {
        runAsPg(join(bin, "pg_ctl"), ["-D", dataDir, "-w", "-t", "10", "stop"]);
      } catch {
        /* ignore */
      }
    }
  }
  rmSync(dataDir, { recursive: true, force: true });
  throw new Error(`Failed to start ephemeral Postgres after retries: ${(lastErr as Error)?.message ?? lastErr}`);
}
