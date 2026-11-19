# @supertiny99/dsh-project-radar

DSH 本地项目雷达：发现并索引散落在磁盘各处的 git 仓库，在一张整页面板里完成"分诊 — 检索 — 打开"。

## 解决什么问题

电脑里散落着几十上百个项目仓库，找不到、分不清、记不起改到哪。项目雷达打开面板即回答：

- **哪些值得看**：按最近活跃分层（活跃 / 待处理 / 休眠）
- **哪些有风险**：无远程备份（仅本机一份）、同名多副本
- **上次改到哪了**：详情卡展示分支、未提交数、README 摘要、最近 5 次提交
- **直接到位**：复制路径 / Finder 打开 / 终端打开

## 特性

- 零配置开箱即用：默认扫描家目录（深度 5），点目录与 `node_modules` 等噪音目录自动排除
- 每仓库 3 秒探测熔断：超大仓库（如开源大仓克隆）不会拖垮整次扫描，超时仓库降级呈现并带标记
- 索引原子写落盘：二次打开秒级呈现缓存，后台自动增量重扫（stale-while-revalidate）
- 双主题自适应：全部颜色走宿主 `--dsw-*` token，明暗主题零成本跟随
- 只读安全：扫描不写入任何仓库；"打开"动作仅允许索引内路径

## 安装

DSH 桌面版插件页添加 npm 包：`@supertiny99/dsh-project-radar`，或使用 tgz / git 仓库 spec。

## 使用

侧栏「项目」图标进入面板：

- 顶部统计条 + 搜索（名称 / 路径 / 远程 / 分支）+ 筛选胶囊（全部 / 活跃 / 待处理 / 休眠 / 无远程 / 同名）
- 位置维度筛选：仓库所在的第一层目录（Myproject / projects 等）
- 点击行展开详情卡与动作组
- 右上角设置：扫描根目录（每行一个，支持 `~`）、活跃口径（7 / 14 / 30 天）、扫描深度（2~8 层）

## 数据与隐私

- 索引与配置存于 `~/.dsh/storages/project-radar/`（index.json + config.json，原子写）
- 扫描只读取目录结构与 git 元数据（分支 / 状态 / 提交头 / README 首段），不上传任何数据

## 开发

```bash
pnpm install     # 安装构建依赖（esbuild / react）
pnpm run build   # 构建 + selfcheck
pnpm run watch   # 监听构建
pnpm test        # 单元测试（node --test）
pnpm run preflight  # 发布前门禁（构建 + 测试 + pack 白名单核验）
```

调试走 Dev 沙盒：`DSH_HOME=~/.dsh-dev` 下以 `link:` spec 安装本目录（见仓库 `scripts/dsh-dev.sh`）。

## 许可

MIT
