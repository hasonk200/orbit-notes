param(
  [Parameter(Mandatory = $true)]
  [string]$Version,
  [switch]$DirectToMain,
  [switch]$SkipChecks,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$CleanVer = $Version.Trim().TrimStart('v')
if ($CleanVer -notmatch '^\d+\.\d+\.\d+$') {
  Write-Host "[ERROR] Version must be semver like 0.3.1 or v0.3.1 (got: $Version)" -ForegroundColor Red
  exit 1
}
$Tag = "v$CleanVer"

function RunStep([string]$Label, [scriptblock]$Action) {
  Write-Host "=== $Label ==="
  & $Action
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Step failed: $Label" -ForegroundColor Red
    exit $LASTEXITCODE
  }
}

function WriteUtf8NoBom([string]$Path, [string]$Content) {
  [IO.File]::WriteAllText($Path, $Content, (New-Object System.Text.UTF8Encoding $false))
}

Push-Location $RepoRoot
try {
  $branch = (git rev-parse --abbrev-ref HEAD).Trim()
  if ($branch -ne 'main') {
    throw "Please run release from 'main' (currently on '$branch')."
  }
  $dirty = git status --porcelain --untracked-files=no
  if ($dirty) {
    throw "Tracked files have uncommitted changes. Commit or stash them before releasing.`n$dirty"
  }
  $existingTag = git tag -l $Tag
  if ($existingTag) {
    throw "Tag $Tag already exists locally."
  }

  if ($DryRun) {
    Write-Host "[DRY-RUN] Verified clean main branch. Would pull main, run checks, bump to $CleanVer, open/merge PR (or push main), and tag $Tag."
    exit 0
  }

  RunStep '1/6 Pulling latest main' { git pull origin main }

  if (-not $SkipChecks) {
    RunStep '2/6 Installing packages, running unit tests, web build, and functions check' {
      # The pull may bring new packages (e.g. opencc-js); install exactly what the lock files list.
      npm.cmd ci --no-audit --no-fund
      if ($LASTEXITCODE -eq 0) { npm.cmd --prefix functions ci --no-audit --no-fund }
      if ($LASTEXITCODE -eq 0) { npm.cmd test }
      if ($LASTEXITCODE -eq 0) { npm.cmd run build }
      if ($LASTEXITCODE -eq 0) { npm.cmd --prefix functions run check }
    }
  }

  Write-Host "=== 3/6 Bumping version files to $CleanVer ==="
  $pkgPath = Join-Path $RepoRoot 'package.json'
  $pkgText = [IO.File]::ReadAllText($pkgPath, [Text.Encoding]::UTF8)
  $pkgNext = [regex]::Replace($pkgText, '("version"\s*:\s*")\d+\.\d+\.\d+(")', "`${1}$CleanVer`$2", 1)
  WriteUtf8NoBom $pkgPath $pkgNext

  $tauriPath = Join-Path $RepoRoot 'src-tauri\tauri.conf.json'
  $tauriText = [IO.File]::ReadAllText($tauriPath, [Text.Encoding]::UTF8)
  $tauriNext = [regex]::Replace($tauriText, '("version"\s*:\s*")\d+\.\d+\.\d+(")', "`${1}$CleanVer`$2", 1)
  WriteUtf8NoBom $tauriPath $tauriNext

  $cargoPath = Join-Path $RepoRoot 'src-tauri\Cargo.toml'
  $cargoText = [IO.File]::ReadAllText($cargoPath, [Text.Encoding]::UTF8)
  $cargoNext = [regex]::Replace($cargoText, '(?m)^(version\s*=\s*")\d+\.\d+\.\d+(")', "`${1}$CleanVer`$2", 1)
  WriteUtf8NoBom $cargoPath $cargoNext

  $gradlePath = Join-Path $RepoRoot 'android\app\build.gradle'
  $gradleText = [IO.File]::ReadAllText($gradlePath, [Text.Encoding]::UTF8)
  $codeMatch = [regex]::Match($gradleText, '(?m)^\s*versionCode\s+(\d+)')
  $nextCode = if ($codeMatch.Success) { [int]$codeMatch.Groups[1].Value + 1 } else { 2 }
  $gradleNext = [regex]::Replace($gradleText, '(?m)^(\s*versionCode\s+)\d+', "`${1}$nextCode", 1)
  $gradleNext = [regex]::Replace($gradleNext, '(?m)^(\s*versionName\s+")[^"]+(")', "`${1}$CleanVer`$2", 1)
  WriteUtf8NoBom $gradlePath $gradleNext

  $files = @('package.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'android/app/build.gradle')

  if ($DirectToMain) {
    RunStep '4/6 Committing and pushing to main' {
      git add -- $files
      if ($LASTEXITCODE -eq 0) { git commit -m "chore: bump version to $CleanVer" }
      if ($LASTEXITCODE -eq 0) { git push origin main }
    }
  } else {
    $relBranch = "chore/release-$Tag"
    RunStep "4/6 Opening and merging PR for $Tag" {
      git checkout -b $relBranch
      if ($LASTEXITCODE -eq 0) { git add -- $files }
      if ($LASTEXITCODE -eq 0) { git commit -m "chore: bump version to $CleanVer" }
      if ($LASTEXITCODE -eq 0) { git push -u origin $relBranch }
      if ($LASTEXITCODE -eq 0) {
        $pr = gh pr create --base main --head $relBranch --title "chore: release $Tag" --body "Bump web, desktop, and Android versions to ``$CleanVer``."
        if ($LASTEXITCODE -eq 0) {
          gh pr merge $pr --merge --delete-branch
        }
      }
      if ($LASTEXITCODE -eq 0) { git checkout main }
      if ($LASTEXITCODE -eq 0) { git pull origin main }
    }
  }

  RunStep "5/6 Creating and pushing tag $Tag" {
    git tag -a $Tag -m "Orbit $Tag"
    if ($LASTEXITCODE -eq 0) { git push origin $Tag }
  }

  Write-Host "=== 6/6 Done ===" -ForegroundColor Green
  Write-Host "Release $Tag pushed! GitHub Actions is now building Web, Windows, and Android."
  Write-Host 'Once finished, run Update-Orbit-Desktop.bat (or scripts\update-desktop.ps1) to upgrade locally.'
} finally {
  Pop-Location
}
