<#
.SYNOPSIS
  Applies (or removes) the dark mode on one Aras Innovator install.

.DESCRIPTION
  apply-darkmode.ps1 -Target <installRoot> [-DryRun] [-NoBump] [-Snapshot <dir>] [-Uninstall]
                     [-Node <node.exe>] [-Skip <step>[,<step>...]]

  -DryRun writes nothing outside <Target>\DarkModeKit\.staging and .snapshot.
  -Uninstall removes the marker blocks and the output folders. The snapshot is kept.
  Does not restart IIS: afterwards, touch Innovator\Client\web.config.
  Works in Windows PowerShell 5.1 and PowerShell 7.
#>
[CmdletBinding()]
param(
	[Parameter(Mandatory = $true)][string]$Target,
	[switch]$DryRun,
	[switch]$NoBump,
	[string]$Snapshot,
	[switch]$Uninstall,
	[string]$Node,
	[string[]]$Skip = @()
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2

function Say([string]$msg, [string]$color = 'Gray') { Write-Host $msg -ForegroundColor $color }
function Warn([string]$msg) { $script:Warnings += $msg; Write-Host "WARN  $msg" -ForegroundColor Yellow }
function Die([string]$msg) { Write-Host "FAILED  $msg" -ForegroundColor Red; exit 1 }

function Invoke-Node([string[]]$NodeArgs) {
	$prev = $ErrorActionPreference
	$ErrorActionPreference = 'Continue'
	try {
		& $script:NodeExe @NodeArgs 2>&1 | ForEach-Object { Write-Host ("  " + "$_") }
		return $LASTEXITCODE
	} finally {
		$ErrorActionPreference = $prev
	}
}
function Read-Json([string]$file) {
	if (-not (Test-Path -LiteralPath $file)) { return $null }
	return (Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json)
}

$script:Warnings = @()
$Skip = @($Skip | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$Target = (Resolve-Path -LiteralPath $Target).Path.TrimEnd('\')
$KitSrc = (Resolve-Path -LiteralPath $PSScriptRoot).Path.TrimEnd('\')
$Kit = Join-Path $Target 'DarkModeKit'
$mode = if ($Uninstall) { 'UNINSTALL' } else { 'APPLY' }
if ($DryRun) { $mode += ' (dry run)' }
Say "aras-darkmode $mode  target=$Target" 'Cyan'

if (-not (Test-Path -LiteralPath (Join-Path $Target 'Innovator\Client'))) { Die "$Target has no Innovator\Client folder" }

$KitRun = $Kit
if ($KitSrc -ne $Kit) {
	if ($DryRun) {
		Say "kit runs from $KitSrc (dry run: not copied into the target)"
		$KitRun = $KitSrc
	} else {
		Say "copying kit $KitSrc -> $Kit"
		Get-ChildItem -LiteralPath $KitSrc -Recurse -File | Where-Object {
			$_.FullName.Substring($KitSrc.Length) -notmatch '^[\\/]\.(snapshot|staging)([\\/]|$)'
		} | ForEach-Object {
			$dst = Join-Path $Kit $_.FullName.Substring($KitSrc.Length + 1)
			$dir = Split-Path -Parent $dst
			if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
			Copy-Item -LiteralPath $_.FullName -Destination $dst -Force
		}
	}
}
$Lib = Join-Path $KitRun 'lib'
if (-not $Snapshot) { $Snapshot = Join-Path $Kit '.snapshot' }
$Staging = Join-Path $Kit '.staging'
$Report = Join-Path $Staging 'report'

if (-not $Node) { $Node = Join-Path $Target 'Innovator\Client\nodejs\node.exe' }
if (-not (Test-Path -LiteralPath $Node)) { Die "node.exe not found at $Node (pass -Node)" }
$script:NodeExe = $Node
$nodeVersion = (& $Node --version)
Say "node $nodeVersion ($Node)"

if (Test-Path -LiteralPath $Staging) { Remove-Item -LiteralPath $Staging -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Report | Out-Null

$psVersion = ''
try { $psVersion = (Get-Item -LiteralPath (Join-Path $Target 'Innovator\Client\bin\Aras.Client.dll')).VersionInfo.FileVersion } catch { $psVersion = '' }
$detectArgs = @((Join-Path $Lib 'detect-version.mjs'), '--target', $Target, '--kit', $KitRun, '--result', (Join-Path $Report 'detect.json'))
if ($psVersion) { $detectArgs += @('--file-version', $psVersion) }
Say '[detect]' 'Cyan'
if ((Invoke-Node $detectArgs) -ne 0) { Die 'version detection failed' }
$det = Read-Json (Join-Path $Report 'detect.json')
if ($det.nearest) { Warn "no anchors for $($det.version): using nearest $($det.anchorsName)" }
$Anchors = $det.anchors

Say '[snapshot]' 'Cyan'
if ((Invoke-Node @((Join-Path $Lib 'snapshot.mjs'), '--target', $Target, '--snapshot', $Snapshot, '--result', (Join-Path $Report 'snapshot.json'))) -ne 0) {
	Die 'snapshot failed (see above); nothing was written to the target'
}

$genRun = @(); $genSkipped = @()
$checks = 'not run'
$asm = $null; $inj = $null; $bump = $null
$common = @('--target', $Target, '--snapshot', $Snapshot, '--anchors', $Anchors, '--out', $Staging)

if (-not $Uninstall) {
	foreach ($g in @('derive-palette', 'gen-overrides', 'gen-icons', 'gen-login')) {
		$script = Join-Path $Lib "$g.mjs"
		if ($Skip -contains $g) { $genSkipped += $g; Warn "$g skipped (-Skip)"; continue }
		if (-not (Test-Path -LiteralPath $script)) { $genSkipped += $g; Warn "lib\$g.mjs not found: skipped"; continue }
		Say "[$g]" 'Cyan'
		if ((Invoke-Node (@($script) + $common)) -ne 0) { Die "$g failed; nothing was written to the target" }
		$genRun += $g
	}

	$checksJs = Join-Path $Lib 'checks.mjs'
	if ($Skip -contains 'checks') { Warn 'checks skipped (-Skip)' }
	elseif (-not (Test-Path -LiteralPath $checksJs)) { Warn 'lib\checks.mjs not found: checks skipped' }
	else {
		Say '[checks]' 'Cyan'
		$rc = Invoke-Node @($checksJs, '--target', $Target, '--snapshot', $Snapshot, '--staging', $Staging, '--anchors', $Anchors, '--json', (Join-Path $Report 'checks-pre.json'))
		if ($rc -ne 0) { Die "checks failed (exit $rc); nothing was written to the target. Details: $(Join-Path $Report 'checks-pre.json')" }
		$checks = 'pass'
	}
}

Say '[assemble]' 'Cyan'
$asmArgs = @((Join-Path $Lib 'assemble.mjs'), '--target', $Target, '--staging', $Staging, '--kit', $KitRun, '--version', $det.version, '--result', (Join-Path $Report 'assemble.json'))
if ($DryRun) { $asmArgs += '--dry-run' }
if ($Uninstall) { $asmArgs += '--uninstall' }
if ((Invoke-Node $asmArgs) -ne 0) { Die 'assemble failed' }
$asm = Read-Json (Join-Path $Report 'assemble.json')

Say '[inject]' 'Cyan'
$injArgs = @((Join-Path $Lib 'inject-entrypoints.mjs'), '--target', $Target, '--staging', $Staging, '--result', (Join-Path $Report 'inject.json'))
if ($DryRun) { $injArgs += '--dry-run' }
if ($Uninstall) { $injArgs += '--uninstall' }
$injRc = Invoke-Node $injArgs
$inj = Read-Json (Join-Path $Report 'inject.json')
if ($null -eq $inj) { Die 'inject failed' }
if ($injRc -ne 0) { Warn "inject reported $(@($inj.errors).Count) error(s) (see above)" }

$changes = [int]$asm.written + [int]$asm.deleted + [int]$inj.written
if ($changes -gt 0 -and -not $NoBump) {
	Say '[filesRevision]' 'Cyan'
	$bArgs = @((Join-Path $Lib 'assemble.mjs'), '--bump-revision', '--target', $Target, '--result', (Join-Path $Report 'bump.json'))
	if ($DryRun) { $bArgs += '--dry-run' }
	if ((Invoke-Node $bArgs) -ne 0) { Die 'filesRevision bump failed' }
	$bump = Read-Json (Join-Path $Report 'bump.json')
} elseif ($changes -gt 0) {
	Warn 'filesRevision NOT bumped (-NoBump): browsers may keep cached files'
}

$post = 'not run'
if (-not $DryRun -and -not $Uninstall -and -not ($Skip -contains 'postchecks') -and (Test-Path -LiteralPath (Join-Path $Lib 'checks.mjs'))) {
	Say '[checks a,d,e after writing]' 'Cyan'
	$rc = Invoke-Node @((Join-Path $Lib 'checks.mjs'), '--target', $Target, '--snapshot', $Snapshot, '--staging', $Staging, '--anchors', $Anchors, '--only', 'a,d,e', '--json', (Join-Path $Report 'checks-post.json'))
	$post = if ($rc -eq 0) { 'pass' } else { 'FAIL' }
}
$reportJs = Join-Path $Lib 'report.mjs'
if (-not $Uninstall -and -not ($Skip -contains 'report')) {
	if (Test-Path -LiteralPath $reportJs) {
		Say '[report]' 'Cyan'
		if ((Invoke-Node (@($reportJs) + $common)) -ne 0) { Warn 'report.mjs failed' }
	} else { Warn 'lib\report.mjs not found: coverage report skipped' }
}

$written = if ($DryRun) { 0 } else { $changes + $(if ($bump -and $bump.bumped) { 1 } else { 0 }) }
$pending = if ($DryRun) { $changes } else { 0 }
$summary = [ordered]@{
	mode = $mode; target = $Target; version = $det.version; anchors = $det.anchorsName; nearest = [bool]$det.nearest
	generators = $genRun; generatorsSkipped = $genSkipped; checks = $checks; postChecks = $post
	assemble = [ordered]@{ written = $asm.written; unchanged = $asm.unchanged; deleted = $asm.deleted }
	inject = [ordered]@{ found = $inj.found; targets = $inj.targets; written = $inj.written; unchanged = $inj.unchanged; missing = @($inj.missing); errors = @($inj.errors).Count }
	filesRevision = $(if ($bump) { "$($bump.from) -> $($bump.to)" } else { 'unchanged' })
	written = $written; pending = $pending; warnings = $script:Warnings
}
$summary | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $Report 'apply-summary.json') -Encoding UTF8

Say ''
Say "== aras-darkmode $mode ==" 'Cyan'
Say ("version      {0} -> anchors {1}{2}" -f $det.version, $det.anchorsName, $(if ($det.nearest) { ' (NEAREST)' } else { '' }))
Say ("generators   ran: {0}; skipped: {1}" -f ($genRun -join ', '), ($genSkipped -join ', '))
Say ("checks       pre: {0}; post: {1}" -f $checks, $post)
Say ("assemble     {0} {1}, {2} unchanged, {3} {4}" -f $asm.written, $(if ($DryRun) { 'pending' } else { 'written' }), $asm.unchanged, $asm.deleted, $(if ($DryRun) { 'to delete' } else { 'deleted' }))
Say ("inject       {0}/{1} entry points found, {2} {3}, {4} unchanged, {5} missing, {6} error(s)" -f $inj.found, $inj.targets, $inj.written, $(if ($DryRun) { 'pending' } else { 'written' }), $inj.unchanged, @($inj.missing).Count, @($inj.errors).Count)
Say ("filesRevision {0}" -f $summary.filesRevision)
Say ("warnings     {0}" -f $script:Warnings.Count)
Say ("summary      {0}" -f (Join-Path $Report 'apply-summary.json'))
if ($injRc -ne 0 -or $post -eq 'FAIL') { Say 'FAILED (see errors above)' 'Red'; exit 1 }
if (-not $DryRun -and $written -gt 0) { Say 'next step:   restart: touch web.config  (Innovator\Client\web.config; this script does not restart IIS)' 'Green' }
elseif ($DryRun) { Say "dry run: $pending change(s) pending; nothing written outside DarkModeKit\.staging and .snapshot" 'Green' }
else { Say 'nothing changed' 'Green' }
exit 0
