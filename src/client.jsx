import React from 'react';
import * as P from '@deepseek-ai/dsh-client-ui-primitives';
import css from './style.css';
import { searchRepos } from './client-model.js';

const PANEL_ID = 'project-radar';
const FILTERS = [
	['all', '全部'],
	['active', '活跃'],
	['pending', '待处理'],
	['dormant', '休眠'],
	['noRemote', '无远程'],
	['duplicates', '同名'],
];
const Button = P.Button ?? ((props) => <button type="button" {...props} />);
const Input = P.Input ?? ((props) => <input {...props} />);

function relativeTime(at, now = Date.now()) {
	if (at == null) return '—';
	const diff = now - at;
	if (diff < 60000) return '刚刚';
	if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
	if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
	if (diff < 30 * 86400000) return `${Math.floor(diff / 86400000)} 天前`;
	const date = new Date(at);
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${date.getFullYear()}-${month}-${day}`;
}

function shortenHome(path) {
	return typeof path === 'string' && path.startsWith('/') && path.split('/').length > 3
		? path
		: path;
}

function PanelIcon({ size = 20 }) {
	return (
		<svg
			aria-hidden="true"
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.6"
			strokeLinecap="round"
		>
			<circle cx="12" cy="12" r="9" opacity="0.35" />
			<circle cx="12" cy="12" r="5.2" opacity="0.55" />
			<path d="M12 12 L19.2 6.4" />
			<circle cx="15.4" cy="14.6" r="1.5" fill="currentColor" stroke="none" />
		</svg>
	);
}

function RefreshIcon({ size = 14 }) {
	return (
		<svg
			aria-hidden="true"
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M21 12a9 9 0 1 1-2.64-6.36" />
			<path d="M21 3v6h-6" />
		</svg>
	);
}

function SettingsIcon({ size = 14 }) {
	return (
		<svg
			aria-hidden="true"
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
		>
			<path d="M4 8h10M18 8h2M4 16h2M10 16h10" />
			<circle cx="16" cy="8" r="2" />
			<circle cx="8" cy="16" r="2" />
		</svg>
	);
}

function ChevronIcon({ open, size = 12 }) {
	return (
		<svg
			aria-hidden="true"
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .2s' }}
		>
			<path d="m9 6 6 6-6 6" />
		</svg>
	);
}

function RepoRow({ repo, expanded, onToggle, onAction }) {
	const [copied, setCopied] = React.useState(false);
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(repo.path);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			onAction?.('复制失败：剪贴板不可用');
		}
	};
	return (
		<div className={`pr-row ${expanded ? 'is-open' : ''}`}>
			<button type="button" className="pr-row-head" onClick={onToggle} aria-expanded={expanded}>
				<span className="pr-chevron">
					<ChevronIcon open={expanded} />
				</span>
				<span className="pr-name">{repo.name}</span>
				{repo.timedOut ? (
					<span
						className="pr-badge pr-badge-muted"
						title="git 探测超时（3 秒熔断），仅显示基础信息；大仓或含海量未跟踪文件时属预期"
					>
						降级
					</span>
				) : null}
				<span className="pr-badge">{repo.branch}</span>
				{repo.dirtyCount != null && repo.dirtyCount > 0 ? (
					<span className="pr-badge pr-badge-solid">{repo.dirtyCount} 未提交</span>
				) : null}
				{!repo.remoteUrl ? <span className="pr-badge pr-badge-solid">无远程</span> : null}
				{repo.dirtyCount == null && !repo.timedOut ? (
					<span className="pr-badge pr-badge-muted">状态未知</span>
				) : null}
				<span className="pr-time">{relativeTime(repo.lastCommitAt)}</span>
			</button>
			{expanded ? (
				<div className="pr-detail">
					<div className="pr-detail-path" title={repo.path}>
						{shortenHome(repo.path)}
					</div>
					{repo.remoteUrl ? (
						<div className="pr-detail-remote" title={repo.remoteUrl}>
							{repo.remoteUrl}
						</div>
					) : null}
					<p className="pr-readme">{repo.readme ?? '无 README'}</p>
					<div className="pr-commits">
						{repo.commits.length ? (
							repo.commits.map((commit) => (
								<div key={commit.hash} className="pr-commit">
									<code>{commit.hash}</code>
									<span className="pr-commit-subject">{commit.subject}</span>
									<span className="pr-time">{relativeTime(commit.at)}</span>
								</div>
							))
						) : (
							<div className="pr-commit pr-commit-empty">无提交记录</div>
						)}
					</div>
					<div className="pr-actions">
						<button type="button" className="pr-action" onClick={copy}>
							{copied ? '已复制' : '复制路径'}
						</button>
						<button
							type="button"
							className="pr-action"
							onClick={() => onAction?.(null, repo, 'finder')}
						>
							Finder 打开
						</button>
						<button
							type="button"
							className="pr-action"
							onClick={() => onAction?.(null, repo, 'terminal')}
						>
							终端打开
						</button>
					</div>
				</div>
			) : null}
		</div>
	);
}

function Section({ title, hint, repos, expandedPath, onToggle, onAction, defaultOpen = true }) {
	const [open, setOpen] = React.useState(defaultOpen);
	if (!repos.length) return null;
	const body = (
		<div className="pr-rows">
			{repos.map((repo) => (
				<RepoRow
					key={repo.path}
					repo={repo}
					expanded={expandedPath === repo.path}
					onToggle={() => onToggle(repo.path)}
					onAction={onAction}
				/>
			))}
		</div>
	);
	if (!hint && defaultOpen) {
		return (
			<section className="pr-section">
				<h2 className="pr-section-title">{title}</h2>
				{body}
			</section>
		);
	}
	return (
		<section className="pr-section">
			<button type="button" className="pr-section-head" onClick={() => setOpen(!open)}>
				<ChevronIcon open={open} />
				<span className="pr-section-title">{title}</span>
				{hint ? <span className="pr-section-hint">{hint}</span> : null}
			</button>
			{open ? body : null}
		</section>
	);
}

function DuplicateGroups({ groups, expandedPath, onToggle, onAction }) {
	return groups.map((group) => (
		<Section
			key={group[0]?.name ?? 'group'}
			title={`${group[0].name}（${group.length} 份）`}
			hint="同名仓库，按路径与远程区分"
			repos={group}
			expandedPath={expandedPath}
			onToggle={onToggle}
			onAction={onAction}
		/>
	));
}

function Settings({ data, onClose, onSaved }) {
	const config = data?.config ?? {};
	const [rootsText, setRootsText] = React.useState((config.roots ?? []).join('\n'));
	const [activeDays, setActiveDays] = React.useState(config.activeDays ?? 7);
	const [maxDepth, setMaxDepth] = React.useState(config.maxDepth ?? 5);
	const [error, setError] = React.useState('');
	const [saving, setSaving] = React.useState(false);
	const save = async () => {
		setSaving(true);
		setError('');
		try {
			const response = await fetch('/project-radar/config', {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					roots: rootsText.split('\n').map((line) => line.trim()).filter(Boolean),
					activeDays,
					maxDepth: Number(maxDepth),
				}),
			});
			const body = await response.json();
			if (!response.ok || !body.ok) throw new Error(body.error || '保存失败');
			onSaved();
		} catch (failure) {
			setError(failure.message || '保存失败');
		} finally {
			setSaving(false);
		}
	};
	return (
		<div className="pr-overlay" role="presentation" onClick={onClose}>
			<div
				className="pr-modal"
				role="dialog"
				aria-label="项目雷达设置"
				onClick={(event) => event.stopPropagation()}
			>
				<h2>设置</h2>
				<label className="pr-field">
					<span>扫描根目录（每行一个，支持 ~）</span>
					<textarea
						className="pr-textarea"
						rows={5}
						value={rootsText}
						onChange={(event) => setRootsText(event.target.value)}
						spellCheck={false}
					/>
				</label>
				<label className="pr-field">
					<span>活跃口径</span>
					<div className="pr-pills">
						{[7, 14, 30].map((days) => (
							<button
								type="button"
								key={days}
								className={`pr-pill ${activeDays === days ? 'is-on' : ''}`}
								onClick={() => setActiveDays(days)}
							>
								{days} 天
							</button>
						))}
					</div>
				</label>
				<label className="pr-field">
					<span>扫描深度（2~8 层）</span>
					<Input
						className="pr-depth-input"
						type="number"
						min={2}
						max={8}
						value={maxDepth}
						onChange={(event) => setMaxDepth(event.target.value)}
					/>
				</label>
				{error ? <p className="pr-form-error">{error}</p> : null}
				<div className="pr-modal-actions">
					<button type="button" className="pr-action" onClick={onClose}>
						取消
					</button>
					<Button onClick={save} disabled={saving}>
						{saving ? '保存中' : '保存并重扫'}
					</Button>
				</div>
			</div>
		</div>
	);
}

function Workbench() {
	const [data, setData] = React.useState(null);
	const [error, setError] = React.useState('');
	const [notice, setNotice] = React.useState('');
	const [filter, setFilter] = React.useState('all');
	const [query, setQuery] = React.useState('');
	const [group, setGroup] = React.useState('');
	const [expandedPath, setExpandedPath] = React.useState(null);
	const [settingsOpen, setSettingsOpen] = React.useState(false);
	const load = React.useCallback(async (refresh = false) => {
		try {
			const response = await fetch(`/project-radar/data${refresh ? '?refresh=1' : ''}`, {
				credentials: 'same-origin',
			});
			const body = await response.json();
			if (!response.ok || !body.ok) throw new Error(body.error || '读取项目索引失败');
			setData(body);
			setError('');
		} catch (failure) {
			setError(failure.message || '读取项目索引失败');
		}
	}, []);
	React.useEffect(() => {
		void load();
	}, [load]);
	React.useEffect(() => {
		if (!data?.scanning) return undefined;
		const timer = setInterval(() => void load(), 1500);
		return () => clearInterval(timer);
	}, [data?.scanning, load]);
	React.useEffect(() => {
		const refresh = () => {
			if (!document.hidden) void load();
		};
		document.addEventListener('visibilitychange', refresh);
		window.addEventListener('focus', refresh);
		return () => {
			document.removeEventListener('visibilitychange', refresh);
			window.removeEventListener('focus', refresh);
		};
	}, [load]);

	const repos = data?.repos ?? [];
	const visible = searchRepos(
		group ? repos.filter((repo) => repo.group === group) : repos,
		query
	);
	const isSearching = query.trim().length > 0;
	const tier = React.useMemo(() => {
		// 前端按扫描结果即时归类（与服务端同口径的轻量投影），避免全量重扫才能切换筛选
		const activeUntil = Date.now() - (data?.config?.activeDays ?? 7) * 86400000;
		const dormantBefore = Date.now() - 90 * 86400000;
		const plausible = (repo) =>
			repo.lastCommitAt != null && repo.lastCommitAt >= Date.UTC(1990, 0, 1);
		const buckets = { active: [], pending: [], dormant: [], noRemote: [], duplicates: [] };
		const byName = new Map();
		for (const repo of visible) {
			if (plausible(repo) && repo.lastCommitAt >= activeUntil) buckets.active.push(repo);
			if (repo.dirtyCount != null && repo.dirtyCount > 0) buckets.pending.push(repo);
			if (plausible(repo) && repo.lastCommitAt < dormantBefore) buckets.dormant.push(repo);
			if (!repo.remoteUrl) buckets.noRemote.push(repo);
			const list = byName.get(repo.name) ?? [];
			list.push(repo);
			byName.set(repo.name, list);
		}
		buckets.active.sort((a, b) => (b.lastCommitAt ?? 0) - (a.lastCommitAt ?? 0));
		buckets.pending.sort((a, b) => (b.lastCommitAt ?? 0) - (a.lastCommitAt ?? 0));
		buckets.dormant.sort((a, b) => (a.lastCommitAt ?? 0) - (b.lastCommitAt ?? 0));
		buckets.noRemote.sort((a, b) => a.name.localeCompare(b.name));
		buckets.duplicates = [...byName.values()].filter((list) => list.length > 1);
		return buckets;
	}, [visible, data?.config?.activeDays]);

	const groups = React.useMemo(() => {
		const names = new Set(repos.map((repo) => repo.group).filter(Boolean));
		return [...names];
	}, [repos]);

	const toggle = (path) => setExpandedPath((current) => (current === path ? null : path));
	const openRepo = async (_event, repo, action) => {
		setNotice('');
		try {
			const response = await fetch('/project-radar/open', {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ path: repo.path, action }),
			});
			const body = await response.json();
			if (!response.ok || !body.ok) throw new Error(body.error || '打开失败');
		} catch (failure) {
			setNotice(failure.message || '打开失败');
		}
	};

	const stats = data?.stats ?? {};
	const activeDays = data?.config?.activeDays ?? 7;
	const activeLabel = `${activeDays} 天内活跃`;
	const progress = data?.progress ?? { done: 0, total: 0 };
	const progressPercent =
		progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : null;

	return (
		<div className="pr-root">
			<style>{css}</style>
			<header className="pr-header">
				<div className="pr-title-row">
					<div>
						<h1>项目雷达</h1>
						<p className="pr-statline">
							{stats.total ?? 0} 个仓库 · {activeLabel} {stats.active ?? 0} · 待处理{' '}
							{stats.pending ?? 0} · 休眠 {stats.dormant ?? 0} · 无远程 {stats.noRemote ?? 0}
						</p>
					</div>
					<div className="pr-header-actions">
						{data?.stale ? <span className="pr-stale">索引后台更新中</span> : null}
						<button
							type="button"
							className="pr-iconbtn"
							title="重新扫描"
							onClick={() => void load(true)}
						>
							<RefreshIcon />
						</button>
						<button
							type="button"
							className="pr-iconbtn"
							title="设置"
							onClick={() => setSettingsOpen(true)}
						>
							<SettingsIcon />
						</button>
					</div>
				</div>
				{data?.scanning ? (
					<div className="pr-progress" role="status">
						<i
							className="pr-progress-bar"
							style={{
								width: progressPercent == null ? '40%' : `${Math.max(progressPercent, 4)}%`,
							}}
						/>
						<span>
							{progress.total > 0
								? `正在扫描 ${progress.done}/${progress.total}`
								: '正在发现仓库'}
						</span>
					</div>
				) : null}
				{error ? <p className="pr-error">{error}</p> : null}
				{notice ? <p className="pr-error">{notice}</p> : null}
			</header>
			{repos.length ? (
				<>
					<div className="pr-toolbar">
						<Input
							className="pr-search"
							type="search"
							placeholder="搜索名称 / 路径 / 远程地址 / 分支"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
						/>
						<div className="pr-pills">
							{FILTERS.map(([key, label]) => (
								<button
									type="button"
									key={key}
									className={`pr-pill ${filter === key ? 'is-on' : ''}`}
									onClick={() => setFilter(key)}
								>
									{label}
								</button>
							))}
						</div>
						{groups.length > 1 ? (
							<div className="pr-pills pr-groups">
								<button
									type="button"
									className={`pr-pill ${group === '' ? 'is-on' : ''}`}
									onClick={() => setGroup('')}
								>
									全部位置
								</button>
								{groups.map((name) => (
									<button
										type="button"
										key={name}
										className={`pr-pill ${group === name ? 'is-on' : ''}`}
										onClick={() => setGroup(group === name ? '' : name)}
									>
										{name}
									</button>
								))}
							</div>
						) : null}
					</div>
					<main className="pr-body">
						{!visible.length ? (
							<p className="pr-empty">没有匹配「{query}」的仓库，换个关键词试试</p>
						) : isSearching ? (
							// 搜索词非空时平铺全部命中（含折叠区内的仓库），避免结果藏在收起的分区里
							<Section
								title={`搜索结果（${visible.length}）`}
								repos={[...visible].sort((a, b) => (b.lastCommitAt ?? 0) - (a.lastCommitAt ?? 0))}
								expandedPath={expandedPath}
								onToggle={toggle}
								onAction={openRepo}
							/>
						) : filter === 'all' ? (
							<>
								<Section
									title={activeLabel}
									repos={tier.active}
									expandedPath={expandedPath}
									onToggle={toggle}
									onAction={openRepo}
								/>
								<Section
									title="待处理 — 有未提交改动"
									repos={tier.pending}
									expandedPath={expandedPath}
									onToggle={toggle}
									onAction={openRepo}
								/>
								<Section
									title={`休眠 90 天以上（${tier.dormant.length}）`}
									hint="最久未动在前，归档候选"
									repos={tier.dormant}
									defaultOpen={false}
									expandedPath={expandedPath}
									onToggle={toggle}
									onAction={openRepo}
								/>
								<Section
									title={`无远程备份（${tier.noRemote.length}）`}
									hint="仅本机一份，建议推送远程"
									repos={tier.noRemote}
									defaultOpen={false}
									expandedPath={expandedPath}
									onToggle={toggle}
									onAction={openRepo}
								/>
								<Section
									title={`同名多副本（${tier.duplicates.length} 组）`}
									hint="按路径与远程区分"
									defaultOpen={false}
									expandedPath={expandedPath}
									onToggle={toggle}
									onAction={openRepo}
									repos={tier.duplicates.flatMap((list) => list)}
								/>
							</>
						) : filter === 'duplicates' ? (
							<DuplicateGroups
								groups={tier.duplicates}
								expandedPath={expandedPath}
								onToggle={toggle}
								onAction={openRepo}
							/>
						) : (
							<Section
								title={
									{
										active: activeLabel,
										pending: '待处理',
										dormant: `休眠 90 天以上`,
										noRemote: '无远程备份',
									}[filter]
								}
								repos={tier[filter]}
								expandedPath={expandedPath}
								onToggle={toggle}
								onAction={openRepo}
							/>
						)}
					</main>
					<footer className="pr-footer">
						{data?.gitAvailable ? null : <span>未检测到 git 命令，当前仅列出仓库位置</span>}
						{(data?.diagnostics ?? []).some((item) => item.kind === 'root-missing') ? (
							<span>部分配置的根目录不存在，可在设置中调整</span>
						) : null}
						{data?.generatedAt ? <span>更新于 {relativeTime(data.generatedAt)}</span> : null}
					</footer>
				</>
			) : data?.scanning ? (
				<p className="pr-empty">首次扫描进行中，全盘发现仓库约需数秒到一分钟……</p>
			) : (
				<div className="pr-empty pr-empty-guide">
					<p>还没有扫描结果。</p>
					<p>
						在设置里配置扫描根目录（默认家目录），即可把散落各处的 git 仓库收进一张驾驶舱。
					</p>
					<Button onClick={() => setSettingsOpen(true)}>打开设置</Button>
				</div>
			)}
			{settingsOpen ? (
				<Settings
					data={data}
					onClose={() => setSettingsOpen(false)}
					onSaved={() => {
						setSettingsOpen(false);
						setExpandedPath(null);
						void load();
					}}
				/>
			) : null}
		</div>
	);
}

class PanelBoundary extends React.Component {
	constructor(props) {
		super(props);
		this.state = { error: null };
	}
	static getDerivedStateFromError(error) {
		return { error };
	}
	render() {
		if (this.state.error)
			return (
				<div role="alert" className="pr-root">
					<style>{css}</style>
					<p>项目雷达加载失败，{this.state.error.message}</p>
					<Button onClick={() => this.setState({ error: null })}>重试</Button>
				</div>
			);
		return this.props.children;
	}
}

function Panel() {
	return (
		<PanelBoundary>
			<Workbench />
		</PanelBoundary>
	);
}

export const inject = ['slots'];
export function apply(ctx) {
	ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, Panel));
	ctx.slots.inject('sidebar.panellist', () =>
		ctx.slots.register(
			{ name: 'sidebar.panellist', id: PANEL_ID, order: 46, label: '项目' },
			PanelIcon
		)
	);
}
