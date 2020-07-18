$nodeVersion = "12.18.2"
$yarnVersion = "1.22.4"
$rootDir = (Get-Location)
$downloadDir = Join-Path $rootDir "download"

$x64 = [IntPtr]::Size -eq 8
$nodeArch = if ($x64) { "x64" } else { "x86" }
$nodeUrl = "https://nodejs.org/dist/v$nodeVersion/win-$nodeArch/node.exe"
$yarnUrl = "https://yarnpkg.com/downloads/$yarnVersion/yarn-v$yarnVersion.tar.gz"
$nodeDir = Join-Path $downloadDir "node-v$nodeVersion$nodeArch"

if (![System.IO.Directory]::Exists($nodeDir)) {[System.IO.Directory]::CreateDirectory($nodeDir)}

# Fix to use tls 1.2 for downloads
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Download node
$nodeExe = Join-Path $nodeDir "node.exe"
if (![System.IO.File]::Exists($nodeExe)) {
	Write-Host "Downloading $nodeUrl to $nodeExe"
	$downloader = new-object System.Net.WebClient
	$downloader.DownloadFile($nodeUrl, $nodeExe)
}

# add node to the path
$env:Path = "$nodeDir;$env:Path"

# make node_modules directories
$modulesDir = Join-Path $nodeDir "node_modules"
if (![System.IO.Directory]::Exists($modulesDir)) {[System.IO.Directory]::CreateDirectory($modulesDir)}
$yarnDir = Join-Path $modulesDir "yarn"

# Download yarn
$yarnJs = Join-Path $yarnDir "bin/yarn.js"
if (![System.IO.File]::Exists($yarnJs)) {
  # Download yarn
  $yarnGz = Join-Path $nodeDir "yarn-v$yarnVersion.tar.gz"
  $yarnTar = Join-Path $nodeDir "yarn-v$yarnVersion.tar"
  if (![System.IO.File]::Exists($yarnGz)) {
    Write-Host "Downloading $yarnUrl to $yarnGz"
    $downloader = new-object System.Net.WebClient
    $downloader.DownloadFile($yarnUrl, $yarnGz)
  }

  # Download 7zip
  if (Get-Command "Expand-7Zip" -errorAction SilentlyContinue) {
    Write-Host "7zip already installed"
  } else {
    Install-Module -Force -Scope CurrentUser -Name 7Zip4Powershell -RequiredVersion 1.8.0
  }

  # Extract
  Expand-7Zip $yarnGz $nodeDir
  Expand-7Zip $yarnTar $modulesDir
	Rename-Item "$modulesDir/yarn-v$yarnVersion" $yarnDir
}
