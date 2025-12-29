param(
  [Parameter(Mandatory = $true)]
  [string]$Branch,
  [string]$WorktreeDir,
  [string]$SourceEnv,
  [switch]$NoEnvCopy
)

$repoRoot = (Get-Location).Path
$resolvedBranch = $Branch.Trim()
if (-not $resolvedBranch) {
  Write-Error "Branch name is required."
  exit 1
}

if (-not $WorktreeDir) {
  $WorktreeDir = Join-Path $repoRoot "..\meeting-notes-discord-bot-$resolvedBranch"
}

git worktree add $WorktreeDir -b $resolvedBranch
if ($LASTEXITCODE -ne 0) {
  Write-Error "Failed to create worktree for branch $resolvedBranch."
  exit $LASTEXITCODE
}

if (-not $NoEnvCopy) {
  $sourceEnv = if ($SourceEnv) { $SourceEnv } else { Join-Path $repoRoot ".env" }
  $targetEnv = Join-Path $WorktreeDir ".env"
  if (-not (Test-Path $sourceEnv)) {
    $fallbackEnv = Join-Path $repoRoot "..\meeting-notes-discord-bot\.env"
    if (Test-Path $fallbackEnv) {
      $sourceEnv = $fallbackEnv
    }
  }
  if (Test-Path $sourceEnv) {
    Copy-Item $sourceEnv $targetEnv -Force
    Write-Host "Copied .env to $targetEnv"
  } else {
    Write-Warning "No .env found in repo root, skipped copy."
  }
}

Write-Host "Worktree ready at $WorktreeDir"
Write-Host "Reminder: create a Discord text and voice channel for this branch."
