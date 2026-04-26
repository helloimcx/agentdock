# Release Workflow

This repository uses GitHub Actions for CI and release packaging.

## Recommended Flow

Do not create a formal GitHub Release for every commit to `main`. For a desktop app, each formal release should map to an intentional product version that users can identify, install, and roll back to.

The current workflow uses two stages:

1. Pull requests and `main` pushes run CI.
2. Version tags create GitHub Releases.

## CI

Workflow: `.github/workflows/ci.yml`

Triggers:

- Pull requests
- Pushes to `main`

Jobs:

- `test` runs `pnpm test` on Ubuntu.
- `package-macos` runs on `main` pushes after tests pass, builds macOS `dmg` and `zip` artifacts with `--publish never`, and uploads them as GitHub Actions artifacts.

The `main` branch artifacts are intended for validation only. They are retained for 14 days and are not formal releases.

## Release

Workflow: `.github/workflows/release.yml`

Triggers:

- Pushes to tags matching `v*`
- Manual `workflow_dispatch`

The release job:

1. Installs dependencies with `pnpm install --frozen-lockfile`.
2. Runs `pnpm test`.
3. Publishes macOS `dmg` and `zip` artifacts with `electron-builder --publish always`.

The workflow uses `secrets.GITHUB_TOKEN` through `GH_TOKEN` and requires `contents: write` permission to create or update GitHub Releases. Electron Builder is configured with `releaseType: release`, so version tags publish public GitHub Releases instead of draft releases.

The npm publish job uses npm trusted publishing through GitHub Actions OIDC (`id-token: write`) and runs `npm publish --access public` without `NODE_AUTH_TOKEN` or an npm `.npmrc`. Configure `@kafca/agentdock` on npm with this GitHub repository and `.github/workflows/release.yml` as a trusted publisher before cutting a release. The publish job installs npm `11.5.1` because trusted publishing requires npm CLI `11.5.1` or later. Do not use a classic 2FA-protected `NPM_TOKEN` for this workflow, because npm will require an interactive OTP and fail CI with `EOTP`. Do not enable `--provenance` while this GitHub repository is private; npm only accepts provenance from public GitHub source repositories.

## Creating a Release

Update `package.json` version first, then tag that commit:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Use a tag that matches the app version. For example, `package.json` version `0.1.0` should be released as `v0.1.0`.

## macOS Signing

The current build is unsigned. `package.json` sets `mac.identity` to `null`, and CI sets `CSC_IDENTITY_AUTO_DISCOVERY=false`.

Before distributing builds to real users, add Apple Developer signing and notarization secrets, then enable signing in the Electron Builder configuration.

Suggested future secrets:

- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

## Notes

- `pnpm` version in CI is pinned to `10.33.0`.
- Node.js version in CI is pinned to `22`.
- Release artifacts are macOS arm64 only because `package.json` currently defines `dist:mac` and Electron Builder mac targets for arm64.
