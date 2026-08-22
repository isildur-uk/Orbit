param(
    [int]$Port = 4173
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$webRoot = Join-Path $projectRoot 'src'

if (-not (Test-Path -LiteralPath (Join-Path $webRoot 'personal-network\index.html'))) {
    throw "Orbit web entry point was not found under $webRoot"
}

$addresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '169.254*' -and $_.IPAddress -ne '127.0.0.1' } |
    Select-Object -ExpandProperty IPAddress

Write-Host "Serving Orbit from: $webRoot"
Write-Host "On this computer: http://localhost:$Port/index.html"
foreach ($address in $addresses) {
    Write-Host "On a phone on the same Wi-Fi: http://$address`:$Port/index.html"
}
Write-Host 'Live reload is enabled. Keep this window open while editing; the phone page will refresh automatically.'

node (Join-Path $PSScriptRoot 'phone-preview-server.mjs') $Port
