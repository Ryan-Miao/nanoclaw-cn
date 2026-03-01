---
name: chinese-mirror
description: Configure Chinese mirrors for npm and apt in the container Dockerfile. Speeds up builds and provides sudo for debugging.
---

# Chinese Mirror Configuration

This skill modifies `container/Dockerfile` to use Chinese mirrors for faster downloads and adds sudo support for container development.

## Phase 1: Pre-flight

### Check if already applied

Read `.nanoclaw/state.yaml`. If `chinese-mirror` is in `applied_skills`, the skill is already applied. Skip to verification.

## Phase 2: Apply Code Changes

### Initialize skills system (if needed)

If `.nanoclaw/` directory doesn't exist yet:

```bash
npx tsx scripts/apply-skill.ts --init
```

### Apply the skill

```bash
npx tsx scripts/apply-skill.ts .claude/skills/chinese-mirror
```

This modifies `container/Dockerfile` to add:
- npm mirror: `registry.npmmirror.com` (Aliyun)
- apt mirror: `mirrors.aliyun.com` (Aliyun)
- sudo: passwordless sudo for node user
- node user .npmrc for npm mirror

### Validate changes

```bash
npm run build
```

## Phase 3: Rebuild Container

After applying the skill, rebuild the container to use the new mirrors:

```bash
./container/build.sh
```

For a clean rebuild (if cache issues):

```bash
# Apple Container
container builder stop && container builder rm && container builder start
./container/build.sh

# Docker (if using Docker)
docker builder prune -f
./container/build.sh
```

## What Changed

| Change | Purpose |
|--------|---------|
| npm mirror | Faster npm package downloads in China |
| apt mirror | Faster apt package downloads in China |
| sudo package | Install additional tools for debugging |
| node sudoers | Passwordless sudo for node user |
| node .npmrc | npm mirror works as node user |

## Verification

After rebuilding, verify the mirrors are working:

```bash
# Check npm registry
docker run --rm nanoclaw-agent:latest npm config get registry
# Should output: https://registry.npmmirror.com/

# Check sudo works
docker run --rm nanoclaw-agent:latest sudo whoami
# Should output: root
```

## Troubleshooting

### Mirror not working

1. Verify the skill was applied: check `.nanoclaw/state.yaml` for `chinese-mirror`
2. Rebuild container with `--no-cache`
3. Check Dockerfile contains the mirror configurations

### sudo not working

1. Verify sudo package is installed in Dockerfile
2. Verify sudoers.d config exists
3. Rebuild container

## After Setup

The container will now:
- Download npm packages from npmmirror.com
- Download apt packages from mirrors.aliyun.com
- Allow sudo commands for debugging

## Reverting

To revert this skill:

```bash
npx tsx scripts/uninstall-skill.ts chinese-mirror
./container/build.sh
```
