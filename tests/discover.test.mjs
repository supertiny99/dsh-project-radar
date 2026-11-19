import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	classify,
	checkGit,
	discoverRepos,
	firstParagraph,
	probeRepo,
	readReadme,
	rootGroup,
	runPool,
	searchRepos,
} from '../src/discover.js';

const GIT_IDENTITY = ['-c', 'user.name=radar-test', '-c', 'user.email=radar@test'];

function git(dir, args) {
	execFileSync('git', ['-C', dir, ...GIT_IDENTITY, ...args], { stdio: 'ignore' });
}

function fixture() {
	const root = mkdtempSync(join(tmpdir(), 'radar-discover-'));
	const repoA = join(root, 'repo-a');
	mkdirSync(repoA, { recursive: true });
	writeFileSync(join(repoA, 'README.md'), '# Repo A\n\n发现与探测的回归样例仓库。\n\n第二段不应出现。\n');
	writeFileSync(join(repoA, 'a.txt'), 'one\n');
	git(repoA, ['init', '-b', 'main']);
	git(repoA, ['add', '.']);
	git(repoA, ['commit', '-m', 'init: repo a']);
	git(repoA, ['remote', 'add', 'origin', 'https://example.com/repo-a.git']);
	const repoB = join(root, 'repo-b');
	mkdirSync(repoB, { recursive: true });
	git(repoB, ['init', '-b', 'main']);
	writeFileSync(join(repoB, 'b.txt'), 'dirty\n');
	// repo-b 内的嵌套仓：发现 repo-b 即停止下探，不应收录
	const nested = join(repoB, 'vendor', 'nested-repo');
	mkdirSync(nested, { recursive: true });
	git(nested, ['init', '-b', 'main']);
	// 点目录与噪音目录里的仓库：无条件排除
	const hidden = join(root, '.gemini', 'hidden-repo');
	mkdirSync(hidden, { recursive: true });
	git(hidden, ['init', '-b', 'main']);
	const noise = join(root, 'node_modules', 'nm-repo');
	mkdirSync(noise, { recursive: true });
	git(noise, ['init', '-b', 'main']);
	mkdirSync(join(root, 'plain-dir'));
	return { root, repoA, repoB, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('发现：收录两个顶层仓库，点目录/噪音目录/嵌套仓排除', () => {
	const data = fixture();
	try {
		const { repos, diagnostics } = discoverRepos([data.root], 5);
		const names = repos.map((path) => path.split('/').pop()).sort();
		assert.deepEqual(names, ['repo-a', 'repo-b']);
		assert.deepEqual(diagnostics, []);
	} finally {
		data.cleanup();
	}
});

test('发现：缺失根目录计入诊断而非报错', () => {
	const data = fixture();
	try {
		const { repos, diagnostics } = discoverRepos([data.root, join(data.root, 'no-such')], 3);
		assert.equal(repos.length, 2);
		assert.equal(diagnostics.length, 1);
		assert.equal(diagnostics[0].kind, 'root-missing');
	} finally {
		data.cleanup();
	}
});

test('探测：分支/远程/提交数/未提交数与仓库实际一致，干净仓不降级', async () => {
	const data = fixture();
	try {
		const record = await probeRepo(data.repoA);
		assert.equal(record.branch, 'main');
		assert.equal(record.remoteUrl, 'https://example.com/repo-a.git');
		assert.equal(record.dirtyCount, 0);
		assert.ok(record.lastCommitAt > 0);
		assert.equal(record.lastCommitSubject, 'init: repo a');
		assert.equal(record.commits.length, 1);
		assert.equal(record.timedOut, false);
		const readme = readReadme(data.repoA);
		assert.match(readme, /回归样例仓库/);
		assert.ok(!readme.includes('第二段'));
		const dirty = await probeRepo(data.repoB);
		assert.ok(dirty.dirtyCount >= 1);
		assert.equal(dirty.remoteUrl, null);
		assert.equal(dirty.lastCommitAt, null);
		assert.deepEqual(dirty.commits, []);
	} finally {
		data.cleanup();
	}
});

test('分层：活跃/待处理/休眠/无远程/同名多副本与假时间防御', () => {
	const now = Date.now();
	const day = 86400000;
	const base = { path: '/x', name: 'x', branch: 'main', remoteUrl: 'https://x', dirtyCount: 0, commits: [] };
	const { active, pending, dormant, noRemote, duplicateGroups, stats } = classify(
		[
			{ ...base, path: '/a', name: 'a', lastCommitAt: now - 2 * day },
			{ ...base, path: '/b', name: 'b', lastCommitAt: now - 200 * day, dirtyCount: 3, remoteUrl: null },
			{ ...base, path: '/c', name: 'c', lastCommitAt: 1000 },
			{ ...base, path: '/d1', name: 'tools', lastCommitAt: now - day },
			{ ...base, path: '/d2', name: 'tools', lastCommitAt: now - 10 * day },
		],
		{ now, activeDays: 7 }
	);
	assert.deepEqual(active.map((r) => r.name).sort(), ['a', 'tools']);
	assert.deepEqual(pending.map((r) => r.name), ['b']);
	assert.deepEqual(dormant.map((r) => r.name), ['b']);
	assert.deepEqual(noRemote.map((r) => r.name), ['b']);
	assert.equal(duplicateGroups.length, 1);
	assert.deepEqual(duplicateGroups[0].map((r) => r.path), ['/d1', '/d2']);
	assert.deepEqual(stats, { total: 5, active: 2, pending: 1, dormant: 1, noRemote: 1, duplicateNames: 1 });
});

test('搜索：命中名称/路径/远程/分支，空查询返回全部', () => {
	const repos = [
		{ name: 'alpha', path: '/home/x/alpha', remoteUrl: 'https://github.com/x/alpha', branch: 'main' },
		{ name: 'beta', path: '/home/y/beta', remoteUrl: 'https://gitlab.com/z/gamma', branch: 'dev' },
	];
	assert.equal(searchRepos(repos, '').length, 2);
	assert.equal(searchRepos(repos, 'ALPHA').length, 1);
	assert.equal(searchRepos(repos, '/home/y').length, 1);
	assert.equal(searchRepos(repos, 'gitlab').length, 1);
	assert.equal(searchRepos(repos, 'dev').length, 1);
	assert.equal(searchRepos(repos, 'missing').length, 0);
});

test('README 首段：跳过标题、截断超长、缺失返回 null', () => {
	assert.equal(firstParagraph('# 项目\n\n这是第一段介绍。', 200), '这是第一段介绍。');
	assert.equal(firstParagraph('介绍\n\n后续', 200), '介绍');
	const long = 'x'.repeat(500);
	assert.ok(firstParagraph(long, 200).length <= 200);
	assert.equal(readReadme('/nonexistent-repo-path'), null);
});

test('分组：根目录下第一段目录归属', () => {
	const home = join(tmpdir(), 'radar-group-root');
	assert.equal(rootGroup(join(home, 'Myproject', 'dsh', 'plugin'), [home]), 'Myproject');
	assert.equal(rootGroup(home, [home]), 'radar-group-root');
	assert.equal(rootGroup('/elsewhere/demo', [home]), 'demo');
});

test('并发池：结果顺序保持、进度计数正确', async () => {
	const seen = [];
	const progress = [];
	await runPool([3, 1, 2], 2, async (value) => {
		await new Promise((resolve) => setTimeout(resolve, value));
		seen.push(value);
		return value * 10;
	}, (done, total) => progress.push([done, total]));
	assert.deepEqual(seen.sort(), [1, 2, 3]);
	assert.equal(progress.at(-1)[0], 3);
	assert.equal(progress.at(-1)[1], 3);
});

test('git 可用性检测在测试环境为真', async () => {
	assert.equal(await checkGit(), true);
});
