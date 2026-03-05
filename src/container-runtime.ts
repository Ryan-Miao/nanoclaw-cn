/**
 * Container runtime abstraction for NanoClaw.
 * All runtime-specific logic lives here so swapping runtimes means changing one file.
 */
import { execSync } from 'child_process';

import { logger } from './logger.js';

/** The container runtime binary name. */
export const CONTAINER_RUNTIME_BIN = 'docker';

/** Returns CLI args for a readonly bind mount. */
export function readonlyMountArgs(
  hostPath: string,
  containerPath: string,
): string[] {
  return ['-v', `${hostPath}:${containerPath}:ro`];
}

/** Returns the shell command to stop a container by name. */
export function stopContainer(name: string): string {
  return `${CONTAINER_RUNTIME_BIN} stop ${name}`;
}

/** Ensure the container runtime is running, starting it if needed. */
export function ensureContainerRuntimeRunning(): void {
  try {
    execSync(`${CONTAINER_RUNTIME_BIN} info`, {
      stdio: 'pipe',
      timeout: 10000,
    });
    logger.debug('Container runtime already running');
  } catch (err) {
    logger.error({ err }, 'Failed to reach container runtime');
    console.error(
      '\n╔════════════════════════════════════════════════════════════════╗',
    );
    console.error(
      '║  FATAL: Container runtime failed to start                      ║',
    );
    console.error(
      '║                                                                ║',
    );
    console.error(
      '║  Agents cannot run without a container runtime. To fix:        ║',
    );
    console.error(
      '║  1. Ensure Docker is installed and running                     ║',
    );
    console.error(
      '║  2. Run: docker info                                           ║',
    );
    console.error(
      '║  3. Restart NanoClaw                                           ║',
    );
    console.error(
      '╚════════════════════════════════════════════════════════════════╝\n',
    );
    throw new Error('Container runtime is required but failed to start');
  }
}

/** Kill orphaned NanoClaw containers from previous runs. */
export function cleanupOrphans(): void {
  try {
    const output = execSync(
      `${CONTAINER_RUNTIME_BIN} ps --filter name=nanoclaw- --format '{{.Names}}'`,
      { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' },
    );
    const orphans = output.trim().split('\n').filter(Boolean);
    for (const name of orphans) {
      try {
        execSync(stopContainer(name), { stdio: 'pipe' });
      } catch {
        /* already stopped */
      }
    }
    if (orphans.length > 0) {
      logger.info(
        { count: orphans.length, names: orphans },
        'Stopped orphaned containers',
      );
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to clean up orphaned containers');
  }
}

/** Get status of running NanoClaw containers for monitoring. */
export function getContainersStatus(): string {
  const lines: string[] = [];

  try {
    // List running nanoclaw containers
    const listOutput = execSync(
      `${CONTAINER_RUNTIME_BIN} ps --filter name=nanoclaw- --format '{{.Names}} {{.Status}} {{.CreatedAt}}'`,
      { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8', timeout: 5000 },
    );
    const containers = listOutput.trim().split('\n').filter(Boolean);

    if (containers.length === 0) {
      return '📊 **容器状态**: 无运行中的容器';
    }

    lines.push('📊 **容器状态**\n');

    for (const line of containers) {
      const [name, ...statusParts] = line.split(' ');
      const status = statusParts.join(' ');

      lines.push(`\n### ${name}`);
      lines.push(`状态: ${status}`);

      // Get resource usage (CPU, memory)
      try {
        const stats = execSync(
          `${CONTAINER_RUNTIME_BIN} stats ${name} --no-stream --format '{{.CPUPerc}} {{.MemUsage}} {{.MemPerc}}'`,
          { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8', timeout: 10000 },
        ).trim();
        const [cpu, mem, memPerc] = stats.split(' ');
        lines.push(`CPU: ${cpu} | 内存: ${mem}`);
      } catch {
        lines.push('资源: 无法获取');
      }

      // Get top processes in container
      try {
        const psOutput = execSync(
          `${CONTAINER_RUNTIME_BIN} exec ${name} ps aux --sort=-%cpu 2>/dev/null | head -6`,
          { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8', timeout: 5000 },
        );
        const psLines = psOutput.trim().split('\n');
        if (psLines.length > 1) {
          lines.push('\n**进程 (按CPU排序)**:');
          lines.push('```\n' + psLines.join('\n') + '\n```');
        }
      } catch {
        lines.push('进程: 无法获取');
      }

      // Get recent container logs (last 5 lines)
      try {
        const logs = execSync(
          `${CONTAINER_RUNTIME_BIN} logs --tail 5 ${name} 2>&1`,
          { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8', timeout: 5000 },
        );
        const logLines = logs.trim().split('\n').filter(Boolean);
        if (logLines.length > 0) {
          lines.push('\n**最近日志**:');
          lines.push('```\n' + logLines.join('\n') + '\n```');
        }
      } catch {
        // ignore
      }
    }

    // Add disk usage for data directory
    try {
      const diskOutput = execSync(`df -h /home/data 2>/dev/null | tail -1`, {
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf-8',
        timeout: 5000,
      });
      const parts = diskOutput.trim().split(/\s+/);
      if (parts.length >= 4) {
        lines.push(`\n### 磁盘使用`);
        lines.push(`${parts[2]} / ${parts[1]} (${parts[4]})`);
      }
    } catch {
      // ignore
    }
  } catch (err) {
    return `❌ 获取容器状态失败: ${err instanceof Error ? err.message : String(err)}`;
  }

  return lines.join('\n');
}
