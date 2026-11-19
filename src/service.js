import { Worker } from 'node:worker_threads';
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ACTIVE_DAYS_OPTIONS, DEFAULT_MAX_DEPTH, classify } from './discover.js';

const CONFIG_VERSION = 1;
const INDEX_VERSION = 1;
const DEFAULT_TTL_MS = 10 * 60 * 1000;

export function dataHome() {
	return process.env.DSH_HOME || join(homedir(), '.dsh');
}

export function storeDirectory(home = dataHome()) {
	return join(home, 'storages', 'project-radar');
}

function defaultConfig() {
	return { roots: [homedir()], activeDays: 7, maxDepth: DEFAULT_MAX_DEPTH };
}

function sanitizeConfig(value) {
	const config = defaultConfig();
	if (Array.isArray(value?.roots)) {
		const roots = value.roots.filter((root) => typeof root === 'string' && root.trim().length > 0);
		if (roots.length) config.roots = roots;
	}
	if (ACTIVE_DAYS_OPTIONS.includes(value?.activeDays)) config.activeDays = value.activeDays;
	if (
		Number.isInteger(value?.maxDepth) &&
		value.maxDepth >= 2 &&
		value.maxDepth <= 8
	)
		config.maxDepth = value.maxDepth;
	return config;
}

function expandRoot(root) {
	const trimmed = root.trim();
	if (trimmed === '~') return homedir();
	if (trimmed.startsWith('~/')) return join(homedir(), trimmed.slice(2));
	return trimmed;
}

function httpError(statusCode, message) {
	return Object.assign(new Error(message), { statusCode });
}

export class ProjectRadarService {
	constructor({
		storeDir = storeDirectory(),
		ttlMs = DEFAULT_TTL_MS,
		scanFn,
		config: initialConfig,
	} = {}) {
		this.storeDir = storeDir;
		this.ttlMs = ttlMs;
		this.scanFn = typeof scanFn === 'function' ? scanFn : null; // 测试注入；生产走 worker
		this.config = sanitizeConfig(initialConfig);
		this.index = null;
		this.memoryAt = 0;
		this.scanning = false;
		this.progress = { done: 0, total: 0 };
		this.pending = null;
		this.worker = null;
		this.nextId = 0;
		this.disposed = false;
		this.load();
	}

	load() {
		try {
			const raw = JSON.parse(readFileSync(join(this.storeDir, 'config.json'), 'utf8'));
			if (raw?.version === CONFIG_VERSION) this.config = sanitizeConfig(raw);
		} catch {
			// 首次运行无配置文件，保持默认
		}
		try {
			const raw = JSON.parse(readFileSync(join(this.storeDir, 'index.json'), 'utf8'));
			if (raw?.version === INDEX_VERSION && Array.isArray(raw.repos)) {
				this.index = raw;
				this.memoryAt = Date.now();
			}
		} catch {
			// 无索引或损坏：视为首扫
		}
	}

	publicConfig() {
		return { ...this.config };
	}

	snapshot({ stale = false } = {}) {
		const repos = this.index?.repos ?? [];
		const { stats } = classify(repos, { now: Date.now(), activeDays: this.config.activeDays });
		return {
			scanning: this.scanning,
			progress: { ...this.progress },
			stale,
			generatedAt: this.index?.generatedAt ?? null,
			config: this.publicConfig(),
			stats,
			repos,
			diagnostics: this.index?.diagnostics ?? [],
			gitAvailable: this.index?.gitAvailable ?? true,
		};
	}

	getData({ refresh = false } = {}) {
		if (this.disposed) throw httpError(503, '项目雷达已卸载');
		const fresh = this.index && !this.scanning && Date.now() - this.memoryAt < this.ttlMs;
		if (!refresh && fresh) return this.snapshot();
		if (!this.scanning) this.startScan();
		if (!this.index) return this.snapshot();
		return this.snapshot({ stale: true });
	}

	startScan() {
		if (this.scanning || this.disposed) return;
		this.scanning = true;
		this.progress = { done: 0, total: 0 };
		const id = ++this.nextId;
		let resolveDone;
		const done = new Promise((resolve) => {
			resolveDone = resolve;
		});
		this.pending = { id, resolveDone, done };
		if (this.scanFn) {
			Promise.resolve()
				.then(() =>
					this.scanFn({
						roots: this.config.roots,
						maxDepth: this.config.maxDepth,
						onProgress: (doneCount, total) => {
							if (this.pending?.id === id) this.progress = { done: doneCount, total };
						},
					})
				)
				.then((payload) => {
					if (this.pending?.id === id) this.finishScan(payload);
					else this.scanning = false;
				})
				.catch((error) => {
					if (this.pending?.id === id)
						this.finishScan({
							repos: [],
							diagnostics: [{ kind: 'scan-failed', message: error.message }],
							gitAvailable: false,
						});
				});
			return;
		}
		this.ensureWorker();
		this.worker.postMessage({ id, roots: this.config.roots, maxDepth: this.config.maxDepth });
	}

