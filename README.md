# Launchline

一个基于 Vue 3 的本地一键部署工具，负责项目检查、提交推送、代码合并和测试/生产发布。

## 已实现

- 支持输入完整路径、拖入文件夹，或调用 Windows/macOS 原生目录选择器选择项目
- 支持一次选择或拖入多个项目，也可粘贴多行项目路径；项目标签支持拖动排序并记住已发布项目的顺序
- 每个项目可配置开发分支（默认 `dev`），支持一键切换、从本地分支选择，或执行 `git switch -c` 创建新分支
- 成功发布的项目会保存到本机历史并在下次启动时自动恢复；目录失效时会提示并自动删除记录
- 读取仓库根目录、当前分支、提交和远程地址
- 在 `main` / `master` 分支显示常驻警告并锁定部署
- 通过 `git status --porcelain` 检查工作区，有改动时在部署前自动提交；工作区或暂存区仅包含干净子模块的 Gitlink 更新时自动生成 `chore: 更新子包引用至 path@commit`，其他已有改动由用户填写提交信息
- 对非 Git 目录禁用全部部署功能
- 支持执行 `git submodule update --remote --recursive`
- 可选将已有的 `package.json#owner` 同步为当前仓库生效的 `git config user.name`
- `owner` 缺失或已与 Git 用户名一致时不会修改文件
- 提供绑定到仓库根目录的 CMD 终端，可执行切换分支等人工命令
- 终端支持命令输出、退出码、耗时、历史回看与清屏
- 命令完成后自动刷新分支和工作区状态
- 页面重新获得焦点时自动刷新仓库状态
- 支持多个项目同时部署，每个任务使用独立状态轮询
- 运行中的部署可收起到右下角任务托盘，点击项目可恢复完整步骤和日志
- 页面刷新后可恢复当前本地服务进程保存的部署任务

## 一键部署流程

部署命令、参数、交互回答、超时和轮询次数都位于 `deploy.workflow.json`，服务会在每次启动部署任务时重新读取该文件。带有 `interactive: true` 的命令通过系统伪终端运行，可以正常响应 `crs2` 的交互式问题。

默认顺序：

1. 按部署选项更新子包和 package owner
2. 工作区有改动时使用用户填写的信息提交；工作区干净时无需填写，部署选项产生的新改动使用配置中的默认信息
3. 执行 `git fetch origin --prune` 并推送当前分支
4. 执行 `crs2 em` 创建合并；遇到 GitLab 分支同步延迟时每 10 秒重试，最多执行 3 次
5. 切换 `master`，轮询 `git pull` 直到包含来源分支提交
6. 执行国内测试环境的 `mtat-prod` 发布
7. 每分钟尝试一次国内生产发布，最多 10 次

部署任务在本地服务后台运行，界面每秒读取一次步骤和日志状态，并支持取消当前任务。

部署确认前会在项目根目录执行 `crs2 show project --showOwner`。中文 Owner 与 Git 用户名的对应关系维护在 `project-owner-map.json`；当前 Git 用户不是 Owner 时必须选择审核人，界面会提示通知该审核人，`crs2 em` 出现审核人选择问题时会选择同一个人。

Merge 标题默认接受 `crs2 em` 内置 AI 生成的默认值，无需填写，生成内容会在实时命令日志中回显。关闭“优先使用 crs2 AI”后才要求填写 Angular 风格标题；Merge 描述始终可选。

当前 `crs2 1.2.5` 的测试和生产发布统一使用交互式命令 `crs2 er`：测试依次选择“国内(测试)”和 `mtat-prod`；生产选择“国内(PROD)”后通常直接确认，若个别项目仍出现任务问题则选择 `mtat-prod`。

## 运行

需要 Node.js、pnpm 和 Git。

```powershell
pnpm install
pnpm dev
```

开发地址为 `http://127.0.0.1:5173`。

生产模式：

```powershell
pnpm build
pnpm start
```

生产地址为 `http://127.0.0.1:4174`。

## Electron 桌面端

启动本地桌面版本：

```powershell
pnpm desktop:dev
```

桌面端支持将项目文件夹拖到主窗口或应用图标上打开。存在部署中的任务时，关闭主窗口会保留桌面悬浮球和系统托盘入口；点击悬浮球可恢复主窗口，也可以单独隐藏悬浮球。任务成功、失败或取消后会发送系统通知。

Windows 安装版会在启动约 8 秒后检查 GitHub Releases，之后每 4 小时检查一次。发现新版本时先提示用户下载，下载完成后提示重启安装。开发模式不会检查更新。

构建当前平台的未安装目录：

```powershell
pnpm dist:desktop
```

macOS 安装包需要在 macOS 上执行，产物为同时支持 Apple Silicon 和 Intel 的 Universal `.dmg` 与 `.zip`：

```bash
pnpm dist:mac
```

也可以将项目推送到 GitHub 后，在 Actions 中手动运行 `Build macOS installer`，构建结果会保存为 `launchline-macos-universal` artifact。

## 发布 Windows 更新

自动更新使用公开仓库 `darlingggg/crs2-script` 的 GitHub Releases。发布新版本时先提交代码，再执行：

```bash
pnpm version patch --no-git-tag-version
git add package.json pnpm-lock.yaml
git commit -m "chore: release v0.1.2"
git tag v0.1.2
git push origin main --follow-tags
```

标签版本必须与 `package.json#version` 一致。`Release Windows` Actions 会构建 NSIS 安装包，并上传安装包、blockmap 和 `latest.yml`；已安装的应用通过这些文件检查并下载更新。

`0.1.0` 没有自动更新模块，需要手动安装一次最新版本。从 `0.1.1` 开始，后续版本会自动提示更新。Windows 代码签名尚未配置，因此系统仍可能显示未知发布者提示；正式分发前建议配置代码签名证书。

从 Finder 启动时，应用会读取用户登录 shell 的 `PATH`，以便使用终端中安装的 `git` 和 `crs2`。未签名的本地构建首次打开时仍可能需要在“系统设置 > 隐私与安全性”中确认。

## 当前边界

真实的企业 GitLab 合并和发布依赖目标网络、登录状态及项目权限。调整 `deploy.workflow.json` 后不需要重新构建前端，下一次部署会直接读取新配置。
