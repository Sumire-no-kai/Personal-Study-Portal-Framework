import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function releaseChannel(tag) {
  const match = typeof tag === 'string' && tag === tag.trim() && /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta)\.(0|[1-9]\d*))?$/.exec(tag);
  if (!match) throw new Error(`Unsupported Windows release tag: ${tag}`);
  return match[4] || 'stable';
}

export function publishRelease(tag, directory, run = execFileSync) {
  const channel = releaseChannel(tag);
  const version = tag.slice(1);
  const entries = readdirSync(directory, { withFileTypes: true });
  const installers = entries.filter(entry => entry.name.endsWith('-setup.exe'));
  const names = ['x64', 'arm64'].map(arch => `Note Portal_${version}_${arch}-setup.exe`);
  if (installers.length !== 2 || installers.some(entry => !entry.isFile()) ||
      !names.every(name => installers.some(entry => entry.name === name))) {
    throw new Error('Expected exactly the matching-version x64 and ARM64 installers');
  }
  const assets = names.map(name => name.replaceAll(' ', '.'));
  if ([...assets, 'SHA256SUMS.txt'].some(name => existsSync(join(directory, name)))) {
    throw new Error('Refusing to replace an existing release asset');
  }
  for (let i = 0; i < names.length; i++) renameSync(join(directory, names[i]), join(directory, assets[i]));
  const sums = assets.map(name => `${createHash('sha256').update(readFileSync(join(directory, name))).digest('hex')}  ${name}\n`).join('');
  writeFileSync(join(directory, 'SHA256SUMS.txt'), sums, { flag: 'wx' });

  const stable = channel === 'stable';
  const notes = `${stable ? 'Windows 正式版' : 'Windows 预发布版'}：根据设备选择 x64 或 ARM64 的 *-setup.exe 安装，“Source code”压缩包不是应用。ARM64 安装器外壳可能使用 x86 模拟，应用主体为 ARM64。升级前请退出应用，新版本可覆盖安装并保留设置。首次使用须读完整提示并完成指引，再选择本机 Markdown 文件夹。小窗口与阅读器支持中英双语、主题色及本机 Logo。服务仅监听本机，不内置 AI、不上传笔记；单个资料库的 Markdown 总量上限为 64 MiB。${stable ? '正式发布前，CI 必须验证两个架构的应用主体与安装包均有有效 Windows 签名。' : '预发布安装包可能尚未签名，Windows 可能显示安全提示；请核对来源与 SHA256SUMS.txt。'}问题和建议请提交到 https://github.com/Sumire-no-kai/Personal-Study-Portal-Framework/issues/new/choose 。本工具不适合公网部署。`;
  run('gh', ['release', 'create', tag, ...assets, 'SHA256SUMS.txt',
    '--verify-tag', ...(stable ? ['--latest'] : ['--prerelease', '--latest=false']),
    '--title', `Note Portal ${tag} (Windows ${channel})`, '--notes', notes, '--generate-notes'],
  { cwd: directory, stdio: 'inherit' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] === '--check-tag') releaseChannel(process.argv[3]);
  else publishRelease(process.argv[2], resolve(process.argv[3] || 'release'));
}
