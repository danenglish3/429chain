import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const CLI_PATH = join(__dirname, '..', 'cli.ts');

function runCli(
  args: string[],
  options?: { cwd?: string },
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('npx', ['tsx', CLI_PATH, ...args], {
    cwd: options?.cwd,
    timeout: 15000,
    env: { ...process.env, NODE_ENV: 'test' },
    shell: true,
  });
}

function runCliExpectFail(
  args: string[],
  options?: { cwd?: string },
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    execFile(
      'npx',
      ['tsx', CLI_PATH, ...args],
      {
        cwd: options?.cwd,
        timeout: 15000,
        env: { ...process.env, NODE_ENV: 'test' },
        shell: true,
      },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          code: error ? (error as NodeJS.ErrnoException & { code?: number }).code as unknown as number ?? 1 : 0,
        });
      },
    );
  });
}

function makeTempDir(): string {
  const dir = join(tmpdir(), `429chain-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('CLI', () => {
  describe('--help', () => {
    it('prints usage text and exits 0', async () => {
      const { stdout } = await runCli(['--help']);

      expect(stdout).toContain('429chain');
      expect(stdout).toContain('--config');
      expect(stdout).toContain('--port');
      expect(stdout).toContain('--init');
      expect(stdout).toContain('--help');
    });

    it('prints usage with -h shorthand', async () => {
      const { stdout } = await runCli(['-h']);

      expect(stdout).toContain('429chain');
      expect(stdout).toContain('Usage:');
    });
  });

  describe('--init', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = makeTempDir();
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('creates config/config.yaml in cwd', async () => {
      const { stdout } = await runCli(['--init'], { cwd: tempDir });

      const configPath = join(tempDir, 'config', 'config.yaml');
      expect(existsSync(configPath)).toBe(true);
      expect(stdout).toContain('Created config file');

      // Verify contents match example
      const created = readFileSync(configPath, 'utf-8');
      const example = readFileSync(
        join(__dirname, '..', '..', 'config', 'config.example.yaml'),
        'utf-8',
      );
      expect(created).toBe(example);
    });

    it('fails if config already exists', async () => {
      // Create config first
      const configDir = join(tempDir, 'config');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, 'config.yaml'), 'existing: true');

      const result = await runCliExpectFail(['--init'], { cwd: tempDir });

      expect(result.stderr).toContain('already exists');
    });
  });

  describe('missing config (no --init, no --help)', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = makeTempDir();
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('shows friendly error with --init hint', async () => {
      const result = await runCliExpectFail(
        ['--config', join(tempDir, 'nonexistent.yaml')],
        { cwd: tempDir },
      );

      expect(result.stderr).toContain('Config file not found');
      expect(result.stderr).toContain('429chain --init');
    }, 15000);
  });
});
