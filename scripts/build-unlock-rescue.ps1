$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $repoRoot "src-tauri/Cargo.toml"
$artifactDir = Join-Path $repoRoot "dist/rescue"
$sourceExe = Join-Path $repoRoot "src-tauri/target/release/nyaterm-unlock-rescue.exe"
$targetExe = Join-Path $artifactDir "nyaterm-unlock-rescue.exe"
$targetZip = Join-Path $artifactDir "nyaterm-unlock-rescue-windows-x64.zip"

cargo build --release --manifest-path $manifestPath --bin nyaterm-unlock-rescue

New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null
Copy-Item -Force -Path $sourceExe -Destination $targetExe
Compress-Archive -Force -Path $targetExe -DestinationPath $targetZip

Write-Host "Built rescue tool:"
Write-Host $targetExe
Write-Host $targetZip
