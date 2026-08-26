import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import express from 'express'
import { registerDeploymentRoutes } from './deployment.ts'

const execFileAsync = promisify(execFile)
const app = express()
const currentDir = dirname(fileURLToPath(import.meta.url))
const electronResourceDir = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
const configDir = electronResourceDir && existsSync(join(electronResourceDir, 'deploy.workflow.json'))
  ? electronResourceDir
  : join(currentDir, '..')
const deployConfigPath = join(configDir, 'deploy.workflow.json')
const ownerMapPath = join(configDir, 'project-owner-map.json')

app.use(express.json())

type GitResult = {
  path: string
  isGitRepository: boolean
  root?: string
  branch?: string
  localBranches?: string[]
  detached?: boolean
  isProtectedBranch?: boolean
  isClean?: boolean
  changes?: string[]
  commit?: string
  remote?: string
  gitUserName?: string
  packageOwner?: PackageOwnerStatus
  checkedAt?: string
  error?: string
}

type PackageOwnerStatus = {
  exists: boolean
  ownerExists: boolean
  ownerName?: string
  ownerKind?: 'string' | 'object'
  needsUpdate: boolean
  canSync: boolean
  error?: string
}

function validDirectory(path: unknown): path is string {
  if (typeof path !== 'string' || !path.trim() || !existsSync(path)) return false
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

async function gitRaw(path: string, args: string[]) {
  const { stdout } = await execFileAsync('git', ['-C', path, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  })
  return stdout
}

async function git(path: string, args: string[]) {
  return (await gitRaw(path, args)).trim()
}

async function optionalGit(path: string, args: string[]) {
  try {
    return await git(path, args)
  } catch {
    return ''
  }
}

async function inspectPackageOwner(root: string, gitUserName: string): Promise<PackageOwnerStatus> {
  const packagePath = join(root, 'package.json')
  if (!existsSync(packagePath)) {
    return { exists: false, ownerExists: false, needsUpdate: false, canSync: false }
  }

  try {
    const contents = await readFile(packagePath, 'utf8')
    const packageJson = JSON.parse(contents) as Record<string, unknown>
    if (!Object.prototype.hasOwnProperty.call(packageJson, 'owner')) {
      return { exists: true, ownerExists: false, needsUpdate: false, canSync: false }
    }

    const owner = packageJson.owner
    const ownerName = typeof owner === 'string'
      ? owner
      : owner && typeof owner === 'object' && typeof (owner as Record<string, unknown>).name === 'string'
        ? (owner as Record<string, unknown>).name as string
        : undefined
    const ownerKind = typeof owner === 'string' ? 'string' : ownerName ? 'object' : undefined

    if (!ownerName || !ownerKind) {
      return {
        exists: true,
        ownerExists: true,
        needsUpdate: false,
        canSync: false,
        error: 'owner 必须是字符串或包含 name 的对象',
      }
    }

    const needsUpdate = Boolean(gitUserName && ownerName !== gitUserName)
    return {
      exists: true,
      ownerExists: true,
      ownerName,
      ownerKind,
      needsUpdate,
      canSync: needsUpdate,
    }
  } catch {
    return {
      exists: true,
      ownerExists: false,
      needsUpdate: false,
      canSync: false,
      error: 'package.json 不是有效的 JSON',
    }
  }
}

async function inspectRepository(path: string): Promise<GitResult> {
  const normalizedPath = path.trim()
  if (!validDirectory(normalizedPath)) {
    return { path: normalizedPath, isGitRepository: false, error: '目录不存在或无法访问' }
  }

  try {
    const inside = await git(normalizedPath, ['rev-parse', '--is-inside-work-tree'])
    if (inside !== 'true') throw new Error('Not a Git working tree')

    const [root, branch, localBranchesOutput, status, commit, remote, gitUserName] = await Promise.all([
      git(normalizedPath, ['rev-parse', '--show-toplevel']),
      optionalGit(normalizedPath, ['branch', '--show-current']),
      gitRaw(normalizedPath, ['for-each-ref', '--format=%(refname:short)', '--sort=refname', 'refs/heads']),
      gitRaw(normalizedPath, ['status', '--porcelain=v1', '--untracked-files=all']).then((output) => output.trimEnd()),
      optionalGit(normalizedPath, ['rev-parse', '--short=8', 'HEAD']),
      optionalGit(normalizedPath, ['remote', 'get-url', 'origin']),
      optionalGit(normalizedPath, ['config', 'user.name']),
    ])
    const localBranches = localBranchesOutput.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
    const changes = status ? status.split(/\r?\n/).filter(Boolean) : []
    const packageOwner = await inspectPackageOwner(root, gitUserName)

    return {
      path: normalizedPath,
      isGitRepository: true,
      root,
      branch: branch || 'DETACHED HEAD',
      localBranches,
      detached: !branch,
      isProtectedBranch: branch === 'main' || branch === 'master',
      isClean: changes.length === 0,
      changes,
      commit: commit || '暂无提交',
      remote: remote || '未配置 origin',
      gitUserName,
      packageOwner,
      checkedAt: new Date().toISOString(),
    }
  } catch {
    return {
      path: normalizedPath,
      isGitRepository: false,
      error: '该目录未被 Git 管理',
      checkedAt: new Date().toISOString(),
    }
  }
}

app.get('/api/repository', async (request, response) => {
  const path = typeof request.query.path === 'string' ? request.query.path : ''
  if (!path) return response.status(400).json({ error: '请选择项目目录' })
  response.json(await inspectRepository(path))
})

app.post('/api/repository/switch-branch', async (request, response) => {
  const path = request.body?.path
  const branch = typeof request.body?.branch === 'string' ? request.body.branch.trim() : ''
  if (!validDirectory(path)) return response.status(400).json({ error: '项目目录无效' })
  if (!branch) return response.status(400).json({ error: '请选择需要切换的本地分支' })

  const before = await inspectRepository(path)
  if (!before.isGitRepository || !before.root) {
    return response.status(400).json({ error: '该目录未被 Git 管理' })
  }
  if (!before.isClean) {
    return response.status(409).json({ error: '工作区存在未提交改动，请先处理后再切换分支' })
  }
  if (!before.localBranches?.includes(branch)) {
    return response.status(400).json({ error: `本地分支不存在：${branch}` })
  }
  if (before.branch === branch) {
    return response.json({ ok: true, output: `当前已在 ${branch} 分支`, repository: before })
  }

  try {
    const { stdout, stderr } = await execFileAsync('git', ['-C', before.root, 'switch', '--', branch], {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    })
    response.json({
      ok: true,
      output: [stdout, stderr].filter(Boolean).join('\n').trim() || `已切换到 ${branch} 分支`,
      repository: await inspectRepository(before.root),
    })
  } catch (error) {
    const failure = error as { stderr?: string; message?: string }
    response.status(409).json({ error: failure.stderr?.trim() || failure.message || '分支切换失败' })
  }
})

app.post('/api/select-directory', async (request, response) => {
  const initialPath = typeof request.body?.path === 'string' ? request.body.path.trim() : ''
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync('osascript', [
        '-e',
        'POSIX path of (choose folder with prompt "选择需要部署的 Git 项目")',
      ], { encoding: 'utf8', windowsHide: true })
      return response.json({ path: stdout.trim() || null })
    } catch {
      return response.json({ path: null })
    }
  }

  if (process.platform !== 'win32') {
    try {
      const { stdout } = await execFileAsync('zenity', [
        '--file-selection',
        '--directory',
        '--title=选择需要部署的 Git 项目',
        ...(initialPath ? [`--filename=${initialPath}/`] : []),
      ], { encoding: 'utf8', windowsHide: true })
      return response.json({ path: stdout.trim() || null })
    } catch {
      return response.status(500).json({ error: '无法打开目录选择器，请直接输入项目路径' })
    }
  }

  const psScript = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$dialog.Description = '选择需要部署的 Git 项目'",
    '$dialog.ShowNewFolderButton = $false',
    'if ([System.IO.Directory]::Exists($env:LAUNCHLINE_INITIAL_PATH)) { $dialog.SelectedPath = $env:LAUNCHLINE_INITIAL_PATH }',
    'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
    '  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '  Write-Output $dialog.SelectedPath',
    '}',
  ].join('; ')

  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-STA',
      '-Command',
      psScript,
    ], {
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, LAUNCHLINE_INITIAL_PATH: initialPath },
    })
    const path = stdout.trim()
    response.json({ path: path || null })
  } catch {
    response.status(500).json({ error: '无法打开目录选择器' })
  }
})