	whenIdle() {
		return this.pending?.done ?? Promise.resolve();
	}

	finishScan(payload) {
		this.pending?.resolveDone();
		this.pending = null;
		this.scanning = false;
		this.progress = { done: payload.total ?? payload.repos.length, total: payload.total ?? payload.repos.length };
		this.index = {
			version: INDEX_VERSION,
			generatedAt: Date.now(),
			config: this.publicConfig(),
			repos: payload.repos ?? [],
			diagnostics: payload.diagnostics ?? [],
			gitAvailable: payload.gitAvailable ?? true,
		};
		this.memoryAt = Date.now();
		this.persistJson('index.json', this.index);
	}

	handleWorkerMessage(message) {
		if (this.pending?.id !== message.id) return;
		if (message.type === 'progress') {
			this.progress = { done: message.done, total: message.total };
			return;
		}
		if (message.type === 'result') this.finishScan(message.data);
	}

	ensureWorker() {
		if (this.worker) return;
		const worker = new Worker(new URL('./worker.js', import.meta.url));
		worker.unref();
		this.worker = worker;
		worker.on('message', (message) => this.handleWorkerMessage(message));
		const fail = () => {
			if (this.worker !== worker) return;
			this.worker = null;
			if (this.scanning && this.pending)
				this.finishScan({
					repos: [],
					diagnostics: [{ kind: 'worker-exited' }],
					gitAvailable: false,
				});
		};
		worker.on('error', fail);
		worker.on('exit', fail);
	}

	updateConfig(patch = {}) {
		if (this.disposed) throw httpError(503, '项目雷达已卸载');
		const next = { ...this.config };
		if (patch.roots !== undefined) {
			if (
				!Array.isArray(patch.roots) ||
				!patch.roots.every((root) => typeof root === 'string' && root.trim().length > 0)
			)
				throw httpError(400, 'roots 必须为非空字符串数组');
			const roots = patch.roots.map(expandRoot);
			if (!roots.length) throw httpError(400, 'roots 不能为空');
			next.roots = roots;
		}
		if (patch.activeDays !== undefined) {
			if (!ACTIVE_DAYS_OPTIONS.includes(patch.activeDays))
				throw httpError(400, 'activeDays 仅支持 7/14/30');
			next.activeDays = patch.activeDays;
		}
		if (patch.maxDepth !== undefined) {
			const depth = Number(patch.maxDepth);
			if (!Number.isInteger(depth) || depth < 2 || depth > 8)
				throw httpError(400, 'maxDepth 取值 2~8');
			next.maxDepth = depth;
		}
		this.config = next;
		this.persistJson('config.json', { version: CONFIG_VERSION, ...this.publicConfig() });
		this.memoryAt = 0; // 配置变更使缓存过期
		this.startScan();
		return this.publicConfig();
	}

	// 动作组：输入校验 → 索引授权（防任意路径注入）→ 平台能力；顺序不随平台变化，测试可移植。
	async openRepo({ path, action } = {}) {
		if (typeof path !== 'string' || path.length === 0) throw httpError(400, '缺少 path');
		if (action !== 'finder' && action !== 'terminal')
			throw httpError(400, 'action 仅支持 finder/terminal');
		if (!this.index?.repos?.some((record) => record.path === path))
			throw httpError(403, '目标不在索引内，拒绝打开');
		if (process.platform !== 'darwin') throw httpError(400, '动作组当前仅支持 macOS');
		const args = action === 'finder' ? [path] : ['-a', 'Terminal', path];
		await new Promise((resolve, reject) => {
			execFile('open', args, { timeout: 5000, windowsHide: true }, (error) => {
				if (error) reject(httpError(500, `打开失败：${error.message}`));
				else resolve();
			});
		});
	}

	persistJson(name, value) {
		mkdirSync(this.storeDir, { recursive: true });
		const file = join(this.storeDir, name);
		const tmp = `${file}.tmp`;
		writeFileSync(tmp, JSON.stringify(value));
		renameSync(tmp, file);
	}

	async dispose() {
		this.disposed = true;
		if (this.pending) {
			this.pending.resolveDone();
			this.pending = null;
		}
		this.scanning = false;
		const worker = this.worker;
		this.worker = null;
		await worker?.terminate();
	}
}
