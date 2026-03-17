# Send a message directly to Telegram (used by crons to notify the user)
# Usage: powershell -File telegram_direct.ps1 "Your message here"

param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$Message
)

$ConfigPath = Join-Path $env:USERPROFILE ".claude\telegram-bridge\config.json"

if (-not (Test-Path $ConfigPath)) {
    Write-Error "ERROR: No config at $ConfigPath"
    exit 1
}

$config = Get-Content $ConfigPath | ConvertFrom-Json
$botToken = $config.botToken
$chatId = $config.allowedChatIds[0]

$body = @{
    chat_id = $chatId
    text = $Message
} | ConvertTo-Json

try {
    Invoke-RestMethod -Uri "https://api.telegram.org/bot$botToken/sendMessage" `
        -Method Post `
        -ContentType "application/json" `
        -Body $body | Out-Null
    Write-Output "Sent."
} catch {
    Write-Error "Failed to send: $_"
    exit 1
}
