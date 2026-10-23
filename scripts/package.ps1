# Builds dist\devdeck-setup-<version>.exe: the desktop exe (with the web app inside, built
# first by `mise run package`) and the Inno Setup installer around it.
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

# Only release tags (v1.2.3) name a version; anything else is a development build.
$version = (git describe --tags --match "v[0-9]*" --always --dirty 2>$null)
if (-not $version) { $version = "dev" }
$version = $version -replace '^v', '' -replace '[^0-9A-Za-z.+-]', '-'
if ($version -notmatch '^[0-9]+\.[0-9]+') { $version = "0.0.0-$version" }

New-Item -ItemType Directory -Force dist | Out-Null
$env:CGO_ENABLED = "0"
go build -trimpath -tags "desktop,production,embedui" -ldflags "-H windowsgui -s -w -X main.version=$version" -o dist\devdeck.exe .\cmd\devdeck
if ($LASTEXITCODE -ne 0) { throw "go build failed" }

$iscc = (Get-Command iscc -ErrorAction SilentlyContinue).Source
if (-not $iscc) {
  foreach ($p in "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe", "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe") {
    if (Test-Path $p) { $iscc = $p; break }
  }
}
if (-not $iscc) { throw "Inno Setup isn't installed: winget install --id JRSoftware.InnoSetup -e" }

# Inno writes the icon into the setup exe it makes, which fails when antivirus or a sync tool
# (OneDrive often syncs the Desktop) holds the output folder. So it builds in a temp folder
# and the finished installer is copied across.
$out = Join-Path $env:TEMP "devdeck-installer"
Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue
& $iscc /Qp "/DAppVersion=$version" "/O$out" installer\devdeck.iss
if ($LASTEXITCODE -ne 0) { throw "the installer didn't build" }
$setup = "devdeck-setup-$version.exe"
Copy-Item (Join-Path $out $setup) (Join-Path "dist" $setup) -Force
Get-Item (Join-Path "dist" $setup) | ForEach-Object { "Built $($_.FullName) ($([math]::Round($_.Length/1MB,1)) MB)" }
