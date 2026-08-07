# Cutting a release

DevHelper does not auto-update. A release is a pair of installers on GitHub that
people download and run. Nothing signs them and nothing phones home.

## Steps

1. Bump the version in **all three** places. A test fails if the first and third
   disagree:
   - `src-tauri/tauri.conf.json` → `version`
   - `package.json` → `version`
   - `src/lib/workspace.ts` → `APP_VERSION`
2. Update `CHANGELOG.md`.
3. Commit, tag and push:

   ```bash
   git commit -am "release: v0.3.0"
   git tag v0.3.0
   git push && git push --tags
   ```

4. `.github/workflows/release.yml` builds and creates a **draft** release with
   the MSI and the NSIS setup `.exe`.
5. Check the draft, then publish it.

No secrets are needed. `GITHUB_TOKEN` is provided by Actions automatically.

## If the release job failed

Fix the cause, then re-run against the same tag: **Actions → Release → Run
workflow**, leave the branch as `main`, and type the tag into the `tag` input.
The tag does not need deleting and re-pushing.

Running it from `main` is deliberate. The *workflow file* comes from the branch
you dispatch on, so you get the latest pipeline; the *source* comes from the
`tag` input, so you build what the tag says.

## Building locally

```bash
npm run tauri:build
```

Artifacts land in `src-tauri/target/release/bundle/`. Takes a few minutes; the
Rust release profile is the slow part.

## Platforms

Windows only. The native layer is Windows-specific in several places — SQL Server
over SChannel, the uninstall-registry toolchain probe, Windows Credential Manager
— so adding macOS or Linux runners would publish bundles that have never been
compiled, let alone run. Cross-platform is real work, not a runner added to the
matrix.

## If you ever want auto-updates back

It was wired and then removed in favour of plain releases. Bringing it back means
`tauri-plugin-updater`, a minisign keypair whose private half signs every release,
`plugins.updater` in `tauri.conf.json`, `bundle.createUpdaterArtifacts`, and an
in-app check. Reachable in git history if wanted.
