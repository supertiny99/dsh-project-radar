import { parentPort, workerData } from 'node:worker_threads';
import { homedir } from 'node:os';
import {
	checkGit,
	discoverRepos,
	emptyRecord,
	probeRepo,
	PROBE_CONCURRENCY,
	readReadme,
	rootGroup,
	runPool,
} from './discover.js';

const home = homedir();

parentPort.on('message', ({ id, roots, maxDepth }) => {
	void scan(id, roots, maxDepth);
});

async function scan(id, roots, maxDepth) {
	try {
		const effectiveRoots = roots?.length ? roots : [home];
		const { repos, diagnostics } = discoverRepos(effectiveRoots, maxDepth);
		parentPort.postMessage({ id, type: 'progress', done: 0, total: repos.length });
		const gitAvailable = await checkGit();
		const records = gitAvailable
			? await runPool(
					repos,
					PROBE_CONCURRENCY,
					async (repoPath) => {
						const record = await probeRepo(repoPath);
						record.readme = readReadme(repoPath);
						record.group = rootGroup(repoPath, effectiveRoots);
						return record;
					},
					(done, total) => {
						parentPort.postMessage({ id, type: 'progress', done, total });
					}
				)
			: repos.map((repoPath) => ({
					...emptyRecord(repoPath),
					group: rootGroup(repoPath, effectiveRoots),
				}));
		parentPort.postMessage({
			id,
			type: 'result',
			data: { repos: records, diagnostics, gitAvailable, total: records.length },
		});
	} catch (error) {
		parentPort.postMessage({
			id,
			type: 'result',
			data: {
				repos: [],
				diagnostics: [{ kind: 'scan-failed', message: error.message }],
				gitAvailable: false,
				total: 0,
			},
		});
	}
}
