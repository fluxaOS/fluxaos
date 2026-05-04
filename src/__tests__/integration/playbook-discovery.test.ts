import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  discoverPlaybooks,
  resolvePlaybook,
} from '@/core/pipeline/playbook-discovery';

const TMP = '/tmp/fluxaos-test-discovery';

const validYaml = `
name: test-pipeline
description: Test pipeline.
prompt: |
  Test prompt.
stages:
  - id: run
    skill: test
    onPass: complete
    onFail: complete
    fallback: complete
`;

beforeEach(() => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(`${TMP}/bundled`, { recursive: true });
  mkdirSync(`${TMP}/org`, { recursive: true });
  mkdirSync(`${TMP}/project`, { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('discoverPlaybooks', () => {
  it('loads from bundled scope', async () => {
    writeFileSync(`${TMP}/bundled/my-pipeline.yaml`, validYaml);
    const results = await discoverPlaybooks({ bundledDir: `${TMP}/bundled` });
    expect(results).toHaveLength(1);
    expect(results[0].scope).toBe('bundled');
    expect(results[0].playbook.name).toBe('test-pipeline');
  });

  it('project overrides bundled by filename', async () => {
    writeFileSync(`${TMP}/bundled/my-pipeline.yaml`, validYaml);
    const projectYaml = validYaml.replace(
      'name: test-pipeline',
      'name: project-override'
    );
    writeFileSync(`${TMP}/project/my-pipeline.yaml`, projectYaml);
    const results = await discoverPlaybooks({
      bundledDir: `${TMP}/bundled`,
      projectDir: `${TMP}/project`,
    });
    expect(results).toHaveLength(1);
    expect(results[0].scope).toBe('project');
    expect(results[0].playbook.name).toBe('project-override');
  });

  it('org overrides bundled but not project', async () => {
    writeFileSync(`${TMP}/bundled/p.yaml`, validYaml);
    const orgYaml = validYaml.replace(
      'name: test-pipeline',
      'name: org-version'
    );
    writeFileSync(`${TMP}/org/p.yaml`, orgYaml);
    const projectYaml = validYaml.replace(
      'name: test-pipeline',
      'name: project-version'
    );
    writeFileSync(`${TMP}/project/p.yaml`, projectYaml);
    const results = await discoverPlaybooks({
      bundledDir: `${TMP}/bundled`,
      orgDir: `${TMP}/org`,
      projectDir: `${TMP}/project`,
    });
    expect(results).toHaveLength(1);
    expect(results[0].playbook.name).toBe('project-version');
  });

  it('skips invalid YAML files and continues', async () => {
    writeFileSync(`${TMP}/bundled/good.yaml`, validYaml);
    writeFileSync(
      `${TMP}/bundled/bad.yaml`,
      'name: x\ndescription: y\n# missing stages and prompt'
    );
    const results = await discoverPlaybooks({ bundledDir: `${TMP}/bundled` });
    expect(results).toHaveLength(1);
    expect(results[0].playbook.name).toBe('test-pipeline');
  });
});

describe('resolvePlaybook', () => {
  it('resolves playbook by name', async () => {
    writeFileSync(`${TMP}/bundled/my-pipeline.yaml`, validYaml);
    const found = await resolvePlaybook('test-pipeline', {
      bundledDir: `${TMP}/bundled`,
    });
    expect(found).not.toBeNull();
    expect(found?.playbook.name).toBe('test-pipeline');
  });

  it('returns null for unknown name', async () => {
    const found = await resolvePlaybook('nonexistent', {
      bundledDir: `${TMP}/bundled`,
    });
    expect(found).toBeNull();
  });
});
