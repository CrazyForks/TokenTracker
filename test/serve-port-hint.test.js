const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { test } = require("node:test");

const {
  buildPortInUseHint,
  isPortUnavailableError,
  ensurePortFree,
  isTokenTrackerServeCommand,
  listenOnAvailablePort,
  NPM_PACKAGE_NAME,
  parseArgs,
  isRunningUnderWsl,
  resolveDefaultPort,
} = require("../src/commands/serve");

function mockPlatform(t, platform) {
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: platform });
  t.after(() => Object.defineProperty(process, "platform", original));
}

test("serve port collision hint references the published npm package name", () => {
  assert.equal(NPM_PACKAGE_NAME, "tokentracker-cli");
  assert.equal(
    buildPortInUseHint(7681),
    "Port 7681 is still in use after cleanup. Try: npx tokentracker-cli serve --port 7682\n",
  );
});

test("serve treats Windows EACCES bind failures as port unavailable", () => {
  assert.equal(isPortUnavailableError({ code: "EACCES" }), true);
  assert.equal(isPortUnavailableError({ code: "EADDRINUSE" }), true);
  assert.equal(isPortUnavailableError({ code: "EINVAL" }), false);
});

test("serve default startup falls through to the next available port", async (t) => {
  let occupied = null;
  let occupiedPort = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    occupied = http.createServer((_req, res) => res.end("occupied"));
    await new Promise((resolve) => occupied.listen(0, "127.0.0.1", resolve));
    occupiedPort = occupied.address().port;
    if (occupiedPort < 65535 && await canBind(occupiedPort + 1)) {
      break;
    }
    await closeServer(occupied);
    occupied = null;
    occupiedPort = null;
  }
  assert.ok(occupied, "expected to find a free adjacent fallback port");
  t.after(() => closeServer(occupied));

  const server = http.createServer((_req, res) => res.end("fallback"));
  t.after(() => closeServer(server));

  const selectedPort = await listenOnAvailablePort(server, occupiedPort, {
    allowFallback: true,
    maxAttempts: 3,
  });

  assert.equal(selectedPort, occupiedPort + 1);
});

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error && error.code !== "ERR_SERVER_NOT_RUNNING") reject(error);
      else resolve();
    });
  });
}

async function canBind(port) {
  const server = http.createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
    return true;
  } catch {
    return false;
  } finally {
    await closeServer(server).catch(() => {});
  }
}

test("serve respects explicit port from --port and PORT env", (t) => {
  mockPlatform(t, "darwin");
  assert.deepEqual(parseArgs([], { PORT: "7700" }), {
    port: 7700,
    portExplicit: true,
    wslDefaultPort: false,
    open: true,
    sync: true,
  });
  assert.deepEqual(parseArgs(["--port", "7701", "--no-open", "--no-sync"], { PORT: "7700" }), {
    port: 7701,
    portExplicit: true,
    wslDefaultPort: false,
    open: false,
    sync: false,
  });
  assert.deepEqual(parseArgs([], {}), {
    port: 7680,
    portExplicit: false,
    wslDefaultPort: false,
    open: true,
    sync: true,
  });
});

// #267: Windows Delivery Optimization (DoSvc) holds 0.0.0.0:7680 on the host,
// so under WSL the default port must move off 7680. Explicit --port / PORT
// always win.
test("serve default port moves to 7681 under WSL", (t) => {
  mockPlatform(t, "linux");
  const wslEnv = { WSL_DISTRO_NAME: "Ubuntu" };

  assert.equal(resolveDefaultPort(wslEnv), 7681);

  const opts = parseArgs([], wslEnv);
  assert.equal(opts.port, 7681);
  assert.equal(opts.portExplicit, false);
  assert.equal(opts.wslDefaultPort, true, "flags the WSL port shift for the startup notice");

  const explicit = parseArgs(["--port", "7680"], wslEnv);
  assert.equal(explicit.port, 7680, "--port 7680 is respected even under WSL");
  assert.equal(explicit.wslDefaultPort, false);

  const envPort = parseArgs([], { ...wslEnv, PORT: "7690" });
  assert.equal(envPort.port, 7690, "PORT env is respected even under WSL");
  assert.equal(envPort.wslDefaultPort, false);
});

