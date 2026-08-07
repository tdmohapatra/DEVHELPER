# Enabling automatic updates

The updater plugin is compiled into DevHelper and the Settings page has a
**Check for updates** button, but it is inert until DevHelper knows two things:

1. **Where releases live** — a URL it can fetch a manifest from.
2. **The public key** those releases are signed with, so a tampered download is
   rejected rather than installed.

Neither can be decided by the build. They describe how *you* distribute this
app, and until they are set the check honestly reports "no release feed is
configured" instead of claiming the app is up to date.

## Three steps

### 1. Generate a signing key pair

```bash
npx tauri signer generate -w ~/.tauri/devhelper.key
```

This writes a private key (keep it secret — it is what proves a release is
genuinely yours) and prints the matching public key.

**Never commit the private key.** If it leaks, anyone can publish an "update"
that DevHelper will install without complaint.

### 2. Add the updater config

In `src-tauri/tauri.conf.json`, add a `plugins.updater` block and turn on
updater artifacts in the bundle:

```json
{
  "bundle": {
    "createUpdaterArtifacts": true
  },
  "plugins": {
    "updater": {
      "pubkey": "PASTE_THE_PUBLIC_KEY_FROM_STEP_1",
      "endpoints": [
        "https://github.com/<owner>/<repo>/releases/latest/download/latest.json"
      ]
    }
  }
}
```

GitHub Releases is the usual host and needs nothing beyond the repo. Any static
file server works — the endpoint just has to return the manifest Tauri expects.

### 3. Sign at build time

`createUpdaterArtifacts` makes the build require the private key, so builds
without it will now fail:

```bash
# PowerShell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content ~/.tauri/devhelper.key -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<password you set in step 1>"
npm run tauri:build
```

The build then emits `latest.json` alongside the installers. Publish all of
them together — the manifest points at the artifacts, so a manifest published
without them advertises an update that cannot be downloaded.

## Bumping the version

The updater compares against `version` in `src-tauri/tauri.conf.json`. Keep
`APP_VERSION` in `src/lib/workspace.ts` in step with it — that is the number
stamped into workspace backups and shown in Settings → About.

## Checking it works

With the config in place, Settings → About → **Check for updates** either
reports the current version as the newest or offers the newer one. A release
whose signature does not match the configured public key is refused at that
point, before anything is installed.
