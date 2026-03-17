# NativeClaw - Session Lifecycle Manager (Windows)
# Called by Task Scheduler. Starts the Telegram bridge.
# Auth is handled by Claude's credentials (via claude setup-token).

$BridgeDir = Join-Path $env:USERPROFILE ".claude\telegram-bridge"
$BridgePidFile = Join-Path $BridgeDir "bridge.pid"
$LogDir = Join-Path $env:USERPROFILE ".claude\logs"
$LogFile = Join-Path $LogDir "restart.log"

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $LogFile -Value "[$timestamp] $Message"
}

function Stop-BridgeProcess {
    if (Test-Path $BridgePidFile) {
        $pid = Get-Content $BridgePidFile -ErrorAction SilentlyContinue
        if ($pid) {
            $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
            if ($proc) {
                Write-Log "Stopping old bridge (PID $pid)..."
                Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
                Start-Sleep -Seconds 3
                $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
                if ($proc) {
                    Write-Log "Force killing bridge (PID $pid)..."
                    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
                }
                Write-Log "Old bridge stopped."
            }
        }
        Remove-Item $BridgePidFile -Force -ErrorAction SilentlyContinue
    }
}

# Register cleanup on script termination
Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action {
    Write-Log "Process terminating - cleaning up..."
    Stop-BridgeProcess
    Write-Log "Cleanup complete."
} | Out-Null

Write-Log "=== Restart cycle triggered ==="

# Stop any existing bridge
Stop-BridgeProcess

# Start the bridge
Write-Log "Starting Telegram bridge..."
Set-Location $BridgeDir

$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodePath) {
    Write-Log "ERROR: Node.js not found in PATH"
    exit 1
}

$bridgeLog = Join-Path $LogDir "telegram-bridge.log"
$process = Start-Process -FilePath $nodePath -ArgumentList "bridge.js" -WorkingDirectory $BridgeDir -RedirectStandardOutput $bridgeLog -RedirectStandardError (Join-Path $LogDir "bridge-stderr.log") -PassThru -NoNewWindow

Start-Sleep -Seconds 3

if (Test-Path $BridgePidFile) {
    $bridgePid = Get-Content $BridgePidFile
    Write-Log "Bridge started (PID $bridgePid)."
} else {
    Write-Log "WARNING: Bridge PID file not created."
}

Write-Log "=== Restart cycle complete. Blocking until next cycle. ==="

# Block forever - Task Scheduler handles lifecycle
while ($true) {
    Start-Sleep -Seconds 3600
}
