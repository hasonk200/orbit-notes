param(
  [string]$Tag = '',
  [switch]$FromRun,
  [switch]$Force,
  [switch]$Interactive,
  [switch]$NoLaunch,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$Repo = 'hasonk200/orbit-notes'
$InstalledExe = Join-Path $env:LOCALAPPDATA 'Orbit\orbit-notes.exe'
$DownloadRoot = Join-Path $env:USERPROFILE 'Downloads\Orbit-Installers'

function Fail($msg) {
  Write-Host "[ERROR] $msg" -ForegroundColor Red
  exit 1
}

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Fail 'GitHub CLI (gh) is not installed or not in PATH.'
}

$installedVer = $null
if (Test-Path $InstalledExe) {
  $installedVer = (Get-Item $InstalledExe).VersionInfo.ProductVersion
  Write-Host "Installed Orbit Desktop: v$installedVer ($InstalledExe)"
} else {
  Write-Host 'Installed Orbit Desktop: not found (will perform fresh install)'
}

$sourceMode = 'release'
$targetTag = $Tag
$runId = $null
$targetVer = $null

if (-not $FromRun) {
  try {
    $relJson = if ($targetTag) {
      gh release view $targetTag -R $Repo --json tagName,assets 2>$null | ConvertFrom-Json
    } else {
      gh release view -R $Repo --json tagName,assets 2>$null | ConvertFrom-Json
    }
    if ($relJson -and ($relJson.assets | Where-Object { $_.name -like '*-setup.exe' })) {
      $targetTag = $relJson.tagName
      $targetVer = $targetTag.TrimStart('v')
    } else {
      $sourceMode = 'run'
    }
  } catch {
    $sourceMode = 'run'
  }
} else {
  $sourceMode = 'run'
}

if ($sourceMode -eq 'run') {
  $runs = gh run list -R $Repo -w build-apps.yml -s success -L 1 --json databaseId,headBranch,displayTitle | ConvertFrom-Json
  if (-not $runs -or -not $runs.Count) {
    Fail 'No successful build-apps.yml run or GitHub Release with *-setup.exe found yet.'
  }
  $runId = $runs[0].databaseId
  $targetTag = $runs[0].headBranch
  $targetVer = $targetTag.TrimStart('v')
  Write-Host "Using latest successful workflow run #$runId ($targetTag)"
} else {
  Write-Host "Using GitHub Release $targetTag"
}

if ($installedVer -and $targetVer -and ($installedVer -eq $targetVer) -and -not $Force) {
  Write-Host "[OK] Orbit Desktop is already on v$installedVer. Pass -Force to reinstall." -ForegroundColor Green
  exit 0
}

$destDir = Join-Path $DownloadRoot ($targetTag -replace '[^a-zA-Z0-9._-]', '_')
if ($DryRun) {
  Write-Host "[DRY-RUN] Would download installer for $targetTag ($sourceMode) to $destDir and install to $InstalledExe"
  exit 0
}

New-Item -ItemType Directory -Force -Path $destDir | Out-Null

if ($sourceMode -eq 'release') {
  Write-Host '=== 1/3 Downloading Windows setup installer from GitHub Release ==='
  gh release download $targetTag -R $Repo -p '*-setup.exe' -D $destDir --clobber
  if ($LASTEXITCODE -ne 0) { Fail 'Failed to download installer from GitHub Release.' }
} else {
  Write-Host "=== 1/3 Downloading Windows installer artifact from run #$runId ==="
  gh run download $runId -R $Repo -n 'orbit-windows-installer' -D $destDir
  if ($LASTEXITCODE -ne 0) { Fail 'Failed to download workflow artifact.' }
}

$setupExe = Get-ChildItem -Path $destDir -Recurse -Filter '*-setup.exe' | Select-Object -First 1
if (-not $setupExe) {
  Fail "Could not find *-setup.exe inside $destDir"
}
Write-Host "Installer ready: $($setupExe.FullName)"

Write-Host '=== 2/3 Closing running Orbit Desktop (if open) ==='
$running = Get-Process -Name 'orbit-notes' -ErrorAction SilentlyContinue
if ($running) {
  $running | Stop-Process -Force
  Start-Sleep -Milliseconds 800
}

Write-Host '=== 3/3 Installing update ==='
$argList = if ($Interactive) { @() } else { @('/S') }
$proc = if ($argList.Count) {
  Start-Process -FilePath $setupExe.FullName -ArgumentList $argList -Wait -PassThru
} else {
  Start-Process -FilePath $setupExe.FullName -Wait -PassThru
}
if ($proc.ExitCode -ne 0) {
  Fail "Installer exited with code $($proc.ExitCode)"
}

if (Test-Path $InstalledExe) {
  $newVer = (Get-Item $InstalledExe).VersionInfo.ProductVersion
  Write-Host "[DONE] Orbit Desktop updated to v$newVer" -ForegroundColor Green
  if (-not $NoLaunch) {
    Start-Process -FilePath $InstalledExe
  }
} else {
  Write-Host '[DONE] Installer finished.' -ForegroundColor Green
}
