<#
.SYNOPSIS
    One-click launcher for DevHelper.
.DESCRIPTION
    - Verifies Node.js is installed.
    - Installs npm dependencies on first run (or when node_modules is missing).
    - If Rust/Cargo is present, launches the full desktop app (tauri:dev).
      Otherwise falls back to the browser dev server and opens it automatically.
.PARAMETER Mode
    auto (default) | web | desktop
        auto    - desktop if Rust is available, else web
        web     - force browser dev server
        desktop - force Tauri desktop app (requires Rust)
#>
param(
    [ValidateSet("auto", "web", "desktop")]
    [string]$Mode = "auto"
)

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  OK $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "  !  $msg" -ForegroundColor Yellow }

Write-Host ""
Write-Host "  DevHelper - Your Everyday Developer Toolbox" -ForegroundColor Magenta
Write-Host "  -------------------------------------------" -ForegroundColor DarkGray
Write-Host ""

# 1. Node.js check
Write-Step "Checking Node.js"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "  Node.js not found. Install it from https://nodejs.org (LTS) and re-run." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Ok "node $(node --version)"

# 2. Dependencies
if (-not (Test-Path "$PSScriptRoot\node_modules")) {
    Write-Step "Installing dependencies (first run, may take a minute)"
    npm install --no-fund --no-audit
    if ($LASTEXITCODE -ne 0) { Write-Host "  npm install failed." -ForegroundColor Red; Read-Host "Press Enter to exit"; exit 1 }
    Write-Ok "dependencies installed"
} else {
    Write-Ok "dependencies present"
}

# 3. Decide mode
$hasRust = [bool](Get-Command cargo -ErrorAction SilentlyContinue)
if ($Mode -eq "auto") { $Mode = if ($hasRust) { "desktop" } else { "web" } }

if ($Mode -eq "desktop" -and -not $hasRust) {
    Write-Warn2 "Desktop mode needs Rust (cargo not found). Falling back to web mode."
    Write-Warn2 "Install Rust from https://rustup.rs to build the .exe / desktop app."
    $Mode = "web"
}

# 4. Launch
if ($Mode -eq "desktop") {
    Write-Step "Launching DevHelper desktop app (tauri:dev)"
    npm run tauri:dev
}
else {
    $url = "http://localhost:5173/"
    Write-Step "Starting dev server -> $url"
    # Open the browser shortly after the server boots.
    Start-Job -ScriptBlock {
        param($u)
        Start-Sleep -Seconds 3
        Start-Process $u
    } -ArgumentList $url | Out-Null
    Write-Warn2 "Browser will open automatically. Press Ctrl+C here to stop the server."
    npm run dev
}