app.post('/api/submodules/update', async (request, response) => {
  const path = request.body?.path
  if (!validDirectory(path)) return response.status(400).json({ error: '项目目录无效' })

  const before = await inspectRepository(path)
  if (!before.isGitRepository) return response.status(400).json({ error: '该目录未被 Git 管理' })

  try {
    const { stdout, stderr } = await execFileAsync(
      'git',
      ['-C', path, 'submodule', 'update', '--remote', '--recursive'],
      { encoding: 'utf8', windowsHide: true, maxBuffer: 5 * 1024 * 1024 },
    )
    response.json({
      ok: true,
      output: [stdout, stderr].filter(Boolean).join('\n').trim() || '所有子包均为最新状态',
      repository: await inspectRepository(path),
    })
  } catch (error) {
    const failure = error as { stderr?: string; message?: string }
    response.status(500).json({ error: failure.stderr?.trim() || failure.message || '子包更新失败' })
  }
})

app.post('/api/package-owner/sync', async (request, response) => {
  const path = request.body?.path
  try {
    const result = await syncPackageOwnerForRepository(path)
    response.json({ ok: true, ...result, repository: await inspectRepository(path) })
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : '无法更新 package.json' })
  }
})

async function syncPackageOwnerForRepository(path: string) {
  if (!validDirectory(path)) throw new Error('项目目录无效')

  const before = await inspectRepository(path)
  if (!before.isGitRepository || !before.root) throw new Error('该目录未被 Git 管理')
  if (!before.gitUserName) throw new Error('当前 Git 仓库未配置 user.name')

  const ownerStatus = before.packageOwner
  if (!ownerStatus?.exists) return { changed: false, message: '项目根目录没有 package.json' }
  if (!ownerStatus.ownerExists) return { changed: false, message: 'package.json 没有 owner 属性，无需修改' }
  if (ownerStatus.error) throw new Error(ownerStatus.error)
  if (!ownerStatus.needsUpdate) return { changed: false, message: 'owner 已与当前 Git 用户一致' }

  const packagePath = join(before.root, 'package.json')
  const contents = await readFile(packagePath, 'utf8')
  const packageJson = JSON.parse(contents) as Record<string, unknown>
  if (ownerStatus.ownerKind === 'object') {
    packageJson.owner = {
      ...(packageJson.owner as Record<string, unknown>),
      name: before.gitUserName,
    }
  } else {
    packageJson.owner = before.gitUserName
  }

  const newline = contents.includes('\r\n') ? '\r\n' : '\n'
  const indent = contents.match(/^[\t ]+(?=")/m)?.[0] || '  '
  const trailingNewline = contents.endsWith('\n') ? newline : ''
  const updatedContents = JSON.stringify(packageJson, null, indent).replace(/\n/g, newline) + trailingNewline
  await writeFile(packagePath, updatedContents, 'utf8')
  return { changed: true, message: `owner 已更新为 ${before.gitUserName}` }
}

app.post('/api/terminal/execute', async (request, response) => {
  const path = request.body?.path
  const command = typeof request.body?.command === 'string' ? request.body.command.trim() : ''

  if (!validDirectory(path)) return response.status(400).json({ error: '项目目录无效' })
  if (!command) return response.status(400).json({ error: '命令不能为空' })
  if (command.length > 4000 || command.includes('\0')) {
    return response.status(400).json({ error: '命令过长或包含无效字符' })
  }

  const before = await inspectRepository(path)
  if (!before.isGitRepository || !before.root) {
    return response.status(400).json({ error: '该目录未被 Git 管理' })
  }

  const startedAt = Date.now()
  const isWindows = process.platform === 'win32'
  const shell = isWindows
    ? process.env.ComSpec || 'cmd.exe'
    : process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh')
  const shellArgs = isWindows
    ? ['/d', '/q', '/s', '/c', `chcp 65001>nul && ${command}`]
    : ['-lc', command]

  try {
    const { stdout, stderr } = await execFileAsync(shell, shellArgs, {
      cwd: before.root,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    })
    response.json({
      ok: true,
      exitCode: 0,
      output: [stdout.trimEnd(), stderr.trimEnd()].filter(Boolean).join('\n'),
      durationMs: Date.now() - startedAt,
      repository: await inspectRepository(before.root),
    })
  } catch (error) {
    const failure = error as {
      code?: number | string
      killed?: boolean
      stdout?: string
      stderr?: string
      message?: string
    }
    const output = [failure.stdout?.trimEnd(), failure.stderr?.trimEnd()]
      .filter(Boolean)
      .join('\n')

    response.json({
      ok: false,
      exitCode: typeof failure.code === 'number' ? failure.code : 1,
      output: failure.killed ? `${output}\n命令执行超过 60 秒，已终止。`.trim() : output || failure.message || '命令执行失败',
      durationMs: Date.now() - startedAt,
      repository: await inspectRepository(before.root),
    })
  }
})

registerDeploymentRoutes(app, deployConfigPath, ownerMapPath, {
  inspectRepository,
  syncPackageOwner: syncPackageOwnerForRepository,
})

const distDir = join(currentDir, '..', 'dist')
if (existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get(/.*/, (_request, response) => response.sendFile(join(distDir, 'index.html')))
}

let server: Server | undefined
let listeningPort: number | undefined

export function startServer(port = Number(process.env.PORT || 4174)) {
  if (server && listeningPort) return Promise.resolve({ app, server, port: listeningPort })
  return new Promise<{ app: typeof app; server: Server; port: number }>((resolve, reject) => {
    const nextServer = app.listen(port, '127.0.0.1', () => {
      const actualPort = (nextServer.address() as AddressInfo).port
      server = nextServer
      listeningPort = actualPort
      console.log(`Launchline API listening on http://127.0.0.1:${actualPort}`)
      resolve({ app, server: nextServer, port: actualPort })
    })
    nextServer.once('error', reject)
  })
}

export async function stopServer() {
  if (!server) return
  const activeServer = server
  server = undefined
  listeningPort = undefined
  await new Promise<void>((resolve, reject) => activeServer.close((error) => error ? reject(error) : resolve()))
}

const entryFileName = basename(fileURLToPath(import.meta.url))
if (entryFileName === 'index.ts' || entryFileName === 'index.js') {
  void startServer()
}
