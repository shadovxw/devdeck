# Updates: getting a new devdeck

devdeck checks GitHub for a newer release by itself once a day, tells you when one is out, and installs it when you say so.

## How you hear about it

Shortly after devdeck starts, and then once a day, it asks GitHub whether a newer version is out. When one is, a toast says so once ("devdeck 0.2.0 is available", with **View**), and the **Settings** item in the sidebar gets a dot until you update. It never installs anything without asking.

To stop the daily check, set **Settings → About → Check for updates** to **Never**. **Check now** still works.

## Update from devdeck

1. Open **Settings → About** and press **Check now**.
2. If a newer version is out, press **Download update**. devdeck downloads the installer and checks it against the release's `SHA256SUMS`. A file that doesn't match is deleted and never run.
3. Press **Install and restart**. devdeck asks first, and says if it will stop running stacks. Then it closes, the installer updates it, and devdeck opens again.

Your settings, themes, workspaces and logs stay where they are (`%AppData%\devdeck`). Start-at-sign-in and the desktop icon stay as you chose them.

From a terminal, `devdeck update` does the same steps and asks before installing. `devdeck update --check` only checks, and `devdeck update --yes` installs without asking.

## When devdeck can't update itself

- **A development build** (one you built yourself) doesn't check.
- **A copy that wasn't installed with the installer** (for example a `devdeck.exe` copied somewhere) says so: download the installer from the release page and run it.
- **Only Windows** installs by itself. Elsewhere devdeck says that a new version is out.
- **Versions before the updater** (0.1.0) need one update by hand: download `devdeck-setup-<version>.exe` from the [releases page](https://github.com/shadovxw/devdeck/releases/latest) and run it. Later versions update from inside devdeck.

## What it sends

Nothing about you. Checking (by itself once a day, or when you press Check now) is one anonymous request to GitHub's public API for the latest release; downloading fetches the release's installer and `SHA256SUMS` from GitHub. GitHub allows 60 such requests an hour per network, so pressing Check now twice within a minute shows the first answer again.

## Check a download by hand

The release page lists `SHA256SUMS`. In PowerShell:

```powershell
Get-FileHash .\devdeck-setup-0.2.0.exe -Algorithm SHA256
```

The hash must match the line for that file. With the GitHub CLI you can also check that the file was built by devdeck's release workflow:

```powershell
gh attestation verify .\devdeck-setup-0.2.0.exe --repo shadovxw/devdeck
```

## Windows warnings

The installer isn't code-signed yet. On first run Windows may show "Windows protected your PC": choose **More info**, then **Run anyway**. A PC with **Smart App Control** turned on may refuse to run it at all; signing is planned.

If an update doesn't open devdeck again, start it from the Start menu. The installer's log is in `%AppData%\devdeck\updates`.
