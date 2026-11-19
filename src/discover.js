import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, sep } from 'node:path';

// 已知噪音目录名：仓库发现时无条件跳过（点目录另按前缀统一排除，覆盖 .gemini/.codex/.claude* 等）。
export const NOISE_DIR_NAMES = new Set([
	'node_modules',
	'Library',
	'.Trash',
	'Applications',
	'Movies',
	'Music',
	'Pictures',
	'Public',
	'dist',
	'build',
	'vendor',
	'__pycache__',
	'site-packages',
	'.npm',
	'.cache',
	'.pnpm-store',
	'pnpm-store',
	'.cargo',
	'.rustup',
	'go',
	'.subrepo',
]);
export const DEFAULT_MAX_DEPTH = 5;
export const DORMANT_DAYS = 90;
export const ACTIVE_DAYS_OPTIONS = [7, 14, 30];
export const PROBE_TIMEOUT_MS = 3000;
export const PROBE_CONCURRENCY = 6;
export const COMMIT_LIMIT = 5;
export const README_MAX_CHARS = 200;
export const README_CANDIDATES = ['README.md', 'README', 'README.txt', 'readme.md'];
// 早于该时间的提交时间视为异常数据（样板仓库假时间），照常显示但不参与活跃/休眠分层。
export const MIN_PLAUSIBLE_COMMIT_MS = Date.UTC(1990, 0, 1);
const DAY_MS = 86400000;

export function emptyRecord(repoPath) {
	return {
		path: repoPath,
		name: basename(repoPath),
		group: null,
		branch: 'unknown',
		remoteUrl: null,
		dirtyCount: null,
		lastCommitAt: null,
		lastCommitSubject: null,
		commits: [],
		readme: null,
		timedOut: false,
		probeMs: 0,
	};
}

export function isRepoDir(dir) {
	return existsSync(join(dir, '.git'));
}

// 深度优先发现仓库：目录含 .git（目录或文件，worktree 兼容）即记为仓库并停止下探，
// 因此 vendored/嵌套仓与子模块不收录（P1 再议）。点目录与噪音目录无条件跳过。
export function discoverRepos(roots, maxDepth = DEFAULT_MAX_DEPTH) {
	const repos = [];
	const seen = new Set();
	const diagnostics = [];
	const visit = (dir, depth) => {
		if (isRepoDir(dir)) {
			if (!seen.has(dir)) {
				seen.add(dir);
				repos.push(dir);
			}
			return;
		}
		if (depth >= maxDepth) return;
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			diagnostics.push({ kind: 'dir-unreadable', path: dir });
			return;
		}
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			if (entry.name.startsWith('.') || NOISE_DIR_NAMES.has(entry.name)) continue;
			visit(join(dir, entry.name), depth + 1);
		}
	};
	for (const root of roots) {
		if (!isRepoDir(root) && !existsSync(root)) {
			diagnostics.push({ kind: 'root-missing', path: root });
			continue;
		}
		visit(root, 0);
	}
	return { repos, diagnostics };
}

export function checkGit(timeoutMs = 2000) {
	return new Promise((resolve) => {
		execFile('git', ['--version'], { timeout: timeoutMs, windowsHide: true }, (error) =>
			resolve(!error)
		);
	});
}