test("isRunningUnderWsl detection matrix", (t) => {
  mockPlatform(t, "linux");
  assert.equal(isRunningUnderWsl({ WSL_DISTRO_NAME: "Ubuntu" }), true, "WSL_DISTRO_NAME env");
  assert.equal(isRunningUnderWsl({ WSL_INTEROP: "/run/WSL/1_interop" }), true, "WSL_INTEROP env");
  assert.equal(
    isRunningUnderWsl({}, () => "Linux version 5.15.167.4-microsoft-standard-WSL2"),
    true,
    "/proc/version fingerprint",
  );
  assert.equal(
    isRunningUnderWsl({}, () => "Linux version 6.1.0-generic (gcc ...)"),
    false,
    "plain Linux stays on the standard default",
  );
  assert.equal(
    isRunningUnderWsl({}, () => { throw new Error("EACCES"); }),
    false,
    "unreadable /proc/version fails safe",
  );
  assert.equal(resolveDefaultPort({}, () => "Linux version 6.1.0-generic"), 7680);
});

test("isRunningUnderWsl is false off Linux regardless of env", (t) => {
  mockPlatform(t, "darwin");
  assert.equal(isRunningUnderWsl({ WSL_DISTRO_NAME: "Ubuntu" }), false);
  assert.equal(resolveDefaultPort({ WSL_DISTRO_NAME: "Ubuntu" }), 7680);
});

test("port cleanup only targets a verified TokenTracker server", () => {
  // `--port` may name a port owned by an unrelated application. Failing to
  // bind is far safer than terminating a process that was never ours, so
  // ensurePortFree identifies its target before signalling it.
  const ours = [
    "node /usr/lib/tokentracker/bin/tracker.js serve --port 7680",
    "/opt/app/EmbeddedServer/node /opt/app/EmbeddedServer/tokentracker/bin/tracker.js serve --no-open",
    // `ps -o command=` drops quoting, so the script path is only unambiguous
    // relative to the `serve` argument that follows it.
    "node /home/u/Token Tracker/bin/tracker.js serve",
    // The published npm bin shims: ps reports the shim, not the resolved script.
    "node /home/u/.local/bin/tokentracker-cli serve",
  ];
  for (const command of ours) {
    assert.equal(isTokenTrackerServeCommand(command), true, command);
  }

  const notOurs = [
    // Requiring the bin/ component keeps a lookalike path from matching.
    "node /srv/other/tracker.js serve",
    "node /usr/lib/tokentracker/bin/tracker.js.bak serve",
    // Our own sync process is not a server holding the port.
    "node /usr/lib/tokentracker/bin/tracker.js sync",
    "python3 /usr/lib/tokentracker/bin/tracker.js serve",
    // Whatever else may legitimately own the port.
    "/usr/bin/postgres -D /var/lib/pgsql serve",
    "nginx: worker process",
    // ps prints nothing once the pid is gone; never treat that as a match.
    "",
  ];
  for (const command of notOurs) {
    assert.equal(isTokenTrackerServeCommand(command), false, command);
  }
});

test("port scan is limited to listeners, not everything touching the port", () => {
  // `lsof -i tcp:<port>` matches a socket whose LOCAL *or REMOTE* port matches,
  // so without -sTCP:LISTEN a browser connected to the dashboard is reported
  // alongside the server it is talking to.
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "commands", "serve.js"), "utf8");
  assert.match(source, /"-sTCP:LISTEN"/);
});

// Proves ensurePortFree consults the identity check rather than merely owning
// one: a unit test of isTokenTrackerServeCommand alone still passes if the
// filter is deleted from the kill path.
test("ensurePortFree leaves an unrelated listener running", async (t) => {
  const cp = require("node:child_process");
  const hasLsof = (() => {
    try {
      cp.execFileSync("lsof", ["-v"], { stdio: "ignore", timeout: 5000 });
      return true;
    } catch (_e) {
      return false;
    }
  })();
  if (!hasLsof) return t.skip("ensurePortFree is a no-op without lsof");

  // A separate process, because ensurePortFree skips its own pid for free.
  const child = cp.spawn(
    process.execPath,
    [
      "-e",
      "const n=require('net');n.createServer(c=>c.on('error',()=>{}))" +
        ".listen(0,'127.0.0.1',function(){process.stdout.write(String(this.address().port))});" +
        "setInterval(()=>{},1000);",
    ],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  t.after(() => child.kill("SIGKILL"));

  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("listener never reported a port")), 10000);
    child.stdout.once("data", (chunk) => {
      clearTimeout(timer);
      resolve(Number(String(chunk).trim()));
    });
  });
  assert.ok(port > 0, "child should report its port");

  await ensurePortFree(port);

  assert.equal(child.exitCode, null, "an unrelated listener must survive port cleanup");
  assert.equal(child.signalCode, null, "an unrelated listener must not be signalled");
});
