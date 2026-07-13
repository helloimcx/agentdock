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

## Manual macOS Packaging

Workflow: `.github/workflows/package-macos.yml`

Triggers:

- Manual `workflow_dispatch`

Jobs:

- `package-macos` runs `pnpm test`, builds macOS `dmg` and `zip` artifacts with `--publish never`, and uploads them as GitHub Actions artifacts.

The manual package artifacts are intended for validation only. They are retained for 14 days and are not formal releases.

## Release

Workflow: `.github/workflows/release.yml`

Triggers:

- Pushes to tags matching `v*`

The release workflow:

1. Installs dependencies with `pnpm install --frozen-lockfile`.
2. Runs `pnpm test`.
3. Publishes macOS `dmg` and `zip` artifacts with `electron-builder --publish always`.
4. Publishes the npm package.
5. Deploys the published npm package to the Ubuntu server.

The macOS and Windows release jobs use `secrets.GITHUB_TOKEN` through `GH_TOKEN` and require `contents: write` permission to create or update GitHub Releases. Electron Builder is configured with `releaseType: release`, so version tags publish public GitHub Releases instead of draft releases. Other jobs use narrower permissions: npm publishing uses `id-token: write` for trusted publishing, and Ubuntu deployment uses `contents: read`.

The npm publish job uses npm trusted publishing through GitHub Actions OIDC (`id-token: write`) and runs `npm publish --access public` without `NODE_AUTH_TOKEN` or an npm `.npmrc`. Configure `@kafca/agentdock` on npm with this GitHub repository and `.github/workflows/release.yml` as a trusted publisher before cutting a release. The publish job installs npm `11.5.1` because trusted publishing requires npm CLI `11.5.1` or later. Do not use a classic 2FA-protected `NPM_TOKEN` for this workflow, because npm will require an interactive OTP and fail CI with `EOTP`. Do not enable `--provenance` while this GitHub repository is private; npm only accepts provenance from public GitHub source repositories.

The Ubuntu deployment job runs after `publish-npm` succeeds and is attached to the `production` GitHub Environment. It reads the version from `package.json`, verifies tag releases match that version, SSHes into the host described by `DEPLOY_USER`, `DEPLOY_HOST`, and optional `DEPLOY_PORT`, runs the root-owned `/usr/local/sbin/deploy-agentdock VERSION` script through sudo, and checks `http://127.0.0.1:14173/api/local/v1/health` on that host.

Required `production` environment secret:

- `DEPLOY_HOST`: deployment host name or IP address.
- `DEPLOY_USER`: deployment SSH user.
- `DEPLOY_PORT`: deployment SSH port. Optional; defaults to `22` when unset.
- `DEPLOY_SSH_PRIVATE_KEY`: private key for an SSH identity that can log in as `DEPLOY_USER` on `DEPLOY_HOST`.
- `DEPLOY_KNOWN_HOSTS`: pinned SSH host key lines for `DEPLOY_HOST`.

Keep deployment secrets scoped to the `production` environment rather than repository-wide secrets. GitHub does not allow reading an existing secret value back out of a repository secret, so move any legacy repository-level deployment secrets manually through the GitHub UI before deleting the repository-level copies.

Required server setup:

- `DEPLOY_USER` can SSH in with the matching public key in its `authorized_keys`.
- `/usr/local/sbin/deploy-agentdock` is owned by root and matches `scripts/deploy-agentdock-server.sh`. It validates the version argument before installing `@kafca/agentdock@VERSION`, restarting `agentdock`, and checking health.
- The deployment sudoers file allows `DEPLOY_USER` to run only `/usr/local/sbin/deploy-agentdock *` non-interactively.
- `/etc/systemd/system/agentdock.service` exists and starts `agentdock serve --host 127.0.0.1 --port 14173`.

## Conditional automation sandbox deployment

The Linux Core image installs `bubblewrap`, `socat`, and `ripgrep`. A production host must also permit unprivileged user namespaces, network namespaces, and seccomp for the Core process. Run the deployment Doctor after installation and treat each `automation.linux.*` failure independently; script-backed Automations remain blocked until every required capability passes. Doctor behaviorally executes a wrapped no-network sandbox command. The sysctl is only failure-classification context: a successful command proves that a dedicated profile works even while the global restriction remains enabled. If a missing prerequisite prevents that command, dependent capability rows are failed as unverified.

Ubuntu 24.04+ enables `kernel.apparmor_restrict_unprivileged_userns`. The supported setup is a dedicated AppArmor profile granting `userns` only to the executables that need it. Do not globally disable `kernel.apparmor_restrict_unprivileged_userns`, and do not use `sysctl ...=0` as the default installation workaround.

Install a host profile such as `/etc/apparmor.d/agentdock-automation-userns`, adjusting the Node package root if the npm installation is elsewhere:

```text
abi <abi/4.0>,
#include <tunables/global>

profile agentdock-automation-bwrap /usr/bin/bwrap flags=(unconfined) {
  userns,
}

profile agentdock-automation-seccomp /opt/agentdock/node_modules/**/apply-seccomp flags=(unconfined) {
  userns,
}
```

Load and inspect it with `sudo apparmor_parser -r /etc/apparmor.d/agentdock-automation-userns` and `sudo aa-status`. Confirm the executable paths with `command -v bwrap` and the installed Sandbox Runtime package before loading the profile. If the AppArmor parser or local policy rejects the profile, keep script Automations blocked and have the host security administrator adapt the dedicated profile; never fall back to unrestricted child processes.

For container deployments, the host runtime must additionally allow the required namespace and seccomp operations for the Core container. Validate that policy with the Doctor in the final container rather than assuming the presence of packages is sufficient.

Release qualification for conditional scripts requires real macOS and Linux Sandbox Runtime checks. macOS must report Sandbox Runtime, `sandbox-exec`, and `rg`; Linux must independently report Bubblewrap, `socat`, `rg`, AppArmor/userns, network namespace, and seccomp. Windows is unsupported and intentionally fail-closed.

Review the accepted DNS-rebinding and detached-process limitations in [Conditional Automation Architecture](../architecture/conditional-automation.md) before enabling scripts that handle sensitive data. High-assurance Linux deployments should add a destination-pinning egress proxy and cgroup containment.

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
- Reusable GitHub Actions are pinned to commit SHAs. Refresh the SHAs intentionally when upgrading `actions/checkout`, `actions/setup-node`, `actions/upload-artifact`, or `pnpm/action-setup`.
- The release workflow is tag-only. Keep production deployment behind the `production` environment approval gate before making the repository public.
- After the repository is public, enable branch protection or repository rulesets for `main` and `v*` tags. The free private repository plan does not expose those controls before the visibility change.
