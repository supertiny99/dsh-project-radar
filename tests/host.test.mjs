import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { apply } from '../index.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('Host HTTP 入口：data/config/open 协议、非法输入与路由清理', async () => {
	const storeDir = mkdtempSync(join(tmpdir(), 'radar-host-'));
	let cleanup;
	let route;
	let unregistered = false;
	const context = {
		inject(names, callback) {
			callback(this);
		},
		effect(callback) {
			cleanup = callback();
		},
		webServer: {
			register(options) {
				route = options;
				return () => {
					unregistered = true;
				};
			},
		},
	};
	const scanFn = async () => ({
		repos: [
			{
				path: '/tmp/radar-host-repo',
				name: 'radar-host-repo',
				group: null,
				branch: 'main',
				remoteUrl: null,
				dirtyCount: 2,
				lastCommitAt: Date.now(),
				lastCommitSubject: 'init',
				commits: [],
				readme: null,
				timedOut: false,
				probeMs: 1,
			},
		],
		diagnostics: [],
		gitAvailable: true,
	});
	const server = createServer((req, res) => route.handler(req, res));
	try {
		apply(context, { storeDir, ttlMs: 600000, scanFn });
		server.listen(0, '127.0.0.1');
		await once(server, 'listening');
		const base = `http://127.0.0.1:${server.address().port}/project-radar`;

		const first = await (await fetch(`${base}/data`)).json();
		assert.equal(first.ok, true);
		assert.equal(first.scanning, true);
		assert.ok('stats' in first && 'repos' in first && 'config' in first);
		for (let i = 0; i < 50 && first.scanning; i++) {
			await sleep(20);
			Object.assign(first, await (await fetch(`${base}/data`)).json());
		}
		assert.equal(first.scanning, false);
		assert.equal(first.stats.total, 1);
		assert.equal(first.stats.pending, 1);
		assert.equal(first.stats.noRemote, 1);

		const configured = await (
			await fetch(`${base}/config`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ activeDays: 30 }),
			})
		).json();
		assert.equal(configured.ok, true);
		assert.equal(configured.config.activeDays, 30);

		const badConfig = await fetch(`${base}/config`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ activeDays: 99 }),
		});
		assert.equal(badConfig.status, 400);
		assert.equal((await badConfig.json()).ok, false);

		const noBody = await fetch(`${base}/config`, { method: 'POST' });
		assert.equal(noBody.status, 400);

		const injection = await fetch(`${base}/open`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ path: '/etc', action: 'finder' }),
		});
		assert.equal(injection.status, 403);

		const badAction = await fetch(`${base}/open`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ path: '/tmp/radar-host-repo', action: 'shell' }),
		});
		assert.equal(badAction.status, 400);

		assert.equal((await fetch(`${base}/other`)).status, 404);
		assert.equal((await fetch(`${base}/data`, { method: 'POST' })).status, 404);

		await cleanup();
		assert.ok(unregistered);
	} finally {
		await cleanup?.();
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
		rmSync(storeDir, { recursive: true, force: true });
	}
});
