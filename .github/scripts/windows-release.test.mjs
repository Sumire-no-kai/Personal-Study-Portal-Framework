import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { releaseChannel, publishRelease } from './windows-release.mjs';

test('accept only stable, alpha and beta Windows tags', () => {
  for (const [tag, channel] of [['v1.0.0', 'stable'], ['v0.2.0-alpha.0', 'alpha'], ['v1.2.3-beta.12', 'beta']]) {
    assert.equal(releaseChannel(tag), channel);
  }
  for (const tag of ['v1', 'v01.0.0', 'v1.0.0-rc.1', 'v1.0.0-beta.01', 'v1.0.0+build', 'macos-v1.0.0', 'v1.0.0\n', '', undefined]) {
    assert.throws(() => releaseChannel(tag), /Unsupported/);
  }
});

for (const tag of ['v1.0.0', 'v0.2.0-alpha.1', 'v0.2.0-beta.1']) {
  test(`${tag} publishes the right channel and checksums without a real release`, t => {
    const dir = mkdtempSync(join(tmpdir(), 'noteportal-release-test-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    for (const arch of ['x64', 'arm64']) writeFileSync(join(dir, `Note Portal_${tag.slice(1)}_${arch}-setup.exe`), arch);
    let calls = 0;
    publishRelease(tag, dir, (command, args, options) => {
      calls++;
      assert.equal(command, 'gh');
      assert.equal(options.cwd, dir);
      assert.deepEqual(args.slice(0, 3), ['release', 'create', tag]);
      assert.ok(args.includes('--verify-tag') && args.includes('--generate-notes'));
      const stable = tag === 'v1.0.0';
      assert.equal(args.includes('--latest'), stable);
      assert.equal(args.includes('--prerelease'), !stable);
      assert.equal(args.includes('--latest=false'), !stable);
      const sums = readFileSync(join(dir, 'SHA256SUMS.txt'), 'utf8');
      for (const arch of ['x64', 'arm64']) {
        const name = `Note.Portal_${tag.slice(1)}_${arch}-setup.exe`;
        assert.ok(args.includes(name));
        assert.equal(readFileSync(join(dir, name), 'utf8'), arch);
        assert.ok(sums.includes(`${createHash('sha256').update(arch).digest('hex')}  ${name}\n`));
      }
    });
    assert.equal(calls, 1);
  });
}

test('missing, extra, mismatched or colliding installers cannot invoke publication', t => {
  for (const names of [[], ['Note Portal_1.0.0_x64-setup.exe'],
    ['Note Portal_0.9.0_x64-setup.exe', 'Note Portal_0.9.0_arm64-setup.exe'],
    ['Note Portal_1.0.0_x64-setup.exe', 'Note Portal_1.0.0_arm64-setup.exe', 'extra-setup.exe'],
    ['Note Portal_1.0.0_x64-setup.exe', 'Note Portal_1.0.0_arm64-setup.exe', 'Note.Portal_1.0.0_x64-setup.exe'],
    ['Note Portal_1.0.0_x64-setup.exe', 'Note Portal_1.0.0_arm64-setup.exe', 'SHA256SUMS.txt']]) {
    const dir = mkdtempSync(join(tmpdir(), 'noteportal-release-test-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    for (const name of names) writeFileSync(join(dir, name), 'fixture');
    assert.throws(() => publishRelease('v1.0.0', dir, () => assert.fail('must not publish')), /Expected|Refusing/);
    assert.deepEqual(readdirSync(dir).sort(), names.sort());
  }
});