function runGit(cwd, args, timeoutMs) {
	return new Promise((resolve) => {
		execFile(
			'git',
			['-C', cwd, ...args],
			{ timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
			(error, stdout) => {
				resolve({ ok: !error, stdout: typeof stdout === 'string' ? stdout : '' });
			}
		);
	});
}

// 单仓库探测：全部命令 3s 超时熔断；status 熔断（dirtyCount 为 null）即视为该仓库降级。
export async function probeRepo(repoPath, { timeoutMs = PROBE_TIMEOUT_MS } = {}) {
	const record = emptyRecord(repoPath);
	const startedAt = Date.now();
	const branch = await runGit(repoPath, ['symbolic-ref', '--short', 'HEAD'], timeoutMs);
	if (branch.ok) {
		record.branch = branch.stdout.trim() || 'unknown';
	} else {
		const detached = await runGit(repoPath, ['rev-parse', '--short', 'HEAD'], timeoutMs);
		if (detached.ok && detached.stdout.trim()) record.branch = `(${detached.stdout.trim()})`;
	}
	const remote = await runGit(repoPath, ['config', '--get', 'remote.origin.url'], timeoutMs);
	if (remote.ok && remote.stdout.trim()) record.remoteUrl = remote.stdout.trim();
	const dirty = await runGit(repoPath, ['status', '--porcelain'], timeoutMs);
	if (dirty.ok) {
		record.dirtyCount = dirty.stdout ? dirty.stdout.split('\n').filter(Boolean).length : 0;
	} else {
		record.timedOut = true;
	}
	const last = await runGit(repoPath, ['log', '-1', '--format=%ct%x00%s'], timeoutMs);
	if (last.ok && last.stdout.trim()) {
		const [seconds, subject] = last.stdout.trim().split('\0');
		record.lastCommitAt = Number(seconds) * 1000;
		record.lastCommitSubject = subject ?? '';
	}
	const log = await runGit(repoPath, ['log', `-${COMMIT_LIMIT}`, '--format=%h%x00%ct%x00%s'], timeoutMs);
	if (log.ok) {
		record.commits = log.stdout
			.split('\n')
			.filter(Boolean)
			.map((line) => {
				const [hash, seconds, subject] = line.split('\0');
				return { hash, at: Number(seconds) * 1000, subject: subject ?? '' };
			});
	}
	record.probeMs = Date.now() - startedAt;
	return record;
}

export function readReadme(repoPath, maxChars = README_MAX_CHARS) {
	for (const name of README_CANDIDATES) {
		const file = join(repoPath, name);
		if (!existsSync(file)) continue;
		try {
			const summary = firstParagraph(readFileSync(file, 'utf8'), maxChars);
			if (summary) return summary;
		} catch {
			// 读取失败尝试下一个候选
		}
	}
	return null;
}

export function firstParagraph(text, maxChars = README_MAX_CHARS) {
	const paragraph = [];
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line) {
			if (paragraph.length) break;
			continue;
		}
		if (!paragraph.length && (/^#{1,6}\s/.test(line) || /^(-{3,}|={3,})$/.test(line))) continue;
		paragraph.push(line.replace(/^#{1,6}\s*/, '').replace(/[*_`]/g, ''));
		if (paragraph.join(' ').length >= maxChars) break;
	}
	const summary = paragraph.join(' ').slice(0, maxChars).trim();
	return summary || null;
}

// 固定并发池：按游标取任务，onProgress 上报完成数。
export async function runPool(items, limit, task, onProgress) {
	let cursor = 0;
	let done = 0;
	const results = new Array(items.length);
	const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
		while (cursor < items.length) {
			const index = cursor++;
			results[index] = await task(items[index], index);
			done += 1;
			onProgress?.(done, items.length);
		}
	});
	await Promise.all(runners);
	return results;
}

const plausible = (record) =>
	record.lastCommitAt != null && record.lastCommitAt >= MIN_PLAUSIBLE_COMMIT_MS;
const byCommitDesc = (a, b) => (b.lastCommitAt ?? 0) - (a.lastCommitAt ?? 0);
const byCommitAsc = (a, b) => (a.lastCommitAt ?? 0) - (b.lastCommitAt ?? 0);

// 分层归类（纯函数）：活跃/待处理/休眠/无远程/同名多副本；一仓可属多区。
export function classify(repos, { now = Date.now(), activeDays = 7, dormantDays = DORMANT_DAYS } = {}) {
	const activeUntil = now - activeDays * DAY_MS;
	const dormantBefore = now - dormantDays * DAY_MS;
	const active = [];
	const pending = [];
	const dormant = [];
	const noRemote = [];
	for (const record of repos) {
		if (plausible(record) && record.lastCommitAt >= activeUntil) active.push(record);
		if (record.dirtyCount != null && record.dirtyCount > 0) pending.push(record);
		if (plausible(record) && record.lastCommitAt < dormantBefore) dormant.push(record);
		if (!record.remoteUrl) noRemote.push(record);
	}
	const byName = new Map();
	for (const record of repos) {
		const list = byName.get(record.name) ?? [];
		list.push(record);
		byName.set(record.name, list);
	}
	const duplicateGroups = [...byName.values()]
		.filter((list) => list.length > 1)
		.map((list) => list.sort(byCommitDesc));
	active.sort(byCommitDesc);
	pending.sort(byCommitDesc);
	dormant.sort(byCommitAsc); // 最久未动在前，归档候选优先
	noRemote.sort((a, b) => a.name.localeCompare(b.name));
	return {
		active,
		pending,
		dormant,
		noRemote,
		duplicateGroups,
		stats: {
			total: repos.length,
			active: active.length,
			pending: pending.length,
			dormant: dormant.length,
			noRemote: noRemote.length,
			duplicateNames: duplicateGroups.length,
		},
	};
}

export function searchRepos(repos, query) {
	const q = (query ?? '').trim().toLowerCase();
	if (!q) return repos;
	return repos.filter(
		(record) =>
			record.name.toLowerCase().includes(q) ||
			record.path.toLowerCase().includes(q) ||
			(record.remoteUrl ?? '').toLowerCase().includes(q) ||
			(record.branch ?? '').toLowerCase().includes(q)
	);
}

// 仓库归属展示组：所在根目录下的第一段目录（如 ~/Myproject/... → Myproject）。
export function rootGroup(repoPath, roots) {
	for (const root of roots) {
		const prefix = root.endsWith(sep) ? root : root + sep;
		if (repoPath === root) return basename(root);
		if (repoPath.startsWith(prefix)) {
			const rest = repoPath.slice(prefix.length);
			return rest.split(sep)[0] || basename(root);
		}
	}
	return basename(repoPath);
}
