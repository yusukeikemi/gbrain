// #1685 GAP B — pool_reap_health doctor check.
//
// computePoolReapHealthCheck only touches engine.kind + the pool-recovery audit
// (filesystem), so a minimal `{ kind: 'postgres' }` stub drives it hermetically.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { withEnv } from './helpers/with-env.ts';
import { logPoolRecovery } from '../src/core/audit/pool-recovery-audit.ts';
import { computePoolReapHealthCheck } from '../src/commands/doctor.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pg = { kind: 'postgres' } as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pglite = { kind: 'pglite' } as any;

let tmpDir: string;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pool-reap-health-'));
});
afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('computePoolReapHealthCheck', () => {
  test('null on PGLite (no pool) and on null engine', async () => {
    expect(await computePoolReapHealthCheck(pglite)).toBeNull();
    expect(await computePoolReapHealthCheck(null)).toBeNull();
  });

  test('fail when reaps>0 AND reconnect failed (not auto-recovering)', async () => {
    await withEnv({ GBRAIN_AUDIT_DIR: tmpDir }, async () => {
      logPoolRecovery('reap_detected');
      logPoolRecovery('reconnect_failed', new Error('EHOSTUNREACH'));
      const c = await computePoolReapHealthCheck(pg);
      expect(c?.status).toBe('fail');
      expect(c?.message).toContain('not auto-recovering');
      expect(c?.name).toBe('pool_reap_health');
    });
  });

  test('warn on pooler thrash (>=10 reaps all recovered)', async () => {
    await withEnv({ GBRAIN_AUDIT_DIR: tmpDir }, async () => {
      for (let i = 0; i < 12; i++) {
        logPoolRecovery('reap_detected');
        logPoolRecovery('reconnect_succeeded');
      }
      const c = await computePoolReapHealthCheck(pg);
      expect(c?.status).toBe('warn');
      expect(c?.message).toContain('12×');
    });
  });

  test('null (quiet) when a few reaps all recovered', async () => {
    await withEnv({ GBRAIN_AUDIT_DIR: tmpDir }, async () => {
      logPoolRecovery('reap_detected');
      logPoolRecovery('reconnect_succeeded');
      const c = await computePoolReapHealthCheck(pg);
      expect(c).toBeNull();
    });
  });
});
