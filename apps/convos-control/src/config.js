import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const OPENAGENT_HOME = path.join(os.homedir(), ".openagent");
const DEFAULT_CONTROL_ROOM_NAME = "OpenAgent Control";
const DEFAULT_STATUS_UPDATE_DELAY_MS = 15_000;
const DEFAULT_DASHBOARD_HOST = "127.0.0.1";
const DEFAULT_DASHBOARD_PORT = 4321;

export function loadConfig(env = process.env) {
  const projectPath = normalizeRequiredDirectory(
    env.OPENAGENT_PROJECT_PATH || env.CODEX_PROJECT_PATH,
    "OPENAGENT_PROJECT_PATH",
  );
  const daemonConfig = loadDaemonConfig(env);
  const dataDir = path.resolve(
    String(env.DATA_DIR || "").trim() || path.join(process.cwd(), ".convos-openagent"),
  );

  return {
    dataDir,
    xmtpEnv: normalizeXmtpEnv(env.XMTP_ENV),
    xmtpApiUrl: normalizeOptionalString(env.XMTP_API_URL),
    controlRoomName: normalizeOptionalString(env.CONTROL_ROOM_NAME) || DEFAULT_CONTROL_ROOM_NAME,
    controlRoomDescription:
      normalizeOptionalString(env.CONTROL_ROOM_DESCRIPTION)
      || `Control OpenAgent for ${path.basename(projectPath)} from Convos.`,
    projectPath,
    daemonBaseUrl: daemonConfig.baseUrl,
    daemonToken: daemonConfig.token,
    dashboardHost: normalizeOptionalString(env.OPENAGENT_CONVOS_WEB_HOST) || DEFAULT_DASHBOARD_HOST,
    dashboardPort: parsePositiveInteger(
      env.OPENAGENT_CONVOS_WEB_PORT,
      DEFAULT_DASHBOARD_PORT,
      "OPENAGENT_CONVOS_WEB_PORT",
    ),
    statusUpdateDelayMs: parsePositiveInteger(
      env.STATUS_UPDATE_DELAY_MS,
      DEFAULT_STATUS_UPDATE_DELAY_MS,
      "STATUS_UPDATE_DELAY_MS",
    ),
    runtimeConfig: {
      approvalPolicy: normalizeOptionalString(env.OPENAGENT_APPROVAL_POLICY) || "never",
      sandboxMode: normalizeOptionalString(env.OPENAGENT_SANDBOX_MODE) || "workspace-write",
    },
  };
}

function loadDaemonConfig(env) {
  const explicitBaseUrl = normalizeOptionalString(env.OPENAGENT_DAEMON_URL);
  const explicitToken = normalizeOptionalString(env.OPENAGENT_DAEMON_TOKEN);
  if (explicitBaseUrl && explicitToken) {
    return {
      baseUrl: explicitBaseUrl.replace(/\/+$/, ""),
      token: explicitToken,
    };
  }

  const daemonConfigPath = path.join(OPENAGENT_HOME, "daemon-config.json");
  if (!fs.existsSync(daemonConfigPath)) {
    throw new Error(
      "OpenAgent daemon config was not found. Start the daemon first or set OPENAGENT_DAEMON_URL and OPENAGENT_DAEMON_TOKEN.",
    );
  }

  const parsed = JSON.parse(fs.readFileSync(daemonConfigPath, "utf8"));
  const host = normalizeOptionalString(env.OPENAGENT_DAEMON_HOST) || normalizeOptionalString(parsed.host);
  const port = parsePositiveInteger(
    normalizeOptionalString(env.OPENAGENT_DAEMON_PORT) || String(parsed.port || ""),
    0,
    "OPENAGENT_DAEMON_PORT",
  );
  const token = explicitToken || normalizeOptionalString(parsed.token);
  if (!host || !port || !token) {
    throw new Error("OpenAgent daemon config is incomplete.");
  }

  return {
    baseUrl: explicitBaseUrl || `http://${host}:${port}`,
    token,
  };
}

function normalizeRequiredDirectory(value, name) {
  const resolved = normalizeOptionalPath(value);
  if (!resolved) {
    throw new Error(`${name} is required.`);
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`${name} must point to an existing directory: ${resolved}`);
  }
  return resolved;
}

function normalizeOptionalPath(value) {
  const normalized = normalizeOptionalString(value);
  return normalized ? path.resolve(normalized) : undefined;
}

function normalizeOptionalString(value) {
  if (value == null) {
    return undefined;
  }
  const trimmed = String(value).trim();
  return trimmed ? trimmed : undefined;
}

function normalizeXmtpEnv(value) {
  const normalized = normalizeOptionalString(value)?.toLowerCase();
  if (normalized === "production" || normalized === "dev" || normalized === "local") {
    return normalized;
  }
  throw new Error("XMTP_ENV is required and must be one of: production, dev, local.");
}

function parsePositiveInteger(value, fallback, name) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return fallback;
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}
