"use strict";

const { spawn } = require("child_process");
const path = require("path");

const electronBinary = require("electron");
const appDir = path.resolve(__dirname, "..");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, [appDir], {
  stdio: "inherit",
  env
});

child.on("error", (error) => {
  console.error("Failed to launch Bastion Browser:", error.message);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
