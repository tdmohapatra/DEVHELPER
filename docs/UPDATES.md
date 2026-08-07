# Automatic updates

DevHelper checks GitHub Releases for a newer signed build. Settings → About →
**Check for updates** either reports the current version as newest or offers the
newer one and installs it.

This is configured and working. What follows is the operating manual.

## How it is wired

| Piece | Where |
| --- | --- |
| Public key + feed URL | `src-tauri/tauri.conf.json` → `plugins.updater` |
| Updater artifacts on | `src-tauri/tauri.conf.json` → `bundle.createUpdaterArtifacts` |
| Release pipeline | `.github/workflows/release.yml` |
| In-app check | `src/lib/updates.ts`, surfaced in Settings → About |
| Feed | `https://github.com/tdmohapatra/DEVHELPER/releases/latest/download/latest.json` |

The updater verifies every download against the public key baked into the app. A
release signed with anything else is refused before it is installed, which is the
whole point of the key.

## The private key

Generated without a password, at:

```
C:\Users\Tradelab\.tauri\devhelper.key
```

**Back this up somewhere you will still have in a year.** Losing it means no
existing installation can ever be updated again — a new key produces signatures
that already-installed copies reject, so the only route out is asking everyone to
reinstall by hand.

**It is not in the repository and must never be.** It has no password, so the file
alone is enough to sign an "update" that DevHelper installs without complaint.
Treat it like an SSH private key.

## One-time: add the key to GitHub

The release workflow needs the key as a repository secret.

1. Copy the private key's contents:

   ```powershell
   Get-Content $HOME\.tauri\devhelper.key -Raw | Set-Clipboard
   ```

2. Go to **Settings → Secrets and variables → Actions → New repository secret**
   in the GitHub repo.
3. Name it exactly `TAURI_SIGNING_PRIVATE_KEY` and paste the value.

The key has no password, but the *password variable is still required* — see
below. The workflow already sets it to an empty string, so there is no second
secret to add.

## The empty-password trap

The key was generated without a password. Tauri still decrypts it on every
signed build, and **prompts** when `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is unset.
An interactive terminal shows the prompt; a CI runner or a scripted build simply
hangs, with the last line of output being:

```
Info Decrypting updater signing key, expect a prompt for password
```

That is not a slow build. It is waiting for input that will never come. An empty
string is the answer, and the absence of the variable is not the same thing:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
```

`.github/workflows/release.yml` already sets it.

## Publishing a release

1. Bump the version in **both** places — they are compared against each other,
   and a mismatch means the app either offers an update it already is, or never
   notices one:
   - `src-tauri/tauri.conf.json` → `version`
   - `src/lib/workspace.ts` → `APP_VERSION`
2. Update `CHANGELOG.md`.
3. Commit, tag and push:

   ```bash
   git commit -am "release: v0.2.0"
   git tag v0.2.0
   git push && git push --tags
   ```

4. The workflow builds, signs, and creates a **draft** release with the MSI, the
   NSIS installer and `latest.json`.
5. Check the draft, then publish it. Nothing is offered to installed copies until
   you do — the feed reads `releases/latest`, and a draft is not latest.

## Building locally

`createUpdaterArtifacts` makes the build require the signing key, so
`npm run tauri:build` now fails without it:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $HOME\.tauri\devhelper.key -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
npm run tauri:build
```

```bash
# bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/devhelper.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
npm run tauri:build
```

Both variables, every time. Set them in your shell profile if you build often.

## When something is wrong

**"No release feed is configured"** — `plugins.updater` is missing or malformed
in `tauri.conf.json`.

**The check finds nothing after a release** — the release is still a draft, or
`latest.json` was not attached to it. The feed points at the *latest* release, so
a published release with no `latest.json` is worse than no release: the check
fails rather than reporting up to date.

**"Signature verification failed"** — the release was signed with a different key
than the app was built with. This is the protection working. Rebuild the release
with the key matching `plugins.updater.pubkey`.

**Builds fail with a signing error** — `TAURI_SIGNING_PRIVATE_KEY` is not set. See
*Building locally*.

**The build stops after "Finished 2 bundles" and never returns** — it is at the
password prompt. Set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` to an empty string. See
*The empty-password trap*.

## Platforms

The workflow builds Windows only, deliberately. The native layer is
Windows-specific in several places — SQL Server over SChannel, the
uninstall-registry toolchain probe, Windows Credential Manager — so adding
macOS or Linux runners would publish bundles that have never been compiled here,
let alone run. Cross-platform releases need that work done first, not just a
runner added to the matrix.
