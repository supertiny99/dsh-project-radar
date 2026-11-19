import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { ProjectRadarService } from '../src/service.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeRecord(path, overrides = {}) {
	return {
		path,
		name: path.split('/').pop(),
		group: null,
		branch: 'main',
		remoteUrl: 'https://example.com/x.git',
		dirtyCount: 0,
		lastCommitAt: Date.now(),
		lastCommitSubject: 'init',
		commits: [],
		readme: null,
		timedOut: false,
		probeMs: 1,
		...overrides,
	};
}

function scanFnFactory(records) {
	const calls = { count: 0 };
	const scanFn = async ({ roots, maxDepth, onProgress }) => {
		calls.count += 1;
		calls.lastRoots = roots;
		calls.lastMaxDepth = maxDepth;
		onProgress?.(records.length, records.length);
		return { repos: records, diagnostics: [], gitAvailable: true };
	};
	return { scanFn, calls };
}

function fixture() {
	return mkdtempSync(join(tmpdir(), 'radar-service-'));
}

test('首扫：无数据时空态扫描，完成后内存与落盘可用', async () => {
	const storeDir = fixture();
	const { scanFn } = scanFnFactory([makeRecord('/tmp/demo-a')]);
	const service = new ProjectRadarService({ storeDir, scanFn });
	try {
		const first = service.getData();
		assert.equal(first.scanning, true);
		assert.equal(first.stats.total, 0);
		assert.equal(first.gitAvailable, true);
		await service.whenIdle();
		const second = service.getData();
		assert.equal(second.scanning, false);
		assert.equal(second.stats.total, 1);
		assert.ok(second.generatedAt > 0);
	} finally {
		await service.dispose();
		rmSync(storeDir, { recursive: true, force: true });
	}
});

test('TTL：窗口内复用缓存不重扫，过期后自动后台重扫并标 stale', async () => {
	const storeDir = fixture();
	const { scanFn, calls } = scanFnFactory([makeRecord('/tmp/demo-b')]);
	const service = new ProjectRadarService({ storeDir, ttlMs: 80, scanFn });
	try {
		await service.getData();
		await service.whenIdle();
		assert.equal(calls.count, 1);
		const cached = service.getData();
		assert.equal(cached.scanning, false);
		assert.equal(cached.stale, false);
		assert.equal(calls.count, 1);
		await sleep(120);
		const stale = service.getData();
		assert.equal(stale.stale, true);
		assert.equal(stale.scanning, true);
		assert.equal(stale.stats.total, 1); // 旧索引照常可用
		await service.whenIdle();
		assert.equal(calls.count, 2);
	} finally {
		await service.dispose();
		rmSync(storeDir, { recursive: true, force: true });
	}
});

test('refresh=1 强制重扫；配置变更持久化并触发重扫；非法配置 400', async () => {
	const storeDir = fixture();
	const { scanFn, calls } = scanFnFactory([makeRecord('/tmp/demo-c')]);
	const service = new ProjectRadarService({ storeDir, ttlMs: 600000, scanFn });
	try {
		await service.getData();
		await service.whenIdle();
		assert.equal(calls.count, 1);
		const refreshed = service.getData({ refresh: true });
		assert.equal(refreshed.scanning, true);
		await service.whenIdle();
		assert.equal(calls.count, 2);
		const config = service.updateConfig({ activeDays: 30, maxDepth: 4, roots: ['~/proj'] });
		assert.equal(config.activeDays, 30);
		assert.equal(config.maxDepth, 4);
		assert.equal(config.roots[0], join(homedir(), 'proj'));
		await service.whenIdle();
		assert.equal(calls.count, 3);
		assert.deepEqual(calls.lastRoots, [join(homedir(), 'proj')]);
		assert.equal(calls.lastMaxDepth, 4);
		assert.throws(() => service.updateConfig({ activeDays: 5 }), /仅支持/);
		assert.throws(() => service.updateConfig({ roots: 'not-array' }), /数组/);
		assert.throws(() => service.updateConfig({ maxDepth: 99 }), /2~8/);
		// 配置落盘：新实例读回
		const reloaded = new ProjectRadarService({ storeDir, ttlMs: 600000, scanFn });
		assert.equal(reloaded.publicConfig().activeDays, 30);
		await reloaded.dispose();
	} finally {
		await service.dispose();
		rmSync(storeDir, { recursive: true, force: true });
	}
});

test('重启持久化：新实例直接从磁盘索引呈现，无需等待扫描', async () => {
	const storeDir = fixture();
	const first = new ProjectRadarService({
		storeDir,
		scanFn: async () => ({ repos: [makeRecord('/tmp/demo-d')], diagnostics: [], gitAvailable: true }),
	});
	await first.getData();
	await first.whenIdle();
	await first.dispose();
	const failScan = async () => {
		throw new Error('不应触发扫描');
	};
	const second = new ProjectRadarService({ storeDir, ttlMs: 600000, scanFn: failScan });
	try {
		const snap = second.getData();
		assert.equal(snap.scanning, false);
		assert.equal(snap.stats.total, 1);
		assert.equal(snap.repos[0].path, '/tmp/demo-d');
	} finally {
		await second.dispose();
		rmSync(storeDir, { recursive: true, force: true });
	}
});

test('open 动作守卫：非索引路径 403、非法 action/缺 path 400', async () => {
	const storeDir = fixture();
	const { scanFn } = scanFnFactory([makeRecord('/tmp/demo-e')]);
	const service = new ProjectRadarService({ storeDir, scanFn });
	try {
		await service.whenIdle();
		await assert.rejects(
			service.openRepo({ path: '/etc/passwd', action: 'finder' }),
			/不在索引内/
		);
		await assert.rejects(service.openRepo({ path: '/tmp/demo-e', action: 'shell' }), /仅支持/);
		await assert.rejects(service.openRepo({ action: 'finder' }), /缺少 path/);
	} finally {
		await service.dispose();
		rmSync(storeDir, { recursive: true, force: true });
	}
});

test('卸载：getData 拒绝且 pending 清理', async () => {
	const storeDir = fixture();
	const service = new ProjectRadarService({ storeDir, scanFn: async () => ({ repos: [], diagnostics: [] }) });
	const idle = service.whenIdle();
	await service.dispose();
	await idle;
	assert.throws(() => service.getData(), /已卸载/);
	assert.equal(service.scanning, false);
	rmSync(storeDir, { recursive: true, force: true });
});
