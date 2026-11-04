# Aras Innovator Dark Mode

A dark theme for Aras Innovator. Light mode is left as it is; users switch with **Theme** in the user menu.

Tested on Aras Innovator 2025 (14.35) and 2024 (14.0.25).

## Requirements

- Windows PowerShell 5.1 or PowerShell 7, run **elevated** on the Aras server.
- Nothing to install: the script uses the install's own `Innovator\Client\nodejs\node.exe`.
- You must be licensed by Aras to modify the install you apply this to. Check your agreement with Aras first.

## Apply

```powershell
$aras = 'C:\Program Files (x86)\Aras\Innovator2025'

# 1. Preview (writes only to <install>\DarkModeKit\.staging and .snapshot)
& .\DarkModeKit\apply-darkmode.ps1 -Target $aras -DryRun

# 2. Apply
& .\DarkModeKit\apply-darkmode.ps1 -Target $aras

# 3. Restart the Client application so browsers pick up the new files
(Get-Item "$aras\Innovator\Client\web.config").LastWriteTime = Get-Date
```

The script copies `DarkModeKit\` into the install root and runs from there. Running it a second time should report `0 written`.

## Remove

```powershell
& .\DarkModeKit\apply-darkmode.ps1 -Target $aras -Uninstall
(Get-Item "$aras\Innovator\Client\web.config").LastWriteTime = Get-Date
```

This removes the marker blocks and the three output folders. `filesRevision` is bumped again so browsers drop the dark files. Afterwards, delete `<install>\DarkModeKit\` by hand.

## Options

| Option | Meaning |
|---|---|
| `-Target <root>` | Install root: the folder that holds `Innovator\` and `OAuthServer\` |
| `-DryRun` | Plan only; nothing outside `<install>\DarkModeKit\` is written |
| `-NoBump` | Don't change `filesRevision`. Browsers may then keep serving cached files. |
| `-Uninstall` | Remove the marker blocks and output folders |
| `-Node <node.exe>` | Use a different `node.exe` |
| `-Snapshot <dir>` | Keep the snapshot of original files somewhere other than `<install>\DarkModeKit\.snapshot` |
| `-Skip <steps>` | Troubleshooting only: leaving out a step produces an incomplete theme |

## What it changes

- **Adds** `<install>\DarkModeKit\`, `Innovator\Client\darkmode\`, `Innovator\Client\images-dark\` and `OAuthServer\wwwroot\css\darkmode\`.
- **Edits** existing files only inside `aras-darkmode:begin` / `aras-darkmode:end` markers: two lines in each client page, and one line at the top of the login stylesheets. It also bumps `filesRevision` in `Innovator\Client\InnovatorClient.config`.

The original bytes of every file it edits are kept in `<install>\DarkModeKit\.snapshot\`.

Other tools may add their own marker blocks to the same pages: whole lines from `aras-<name>:begin` to `aras-<name>:end`. The script leaves those blocks in place when it applies or removes the dark mode.

## After an Aras upgrade, a hotfix or another package

If an upgrade, a hotfix or another package changes a client page, the next apply stops before writing anything and reports that the page differs from its snapshot. Delete `<install>\DarkModeKit\.snapshot`, then apply again.

## Other Aras versions

A version without a matching file in `DarkModeKit\anchors\` uses the nearest one, and the script prints a warning. After a run, check `<install>\DarkModeKit\.staging\KIT-COVERAGE.md` for anything that wasn't themed.
