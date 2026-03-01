# Intent: container/Dockerfile modifications

## What changed

Added Chinese mirror configurations and sudo support for faster downloads and easier container development in China.

## Key sections

### npm mirror (after FROM)
```dockerfile
RUN npm config set registry https://registry.npmmirror.com --location=global
```
- Configures npm to use npmmirror.com (Aliyun mirror) instead of registry.npmjs.org
- `--location=global` ensures it works for all users including node

### apt mirror (after npm config)
```dockerfile
RUN sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list.d/debian.sources
```
- Replaces Debian's official apt sources with Aliyun mirror
- Faster package downloads in China

### sudo support (added to apt install)
```dockerfile
RUN apt-get install -y \
    ... \
    sudo \
    ...

RUN echo "node ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/node && chmod 440 /etc/sudoers.d/node
```
- Installs sudo package
- Grants passwordless sudo to node user
- Useful for container development and debugging

### node user npm config (before USER node)
```dockerfile
RUN mkdir -p /home/node && \
    echo "registry=https://registry.npmmirror.com" > /home/node/.npmrc && \
    chown -R node:node /home/node
```
- Creates .npmrc in node user's home directory
- Ensures npm mirror works when running as node user

## Invariants

- All existing functionality preserved
- Chromium paths unchanged
- Entrypoint script unchanged
- Workspace directories unchanged
- Security model unchanged (still runs as non-root node user)

## Benefits

1. **Faster builds in China**: npm and apt packages download from local mirrors
2. **Easier debugging**: sudo allows installing additional tools for troubleshooting
3. **Developer-friendly**: Can run privileged commands without switching to root

## Must-keep

- The npm config at the top (before any npm install)
- The apt mirror config (before any apt-get update)
- The sudo package in apt install
- The sudoers.d config for node user
- The .npmrc for node user
