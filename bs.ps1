$ErrorActionPreference = "Stop"
# check for presence of bootstrap scripts
if (![System.IO.File]::Exists('yarn.ps1') -or ![System.IO.File]::Exists('nodeBootstrap.ps1') -or ![System.IO.File]::Exists('node.ps1')) {
  # Something is missing, download from github
  $rootDir = (Get-Location)
  $downloadDir = Join-Path $rootDir "download"
  if (![System.IO.Directory]::Exists($downloadDir)) {[System.IO.Directory]::CreateDirectory($downloadDir)}

  # Fix to use tls 1.2 for downloads
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

  $latestUrl = "https://api.github.com/repos/murrayju/build-strap-cli/releases/latest"
  $downloader = new-object System.Net.WebClient
  $downloader.Headers.Add("User-Agent", "build-strap")
  $cliUrl = ($downloader.DownloadString($latestUrl) | ConvertFrom-Json).tarball_url
  $cliGz = Join-Path $downloadDir "bs-cli.tar.gz"
  $cliTar = Join-Path $downloadDir "bs-cli.tar"
  if (![System.IO.File]::Exists($cliGz)) {
    Write-Host "Downloading $cliUrl to $cliGz"
    $downloader = new-object System.Net.WebClient
    $downloader.Headers.Add("User-Agent", "build-strap")
    $downloader.DownloadFile($cliUrl, $cliGz)
  }

  $cliDir = Join-Path $downloadDir "bs-cli"
  if (![System.IO.Directory]::Exists($cliDir)) {
    # Download 7zip
    if (Get-Command "Expand-7Zip" -errorAction SilentlyContinue) {
      Write-Host "7zip already installed"
    } else {
      Install-Module -Force -Scope CurrentUser -Name 7Zip4Powershell -RequiredVersion 1.8.0
    }

    # Extract
    Expand-7Zip $cliGz $downloadDir
    Expand-7Zip $cliTar $downloadDir
    Get-ChildItem -Path $downloadDir -filter "murrayju-build-strap-cli*" | Rename-Item -NewName $cliDir
  }

  Copy-Item "$cliDir/bs*","$cliDir/node*","$cliDir/yarn*" $rootDir
}

# source some variables
. ./nodeBootstrap.ps1

# Run yarn install
& ./yarn.ps1 install

# Run yarn run (pass through args to specify build tasks)
& ./yarn.ps1 run run $args
exit $LastExitCode
