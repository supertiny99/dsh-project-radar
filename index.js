import { ProjectRadarService } from './src/service.js';

export const name = '@supertiny99/dsh-project-radar';

function readJsonBody(req, limit = 1024 * 1024) {
	return new Promise((resolve, reject) => {
		const sizeLimitError = () =>
			Object.assign(new Error('请求体过大'), { statusCode: 413 });
		let size = 0;
		const chunks = [];
		req.on('data', (chunk) => {
			size += chunk.length;
			if (size > limit) {
				reject(sizeLimitError());
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on('end', () => {
			if (!chunks.length)
				return reject(Object.assign(new Error('缺少请求体'), { statusCode: 400 }));
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
			} catch {
				reject(Object.assign(new Error('请求体不是合法 JSON'), { statusCode: 400 }));
			}
		});
		req.on('error', reject);
	});
}

export function apply(ctx, config) {
	ctx.inject(['webServer'], (scope) => {
		scope.effect(() => {
			const service = new ProjectRadarService(config ?? {});
			const unregister = scope.webServer.register({
				kind: 'prefix',
				path: '/project-radar',
				handler: async (req, res) => {
					const json = (code, value) => {
						if (res.destroyed || res.writableEnded) return;
						res.writeHead(code, {
							'content-type': 'application/json; charset=utf-8',
							'cache-control': 'no-store',
						});
						res.end(JSON.stringify(value));
					};
					try {
						const url = new URL(req.url ?? '/', 'http://dsh.invalid');
						const path = url.pathname.replace(/^\/project-radar/, '');
						if (req.method === 'GET' && /^\/data\/?$/.test(path)) {
							return json(200, {
								ok: true,
								...service.getData({ refresh: url.searchParams.get('refresh') === '1' }),
							});
						}
						if (req.method === 'POST' && /^\/config\/?$/.test(path)) {
							const body = await readJsonBody(req);
							return json(200, { ok: true, config: service.updateConfig(body) });
						}
						if (req.method === 'POST' && /^\/open\/?$/.test(path)) {
							const body = await readJsonBody(req);
							await service.openRepo(body);
							return json(200, { ok: true });
						}
						return json(404, { ok: false, error: 'unknown action' });
					} catch (error) {
						json(error.statusCode ?? 500, { ok: false, error: error.message });
					}
				},
			});
			return () => {
				unregister();
				return service.dispose();
			};
		});
	});
}
