/**
 * Dependency Cycle Detection Tests (Issue #188)
 *
 * Verifies that cycle detection in TaskService.addDependency() works correctly:
 * - Allows valid dependencies between unrelated tasks
 * - Detects real cycles (direct and transitive)
 * - Handles both depends_on and blocks relationship types
 * - Does NOT false-positive on valid graphs that mix relationship types (#188)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TaskService } from '../services/task-service.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('Dependency cycle detection', () => {
  let service: TaskService;
  let tmpDir: string;
  let tasksDir: string;
  let archiveDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vk-cycle-test-'));
    tasksDir = path.join(tmpDir, 'tasks');
    archiveDir = path.join(tmpDir, 'archive');
    await fs.mkdir(tasksDir, { recursive: true });
    await fs.mkdir(archiveDir, { recursive: true });
    service = new TaskService({ tasksDir, archiveDir });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function createSimpleTask(title: string) {
    return service.createTask({ title, project: 'test' });
  }

  it('allows a dependency between two unrelated tasks', async () => {
    const a = await createSimpleTask('Task A');
    const b = await createSimpleTask('Task B');

    const result = await service.addDependency(a.id, b.id, 'depends_on');
    expect(result.dependencies?.depends_on).toContain(b.id);
  });

  it('detects a direct cycle: A depends_on B, then B depends_on A', async () => {
    const a = await createSimpleTask('Task A');
    const b = await createSimpleTask('Task B');

    await service.addDependency(a.id, b.id, 'depends_on');

    await expect(service.addDependency(b.id, a.id, 'depends_on')).rejects.toThrow(/cycle/i);
  });

  it('detects a transitive cycle: A→B→C, then C→A', async () => {
    const a = await createSimpleTask('Task A');
    const b = await createSimpleTask('Task B');
    const c = await createSimpleTask('Task C');

    await service.addDependency(a.id, b.id, 'depends_on');
    await service.addDependency(b.id, c.id, 'depends_on');

    await expect(service.addDependency(c.id, a.id, 'depends_on')).rejects.toThrow(/cycle/i);
  });

  it('detects a cycle through blocks: A blocks B, then B blocks A', async () => {
    const a = await createSimpleTask('Task A');
    const b = await createSimpleTask('Task B');

    // A blocks B  ⟹  stored as A.blocks=[B], B.depends_on=[A]
    await service.addDependency(a.id, b.id, 'blocks');

    // B blocks A  ⟹  would mean B.blocks=[A], A.depends_on=[B]
    // Combined: A depends_on B AND B depends_on A → cycle
    await expect(service.addDependency(b.id, a.id, 'blocks')).rejects.toThrow(/cycle/i);
  });

  it('allows a complex DAG with no cycle (diamond shape)', async () => {
    // A→B, A→C, B→D, C→D  (diamond, no cycle)
    const a = await createSimpleTask('Task A');
    const b = await createSimpleTask('Task B');
    const c = await createSimpleTask('Task C');
    const d = await createSimpleTask('Task D');

    await service.addDependency(a.id, b.id, 'depends_on');
    await service.addDependency(a.id, c.id, 'depends_on');
    await service.addDependency(b.id, d.id, 'depends_on');

    const result = await service.addDependency(c.id, d.id, 'depends_on');
    expect(result.dependencies?.depends_on).toContain(d.id);
  });

  it('does not false-positive when depends_on and blocks edges cross (issue #188)', async () => {
    // C depends_on D, and D blocks E.
    // This is NOT a cycle — they are separate valid relationships.
    // Adding E depends_on C should succeed because there is no actual depends_on cycle.
    //
    // Old bug: DFS mixed depends_on + blocks edges, creating a false path C→D→E,
    // causing checkForCycle(E, C, ...) to incorrectly return true.
    const c = await createSimpleTask('Task C');
    const d = await createSimpleTask('Task D');
    const e = await createSimpleTask('Task E');

    // C depends_on D: C is blocked by D
    await service.addDependency(c.id, d.id, 'depends_on');

    // D blocks E: D must be done before E (E depends_on D stored on D's side as blocks)
    await service.addDependency(d.id, e.id, 'blocks');

    // E depends_on C should be valid — no actual depends_on cycle exists
    const result = await service.addDependency(e.id, c.id, 'depends_on');
    expect(result.dependencies?.depends_on).toContain(c.id);
  });

  it('still detects real cycle when an unrelated blocks edge is present', async () => {
    // A depends_on B, B depends_on A — real depends_on cycle.
    // An unrelated blocks edge (X blocks A) should not affect detection.
    const a = await createSimpleTask('Task A');
    const b = await createSimpleTask('Task B');
    const x = await createSimpleTask('Task X');

    await service.addDependency(a.id, b.id, 'depends_on');
    // Add an unrelated blocks edge
    await service.addDependency(x.id, a.id, 'blocks');

    await expect(service.addDependency(b.id, a.id, 'depends_on')).rejects.toThrow(/cycle/i);
  });
});
