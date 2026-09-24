# Builds the mochi-playtester package for PC2024 (x64): the paw, published for win-x64 (framework-dependent;
# PC2024 has .NET 10), plus Node in node\node.exe, then packs it with mcm. Deploy it with the mochi repo's
# /deploy-kittens flow (mcm packages publish mochi-playtester <zip> --rid win-x64 --fde, then mcm dm PC2024 deploy).
#
#   pwsh playtest/paw/package.ps1 [-NodeVersion 22.17.0] [-Mochi C:\git\mochi]
#
# Node comes from nodejs.org and is checked against the release's published SHA-256 before it is packed.
# (The laptop that builds this may be ARM64, so its own node.exe is the wrong one to ship.)

param(
    [string]$NodeVersion = "22.17.0",
    [string]$Mochi = $(if ($env:MOCHI_REPO) { $env:MOCHI_REPO } else { "C:\git\mochi" })
)
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$out = Join-Path ([IO.Path]::GetTempPath()) "mochi-playtester-publish"
$zip = Join-Path ([IO.Path]::GetTempPath()) "mochi-playtester.zip"
Remove-Item -Recurse -Force $out -ErrorAction SilentlyContinue

dotnet publish (Join-Path $here "mochi.playtester.csproj") -c Release -r win-x64 --self-contained false -o $out
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed" }

$name = "node-v$NodeVersion-win-x64"
$cache = Join-Path ([IO.Path]::GetTempPath()) "$name.zip"
if (-not (Test-Path $cache)) {
    Invoke-WebRequest "https://nodejs.org/dist/v$NodeVersion/$name.zip" -OutFile $cache
}
$sums = (Invoke-WebRequest "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt").Content
$expected = ($sums -split "`n" | Where-Object { $_ -match "  $name\.zip$" }) -replace "\s.*$", ""
$actual = (Get-FileHash $cache -Algorithm SHA256).Hash.ToLowerInvariant()
if (-not $expected -or $actual -ne $expected.Trim()) { Remove-Item $cache; throw "Node download failed its SHA-256 check" }

$unzipped = Join-Path ([IO.Path]::GetTempPath()) $name
Remove-Item -Recurse -Force $unzipped -ErrorAction SilentlyContinue
Expand-Archive $cache -DestinationPath ([IO.Path]::GetTempPath())
New-Item -ItemType Directory -Force (Join-Path $out "node") | Out-Null
Copy-Item (Join-Path $unzipped "node.exe") (Join-Path $out "node\node.exe")
Copy-Item (Join-Path $unzipped "LICENSE") (Join-Path $out "node\LICENSE")

dotnet run --project (Join-Path $Mochi "platform/os/mcm/cli.csproj") -- packages mpack ($out -replace '\\', '/') ($zip -replace '\\', '/')
if ($LASTEXITCODE -ne 0) { throw "mcm mpack failed" }
Write-Host "Packed $zip (node v$NodeVersion x64, sha256 $actual). Next: mcm packages publish mochi-playtester $zip --rid win-x64 --fde"
