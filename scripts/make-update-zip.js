"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const stageDir = path.join(distDir, "update-package");
const updateZipPath = path.join(distDir, "update.zip");
const packageJsonPath = path.join(rootDir, "package.json");

function fail(message) {
  console.error(`[update-zip] ${message}`);
  process.exit(1);
}

function escapePowerShellLiteral(value) {
  return String(value || "").replaceAll("'", "''");
}

function getNewestFileMatch(regex) {
  if (!fs.existsSync(distDir)) {
    return null;
  }

  const files = fs
    .readdirSync(distDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(distDir, entry.name))
    .filter((fullPath) => regex.test(path.basename(fullPath)))
    .map((fullPath) => ({
      fullPath,
      stats: fs.statSync(fullPath)
    }))
    .sort((left, right) => right.stats.mtimeMs - left.stats.mtimeMs);

  return files[0] ? files[0].fullPath : null;
}

function copyForPackage(filePath) {
  const target = path.join(stageDir, path.basename(filePath));
  fs.copyFileSync(filePath, target);
  return path.basename(target);
}

function buildManifest(includedFiles) {
  const packageInfo = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  return {
    name: packageInfo.name || "bastion-browser",
    version: packageInfo.version || "0.0.0",
    generatedAt: new Date().toISOString(),
    notes: "Release update package for Bastion Browser.",
    files: includedFiles
  };
}

function createUpdateZip() {
  if (process.platform !== "win32") {
    fail("update.zip generation currently requires Windows (Compress-Archive).");
  }

  const setupExe = getNewestFileMatch(/-Setup\.exe$/i);
  const portableExe = getNewestFileMatch(/-Portable\.exe$/i);

  if (!setupExe || !portableExe) {
    fail("Could not find latest setup and portable EXE files in dist/.");
  }

  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });

  const includedFiles = [copyForPackage(setupExe), copyForPackage(portableExe)];
  const manifestPath = path.join(stageDir, "update-manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(buildManifest(includedFiles), null, 2), "utf8");
  includedFiles.push(path.basename(manifestPath));

  const compressScript = [
    "$ErrorActionPreference='Stop';",
    `if (Test-Path -LiteralPath '${escapePowerShellLiteral(updateZipPath)}') {`,
    `  Remove-Item -LiteralPath '${escapePowerShellLiteral(updateZipPath)}' -Force`,
    "}",
    `Compress-Archive -Path '${escapePowerShellLiteral(path.join(stageDir, "*"))}'`,
    `-DestinationPath '${escapePowerShellLiteral(updateZipPath)}' -Force`
  ].join(" ");

  execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", compressScript],
    { stdio: "inherit", windowsHide: true }
  );

  fs.rmSync(stageDir, { recursive: true, force: true });

  const size = fs.statSync(updateZipPath).size;
  console.log(`[update-zip] Created ${updateZipPath}`);
  console.log(`[update-zip] Size: ${size} bytes`);
  console.log(`[update-zip] Included: ${includedFiles.join(", ")}`);
}

createUpdateZip();
