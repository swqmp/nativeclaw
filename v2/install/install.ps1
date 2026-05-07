# NativeClaw v2.0 Windows Installer
# Run in PowerShell: iwr -useb https://raw.githubusercontent.com/njdev/nativeclaw/main/v2/install/install.ps1 | iex

param(
    [string]$InstallPath = "$env:USERPROFILE\.nativeclaw",
    [switch]$SkipNode,
    [switch]$SkipClaude,
    [switch]$SkipCodex
)

$ErrorActionPreference = "Stop"

function Write-Info($msg) { Write-Host "⚡  $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "✅  $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "⚠  $msg" -ForegroundColor Yellow }
function Write-Err($msg) { Write-Host "❌  $msg" -ForegroundColor Red }

Write-Info "NativeClaw v2.0 Windows Setup"
Write-Info "Install path: $InstallPath"

# ── Prereq: Node.js ───────────────────────────────
if (-not $SkipNode) {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        Write-Warn "Node.js not found. Trying winget..."
        winget install OpenJS.NodeJS --silent
        $env:Path = [Environment]::GetEnvironmentVariable("Path", "User")
        $node = Get-Command node -ErrorAction SilentlyContinue
        if (-not $node) {
            Write-Err "Failed to install Node.js. Install manually from https://nodejs.org"
            exit 1
        }
    }
    $nodeVer = & node -v
    Write-Ok "Node.js $nodeVer"
} else {
    Write-Info "Skipping Node.js check."
}

# ── Prereq: Git ───────────────────────────────────
$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) {
    Write-Warn "Git not found. Trying winget..."
    winget install Git.Git --silent
}
$gitVer = & git --version
Write-Ok "Git $gitVer"

# ── Clone / Update ────────────────────────────────
if (-not (Test-Path "$InstallPath\.git")) {
    Write-Info "Cloning NativeClaw into $InstallPath..."
    git clone https://github.com/njdev/nativeclaw.git "$InstallPath" --depth 1
} else {
    Write-Info "Updating existing install..."
    Push-Location $InstallPath
    git pull --ff-only
    Pop-Location
}

# ── Install Node deps ─────────────────────────────
Write-Info "Installing dependencies..."
Push-Location "$InstallPath\v2"
& npm install --production
Pop-Location

# ── Build TypeScript ────────────────────────────
Write-Info "Building TypeScript..."
Push-Location "$InstallPath\v2"
& npm run build
Pop-Location

# ── Symlink CLI ───────────────────────────────────
$binDir = "$env:USERPROFILE\.local\bin"
if (-not (Test-Path $binDir)) { New-Item -ItemType Directory -Path $binDir -Force | Out-Null }
$cliSrc = "$(Resolve-Path $InstallPath)\v2\bin\nativeclaw"
$cliDst = "$binDir\nativeclaw.cmd"
# Create downstream .cmd shim
Set-Content -Path $cliDst -Value "@echo off`nnode `""$cliSrc`"" %*" -Force
Write-Ok "CLI installed to $cliDst"

# Ensure $binDir is on PATH
$currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($currentPath -notlike "*$binDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$currentPath;$binDir", "User")
    Write-Ok "Added $binDir to PATH (restart terminal for effect)"
}

# ── Register Task Scheduler ───────────────────────
$taskXmlPath = "$InstallPath\v2\windows\nativeclaw-task.xml"
if (Test-Path $taskXmlPath) {
    Write-Info "Registering Task Scheduler service..."
    schtasks /Create /XML "$(Resolve-Path $taskXmlPath)" /TN "NativeClaw" /F
    Write-Ok "Task registered. Start with: schtasks /Run /TN NativeClaw"
} else {
    Write-Warn "Task XML not found. You will need to run `nativeclaw run` manually or create the scheduled task yourself."
}

# ── Post-Install ──────────────────────────────────
Write-Info ""
Write-Host "🎉  NativeClaw v2.0 installed successfully!"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Open a new terminal window (so PATH updates take effect)"
Write-Host "  2. Run: nativeclaw setup"
Write-Host "  3. Follow the prompts to connect Telegram and choose your AI backends"
Write-Host ""
Write-Host "Need help?  Run: nativeclaw status"
Write-Host "Docs:       https://nativeclaw.dev/docs"
