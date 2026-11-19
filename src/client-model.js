// 前端侧模型工具（浏览器安全，禁止引入 node 模块）。
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
