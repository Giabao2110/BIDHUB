import { randomUUID } from "node:crypto";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { createServer as createViteServer, type ViteDevServer } from "vite";

async function availablePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test port");
  await new Promise<void>((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const deadline = setTimeout(() => child.kill("SIGKILL"), 12_000);
    child.once("exit", () => {
      clearTimeout(deadline);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

export default async function setup() {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString)
    throw new Error(
      "TEST_DATABASE_URL must point to a dedicated disposable PostgreSQL database.",
    );
  const schema = `browser_test_${randomUUID().replaceAll("-", "")}`;
  const scopedUrl = new URL(connectionString);
  scopedUrl.searchParams.set("options", `-c search_path=${schema}`);
  const admin = new pg.Pool({
    connectionString,
    connectionTimeoutMillis: 5_000,
  });
  const db = new pg.Pool({ connectionString: scopedUrl.toString() });
  let api: ChildProcess | undefined;
  let web: ViteDevServer | undefined;
  let created = false;
  const cleanup = async () => {
    try {
      await web?.close();
      if (api) await stop(api);
      await db.end();
      if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    } finally {
      await admin.end();
      delete process.env.BIDHUB_E2E_DATABASE_URL;
    }
  };
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    created = true;
    const repository = fileURLToPath(new URL("../../../../", import.meta.url));
    const port = await availablePort();
    const environment = {
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: scopedUrl.toString(),
      WEB_ORIGIN: "http://127.0.0.1:5197",
      HOST: "127.0.0.1",
      PORT: String(port),
      METRICS_PORT: String(await availablePort()),
      TRUST_WEB_PROXY: "1",
    };
    execFileSync(
      process.execPath,
      ["--import", "tsx", "apps/api/src/database/migrate.ts"],
      {
        cwd: repository,
        env: environment,
        stdio: "pipe",
        windowsHide: true,
      },
    );
    await db.query(
      "INSERT INTO categories(slug,name) VALUES('browser-test','Browser test')",
    );
    api = spawn(
      process.execPath,
      ["--import", "tsx", "apps/api/src/server.ts"],
      {
        cwd: repository,
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let diagnostics = "";
    api.stdout?.on("data", (data) => {
      diagnostics = (diagnostics + data).slice(-4_000);
    });
    api.stderr?.on("data", (data) => {
      diagnostics = (diagnostics + data).slice(-4_000);
    });
    let ready = false;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (api.exitCode !== null)
        throw new Error(`Test API exited before readiness. ${diagnostics}`);
      try {
        const response = await fetch(
          `http://127.0.0.1:${port}/api/v1/health/ready`,
          {
            signal: AbortSignal.timeout(1_000),
          },
        );
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        /* Startup may still be binding its port. */
      }
      await delay(100);
    }
    if (!ready)
      throw new Error(`Test API did not become ready. ${diagnostics}`);
    web = await createViteServer({
      root: fileURLToPath(new URL("../../", import.meta.url)),
      server: {
        host: "127.0.0.1",
        port: 5197,
        strictPort: true,
        proxy: {
          "/api": `http://127.0.0.1:${port}`,
          "/socket.io": { target: `http://127.0.0.1:${port}`, ws: true },
        },
      },
    });
    await web.listen();
    process.env.BIDHUB_E2E_DATABASE_URL = scopedUrl.toString();
    console.log(
      "Live E2E uses a new PostgreSQL schema, the API server and a loopback Vite proxy.",
    );
    return cleanup;
  } catch (error) {
    await cleanup();
    throw error;
  }
}
