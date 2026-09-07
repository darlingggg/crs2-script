import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { stripVTControlCharacters } from 'node:util'
import type { Express, Request, Response } from 'express'
import * as pty from 'node-pty'

type RepositoryInfo = {
  isGitRepository: boolean
  root?: string
  branch?: string
  detached?: boolean
  isProtectedBranch?: boolean
  isClean?: boolean
  changes?: string[]
  remote?: string
  gitUserName?: string
}

type CommandConfig = {
  label: string
  program: string
  args: string[]
  interactive?: boolean
  responses?: Array<{ value: string; delayMs: number; prompt?: string; optional?: boolean }>
  timeoutMs: number
}

type RunningProcess = {
  pid?: number
  kill(): unknown
}

type WorkflowConfig = {
  version: number
  remote: string
  targetBranch: string
  directReleaseBranches: string[]
  defaults: {
    commitMessage: string
  }
  display: {
    testEnvironment: string
    testTask: string
    productionEnvironment: string
  }
  mergePoll: { intervalMs: number; maxAttempts: number }
  mergeRetry: { intervalMs: number; maxAttempts: number; retryOn: string[] }
  productionPoll: { intervalMs: number; maxAttempts: number }
  commands: Record<string, CommandConfig>
}

type DeploymentStep = {
  id: string
  label: string
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped'
  detail?: string
  command?: string
  startedAt?: string
  finishedAt?: string
}

type DeploymentLog = {
  id: number
  at: string
  stepId: string
  message: string
  level: 'info' | 'command' | 'error'
}

type DeploymentSession = {
  id: string
  path: string
  sourceBranch: string
  targetBranch: string
  status: 'running' | 'success' | 'failed' | 'cancelled'
  startedAt: string
  finishedAt?: string
  currentStep?: string
  error?: string
  steps: DeploymentStep[]
  logs: DeploymentLog[]
  repository?: RepositoryInfo
  cancelled: boolean
  child?: RunningProcess
}

type DeploymentInput = {
  commitMessage: string
  mergeTitle: string
  mergeDescription: string
  useCrsAiTitle: boolean
  reviewerName: string
  updateSubmodules: boolean
  syncPackageOwner: boolean
}

type Dependencies = {
  inspectRepository(path: string): Promise<RepositoryInfo>
  syncPackageOwner(path: string): Promise<{ changed: boolean; message: string }>
}

type ProjectOwner = {
  displayName: string
  gitUserName?: string
  mapped: boolean
}

type OwnerAccess = {
  projectName: string
  currentGitUser: string
  owners: ProjectOwner[]
  isCurrentUserOwner: boolean
  reviewerRequired: boolean
}

class DeploymentFailure extends Error {}
class DeploymentCancelled extends Error {}

const sessions = new Map<string, DeploymentSession>()
function stripAnsi(value: string) {
  return stripVTControlCharacters(value).replace(/\r/g, '')
}

function publicSession(session: DeploymentSession) {
  const { child: _child, cancelled: _cancelled, ...result } = session
  return result
}

export function getDeploymentsSnapshot() {
  return [...sessions.values()]
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
    .map(publicSession)
}

export function getRunningDeploymentCount() {
  return [...sessions.values()].filter((session) => session.status === 'running').length
}

function addLog(session: DeploymentSession, stepId: string, message: string, level: DeploymentLog['level'] = 'info') {
  const cleaned = stripAnsi(message).trim()
  if (!cleaned) return
  session.logs.push({ id: Date.now() + session.logs.length, at: new Date().toISOString(), stepId, message: cleaned, level })
  if (session.logs.length > 500) session.logs.splice(0, session.logs.length - 500)
}

function getStep(session: DeploymentSession, id: string) {
  const step = session.steps.find((item) => item.id === id)
  if (!step) throw new DeploymentFailure(`部署配置缺少步骤：${id}`)
  return step
}

function startStep(session: DeploymentSession, id: string) {
  const step = getStep(session, id)
  step.status = 'running'
  step.startedAt = new Date().toISOString()
  session.currentStep = id
  return step
}

function finishStep(session: DeploymentSession, id: string, detail?: string) {
  const step = getStep(session, id)
  step.status = 'success'
  step.detail = detail || step.detail
  step.finishedAt = new Date().toISOString()
}

function skipStep(session: DeploymentSession, id: string, detail: string) {
  const step = getStep(session, id)
  step.status = 'skipped'
  step.detail = detail
  step.finishedAt = new Date().toISOString()
}

function failStep(session: DeploymentSession, id: string, detail: string) {
  const step = getStep(session, id)
  step.status = 'failed'
  step.detail = detail
  step.finishedAt = new Date().toISOString()
}

function renderTemplate(value: string, context: Record<string, string>) {
  return value.replace(/{{(\w+)}}/g, (_match, key: string) => context[key] ?? '')
}

function quoteForCmd(value: string) {
  if (!/[\s&|<>^()]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

function terminateChild(child: RunningProcess) {
  if (!child.pid) return
  if (process.platform === 'win32') {
    spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true })
  } else {
    child.kill()
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requireText(value: unknown, path: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new DeploymentFailure(`${path} 必须是非空字符串`)
  }
}

function requireNumber(value: unknown, path: string, minimum: number) {
  if (!Number.isFinite(value) || Number(value) < minimum) {
    throw new DeploymentFailure(`${path} 必须是不小于 ${minimum} 的数字`)
  }
}

export function validateWorkflowConfig(value: unknown): WorkflowConfig {
  if (!isRecord(value)) throw new DeploymentFailure('配置根节点必须是 JSON 对象')
  requireNumber(value.version, 'version', 1)
  requireText(value.remote, 'remote')
  requireText(value.targetBranch, 'targetBranch')
  if (!Array.isArray(value.directReleaseBranches) || value.directReleaseBranches.some((branch) => typeof branch !== 'string' || !branch.trim())) {
    throw new DeploymentFailure('directReleaseBranches 必须是分支名称数组')
  }

  if (!isRecord(value.defaults)) throw new DeploymentFailure('defaults 配置不完整')
  requireText(value.defaults.commitMessage, 'defaults.commitMessage')
  if (!isRecord(value.display)) throw new DeploymentFailure('display 配置不完整')
  requireText(value.display.testEnvironment, 'display.testEnvironment')
  requireText(value.display.testTask, 'display.testTask')
  requireText(value.display.productionEnvironment, 'display.productionEnvironment')

  for (const pollName of ['mergePoll', 'productionPoll'] as const) {
    const poll = value[pollName]
    if (!isRecord(poll)) throw new DeploymentFailure(`${pollName} 配置不完整`)
    requireNumber(poll.intervalMs, `${pollName}.intervalMs`, 0)
    requireNumber(poll.maxAttempts, `${pollName}.maxAttempts`, 1)
  }
  if (!isRecord(value.mergeRetry)) throw new DeploymentFailure('mergeRetry 配置不完整')
  requireNumber(value.mergeRetry.intervalMs, 'mergeRetry.intervalMs', 0)
  requireNumber(value.mergeRetry.maxAttempts, 'mergeRetry.maxAttempts', 1)
  if (!Array.isArray(value.mergeRetry.retryOn) || value.mergeRetry.retryOn.some((message) => typeof message !== 'string')) {
    throw new DeploymentFailure('mergeRetry.retryOn 必须是字符串数组')
  }

  if (!isRecord(value.commands)) throw new DeploymentFailure('commands 配置不完整')
  const requiredCommands = [
    'submodules',
    'stage',
    'commit',
    'fetch',
    'push',
    'merge',
    'switchTarget',
    'switchTargetFromRemote',
    'pullTarget',
    'testRelease',
    'productionRelease',
  ]
  for (const commandName of requiredCommands) {
    const command = value.commands[commandName]
    if (!isRecord(command)) throw new DeploymentFailure(`commands.${commandName} 配置不完整`)
    requireText(command.label, `commands.${commandName}.label`)
    requireText(command.program, `commands.${commandName}.program`)
    if (!Array.isArray(command.args) || command.args.some((argument) => typeof argument !== 'string')) {
      throw new DeploymentFailure(`commands.${commandName}.args 必须是字符串数组`)
    }
    requireNumber(command.timeoutMs, `commands.${commandName}.timeoutMs`, 1)
    if (command.interactive !== undefined && typeof command.interactive !== 'boolean') {
      throw new DeploymentFailure(`commands.${commandName}.interactive 必须是布尔值`)
    }
    if (command.responses !== undefined) {
      if (!Array.isArray(command.responses)) throw new DeploymentFailure(`commands.${commandName}.responses 必须是数组`)
      command.responses.forEach((item, index) => {
        if (!isRecord(item) || typeof item.value !== 'string') {
          throw new DeploymentFailure(`commands.${commandName}.responses[${index}].value 必须是字符串`)
        }
        requireNumber(item.delayMs, `commands.${commandName}.responses[${index}].delayMs`, 0)
        if (item.prompt !== undefined && typeof item.prompt !== 'string') {
          throw new DeploymentFailure(`commands.${commandName}.responses[${index}].prompt 必须是字符串`)
        }
        if (item.optional !== undefined && typeof item.optional !== 'boolean') {
          throw new DeploymentFailure(`commands.${commandName}.responses[${index}].optional 必须是布尔值`)
        }
      })
    }
  }

  return value as unknown as WorkflowConfig
}

async function loadConfig(configPath: string): Promise<WorkflowConfig> {
  return validateWorkflowConfig(JSON.parse(await readFile(configPath, 'utf8')))
}

function isDirectReleaseBranch(branch: string, config: WorkflowConfig) {
  return config.directReleaseBranches.includes(branch)
}

function delay(session: DeploymentSession, ms: number) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    const check = setInterval(() => {
      if (session.cancelled) {
        clearTimeout(timer)
        clearInterval(check)
        reject(new DeploymentCancelled('部署已取消'))
      }
    }, Math.min(500, ms))
    setTimeout(() => clearInterval(check), ms + 50)
  })
}

function runCommand(
  session: DeploymentSession,
  stepId: string,
  config: CommandConfig,
  context: Record<string, string>,
) {
  if (session.cancelled) return Promise.reject(new DeploymentCancelled('部署已取消'))

  const args = config.args.map((arg) => renderTemplate(arg, context))
  const responses = (config.responses || []).map((response) => ({
    value: renderTemplate(response.value, context),
    delayMs: response.delayMs,
    prompt: response.prompt,
    optional: response.optional === true,
  }))
  const displayCommand = `${config.program} ${args.map(quoteForCmd).join(' ')}`.trim()
  const step = getStep(session, stepId)
  step.command = displayCommand
  addLog(session, stepId, `$ ${displayCommand}`, 'command')

  let program = config.program
  let processArgs = args
  if (config.program === 'git') {
    processArgs = ['-C', session.path, ...args]
  } else if (process.platform === 'win32') {
    program = process.env.ComSpec || 'cmd.exe'
    processArgs = ['/d', '/s', '/c', displayCommand]
  }

  return new Promise<{ exitCode: number; output: string }>((resolve, reject) => {
    let output = ''
    let timedOut = false
    let settled = false
    const responseTimers: NodeJS.Timeout[] = []
    let writeInput: (value: string) => void = () => undefined

    let responseIndex = 0
    let responseScheduled = false
    const scheduleNextResponse = () => {
      const response = responses[responseIndex]
      if (!response || responseScheduled) return
      if (response.prompt && !output.includes(response.prompt)) {
        const laterPromptVisible = response.optional && responses
          .slice(responseIndex + 1)
          .some((item) => item.prompt && output.includes(item.prompt))
        if (laterPromptVisible) {
          responseIndex += 1
          scheduleNextResponse()
        }
        return
      }
      responseScheduled = true
      responseTimers.push(setTimeout(() => {
        writeInput(response.value)
        responseIndex += 1
        responseScheduled = false
        scheduleNextResponse()
      }, response.delayMs))
    }
    scheduleNextResponse()

    const capture = (chunk: Buffer | string, level: DeploymentLog['level']) => {
      const text = stripAnsi(typeof chunk === 'string' ? chunk : chunk.toString('utf8'))
      output += text
      addLog(session, stepId, text, level)
      scheduleNextResponse()
    }

    const timeout = setTimeout(() => {
      timedOut = true
      if (session.child) terminateChild(session.child)
    }, config.timeoutMs)

    const finish = (exitCode: number) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      responseTimers.forEach(clearTimeout)
      session.child = undefined
      if (session.cancelled) return reject(new DeploymentCancelled('部署已取消'))
      if (timedOut) return reject(new DeploymentFailure(`${config.label}执行超时`))
      resolve({ exitCode, output: stripAnsi(output).trim() })
    }

    const failToStart = (error: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      responseTimers.forEach(clearTimeout)
      session.child = undefined
      reject(error)
    }

    if (config.interactive) {
      try {
        const terminal = pty.spawn(program, processArgs, {
          name: 'xterm-256color',
          cols: 120,
          rows: 30,
          cwd: session.path,
          env: { ...process.env, FORCE_COLOR: '0', TERM: 'xterm-256color' },
          useConpty: process.platform === 'win32',
        })
        session.child = terminal
        writeInput = (value) => terminal.write(`${value}\r`)
        terminal.onData((data) => capture(data, 'info'))
        terminal.onExit(({ exitCode }) => finish(exitCode))
        scheduleNextResponse()
      } catch (error) {
        failToStart(error)
      }
      return
    }

    const child = spawn(program, processArgs, {
      cwd: session.path,
      env: { ...process.env, FORCE_COLOR: '0' },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams
    session.child = child
    writeInput = (value) => {
      if (!child.killed && child.stdin.writable) child.stdin.write(`${value}\n`)
    }
    child.stdout.on('data', (chunk: Buffer) => capture(chunk, 'info'))
    child.stderr.on('data', (chunk: Buffer) => capture(chunk, 'info'))
    child.on('error', failToStart)
    child.on('close', (code) => finish(code ?? 1))
    scheduleNextResponse()
  })
}

async function runRequiredCommand(
  session: DeploymentSession,
  stepId: string,
  config: CommandConfig,
  context: Record<string, string>,
) {
  const result = await runCommand(session, stepId, config, context)
  if (result.exitCode !== 0) {
    throw new DeploymentFailure(result.output || `${config.label}失败，退出码 ${result.exitCode}`)
  }
  return result
}

async function gitResult(path: string, args: string[]) {
  return new Promise<{ exitCode: number; output: string }>((resolve) => {
    const child = spawn('git', ['-C', path, ...args], { windowsHide: true })
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk.toString('utf8')))
    child.stderr.on('data', (chunk) => (output += chunk.toString('utf8')))
    child.on('error', (error) => resolve({ exitCode: 1, output: error.message }))
    child.on('close', (code) => resolve({ exitCode: code ?? 1, output: output.trim() }))
  })
}

export async function inferSubmoduleCommitMessage(path: string) {
  const [staged, unstaged, untracked] = await Promise.all([
    gitResult(path, ['diff', '--cached', '--name-only', '--no-renames', '-z', '--']),
    gitResult(path, ['diff', '--name-only', '--no-renames', '--ignore-submodules=none', '-z', '--']),
    gitResult(path, ['ls-files', '--others', '--exclude-standard', '-z']),
  ])
  const stagedPaths = staged.output.split('\0').filter(Boolean)
  const unstagedPaths = unstaged.output.split('\0').filter(Boolean)
  const changedPaths = [...new Set([...stagedPaths, ...unstagedPaths])]
  if (staged.exitCode !== 0 || unstaged.exitCode !== 0 || !changedPaths.length || untracked.output) return undefined

  const references: string[] = []
  for (const submodulePath of changedPaths) {
    const indexEntry = await gitResult(path, ['ls-files', '--stage', '--', submodulePath])
    const match = indexEntry.output.match(/^160000\s+([0-9a-f]{40,64})\s+0\t/)
    if (indexEntry.exitCode !== 0 || !match) return undefined

    let reference = match[1]
    if (unstagedPaths.includes(submodulePath)) {
      const [submoduleHead, submoduleStatus] = await Promise.all([
        gitResult(path, ['-C', submodulePath, 'rev-parse', 'HEAD']),
        gitResult(path, ['-C', submodulePath, 'status', '--porcelain', '--untracked-files=all']),
      ])
      if (
        submoduleHead.exitCode !== 0
        || submoduleStatus.exitCode !== 0
        || submoduleStatus.output
        || submoduleHead.output === match[1]
      ) return undefined
      reference = submoduleHead.output
    }

    references.push(`${submodulePath}@${reference.slice(0, 8)}`)
  }

  return `chore: 更新子包引用至 ${references.join('、')}`
}

async function commandResult(path: string, command: string) {
  return new Promise<{ exitCode: number; output: string }>((resolve) => {
    const program = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'sh'
    const args = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-lc', command]
    const child = spawn(program, args, { cwd: path, windowsHide: true })
    let output = ''
    const timeout = setTimeout(() => terminateChild(child), 30_000)
    child.stdout.on('data', (chunk) => (output += chunk.toString('utf8')))
    child.stderr.on('data', (chunk) => (output += chunk.toString('utf8')))
    child.on('error', (error) => resolve({ exitCode: 1, output: error.message }))
    child.on('close', (code) => {
      clearTimeout(timeout)
      resolve({ exitCode: code ?? 1, output: stripAnsi(output).trim() })
    })
  })
}

export function parseProjectOwners(output: string) {
  for (const line of output.split(/\r?\n/)) {
    if (!line.includes('|')) continue
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim())
    if (cells.length < 2 || cells[0] === '项目名' || cells[1] === 'Owner') continue
    const owners = cells[1].split(/[,，、]/).map((name) => name.trim()).filter(Boolean)
    if (cells[0] && owners.length) return { projectName: cells[0], owners }
  }
  throw new DeploymentFailure('无法解析 crs2 show project --showOwner 的 Owner 信息')
}

export function resolveProjectOwners(rawOwners: string[], ownerMap: Record<string, unknown>) {
  return rawOwners.map((rawName) => {
    let displayName = rawName.trim()
    let directGitUserName: string | undefined
    const identity = displayName.match(/^([^()（）]+?)\s*[（(]([^()（）]+)[）)]$/)
    if (identity) {
      const left = identity[1].trim()
      const right = identity[2].trim()
      const gitUserPattern = /^[a-z0-9][a-z0-9._-]*$/i
      if (gitUserPattern.test(left)) {
        directGitUserName = left
        displayName = right
      } else if (gitUserPattern.test(right)) {
        directGitUserName = right
        displayName = left
      }
    }

    const mappedName = ownerMap[displayName] ?? ownerMap[rawName]
    const mappedGitUserName = typeof mappedName === 'string' && mappedName.trim()
      ? mappedName.trim()
      : undefined
    const gitUserName = directGitUserName || mappedGitUserName
    return { displayName, gitUserName, mapped: Boolean(gitUserName) }
  })
}

async function inspectOwnerAccess(path: string, gitUserName: string, ownerMapPath: string): Promise<OwnerAccess> {
  const [command, mapContents] = await Promise.all([
    commandResult(path, 'crs2 show project --showOwner'),
    readFile(ownerMapPath, 'utf8'),
  ])
  if (command.exitCode !== 0) {
    throw new DeploymentFailure(command.output || '无法读取项目 Owner')
  }

  const parsed = parseProjectOwners(command.output)
  const ownerMap = JSON.parse(mapContents) as Record<string, unknown>
  const owners = resolveProjectOwners(parsed.owners, ownerMap)
  const normalizedGitUser = gitUserName.trim().toLowerCase()
  const isCurrentUserOwner = Boolean(normalizedGitUser) && owners.some(
    (owner) => owner.gitUserName?.toLowerCase() === normalizedGitUser,
  )
  return {
    projectName: parsed.projectName,
    currentGitUser: gitUserName,
    owners,
    isCurrentUserOwner,
    reviewerRequired: !isCurrentUserOwner,
  }
}

function initializeSteps(config: WorkflowConfig): DeploymentStep[] {
  return [
    { id: 'prepare', label: '准备部署内容', status: 'pending' },
    { id: 'commit', label: config.commands.commit.label, status: 'pending' },
    { id: 'fetch', label: config.commands.fetch.label, status: 'pending' },
    { id: 'push', label: config.commands.push.label, status: 'pending' },
    { id: 'merge', label: config.commands.merge.label, status: 'pending' },
    { id: 'merge_sync', label: config.commands.pullTarget.label, status: 'pending' },
    { id: 'test_release', label: config.commands.testRelease.label, status: 'pending' },
    { id: 'production_release', label: config.commands.productionRelease.label, status: 'pending' },
  ]
}

async function executeDeployment(
  session: DeploymentSession,
  input: DeploymentInput,
  config: WorkflowConfig,
  dependencies: Dependencies,
  ownerAccess: OwnerAccess | null,
) {
  const directRelease = isDirectReleaseBranch(session.sourceBranch, config)
  const reviewerIndex = !ownerAccess || ownerAccess.isCurrentUserOwner
    ? -1
    : ownerAccess.owners.findIndex((owner) => owner.displayName === input.reviewerName)
  const context: Record<string, string> = {
    remote: config.remote,
    targetBranch: config.targetBranch,
    sourceBranch: session.sourceBranch,
    commitMessage: input.commitMessage,
    mergeTitle: input.mergeTitle,
    mergeTitleResponse: input.useCrsAiTitle ? '' : input.mergeTitle,
    mergeDescription: input.mergeDescription,
    reviewerKeys: reviewerIndex > 0 ? '\u001b[B'.repeat(reviewerIndex) : '',
  }

  try {
    startStep(session, 'prepare')
    if (input.updateSubmodules) {
      await runRequiredCommand(session, 'prepare', config.commands.submodules, context)
    }
    if (input.syncPackageOwner) {
      const ownerResult = await dependencies.syncPackageOwner(session.path)
      addLog(session, 'prepare', ownerResult.message)
    }
    finishStep(session, 'prepare', input.updateSubmodules || input.syncPackageOwner ? '部署选项已处理' : '无需额外处理')

    let repository = await dependencies.inspectRepository(session.path)
    startStep(session, 'commit')
    if (!repository.isClean) {
      await runRequiredCommand(session, 'commit', config.commands.stage, context)
      if (!context.commitMessage) {
        const submoduleCommitMessage = await inferSubmoduleCommitMessage(session.path)
        context.commitMessage = submoduleCommitMessage || config.defaults.commitMessage
        addLog(
          session,
          'commit',
          submoduleCommitMessage
            ? `暂存区仅包含子模块引用更新，使用默认提交信息：${context.commitMessage}`
            : `部署选项产生了新改动，使用默认提交信息：${context.commitMessage}`,
        )
      }
      await runRequiredCommand(session, 'commit', config.commands.commit, context)
      finishStep(session, 'commit', `已提交 ${repository.changes?.length || 0} 项改动`)
    } else {
      skipStep(session, 'commit', '工作区没有待提交改动')
    }

    const sourceHead = await gitResult(session.path, ['rev-parse', 'HEAD'])
    if (sourceHead.exitCode !== 0 || !sourceHead.output) throw new DeploymentFailure('无法读取当前提交')
    context.sourceCommit = sourceHead.output

    startStep(session, 'fetch')
    await runRequiredCommand(session, 'fetch', config.commands.fetch, context)
    const remoteBranch = await gitResult(session.path, ['ls-remote', '--heads', config.remote, `refs/heads/${session.sourceBranch}`])
    finishStep(session, 'fetch', remoteBranch.output ? '远程分支已存在' : '远程分支不存在，将在推送时创建')

    startStep(session, 'push')
    await runRequiredCommand(session, 'push', config.commands.push, context)
    finishStep(session, 'push', `${session.sourceBranch} 已推送到 ${config.remote}`)

    if (directRelease) {
      skipStep(session, 'merge', `${session.sourceBranch} 已配置为直接发布分支`)
      skipStep(session, 'merge_sync', '无需切换或等待合并')
      addLog(session, 'merge', `当前分支 ${session.sourceBranch} 命中 directReleaseBranches，跳过合并流程`)
    } else {
      startStep(session, 'merge')
      if (ownerAccess && !ownerAccess.isCurrentUserOwner) {
        const reviewer = ownerAccess.owners[reviewerIndex]
        addLog(session, 'merge', `当前 Git 用户 ${ownerAccess.currentGitUser || '未配置'} 不是项目 Owner；已选择 ${reviewer.displayName} 作为审核人，请通知其进行合并分支`)
      }
      if (input.useCrsAiTitle) {
        addLog(session, 'merge', 'crs2 AI 将生成 Merge 标题，生成内容会在命令输出中回显')
      }
      let mergeSucceeded = false
      for (let attempt = 1; attempt <= config.mergeRetry.maxAttempts; attempt += 1) {
        const step = getStep(session, 'merge')
        step.detail = `第 ${attempt}/${config.mergeRetry.maxAttempts} 次尝试`
        const mergeResult = await runCommand(session, 'merge', config.commands.merge, context)
        if (mergeResult.exitCode === 0) {
          mergeSucceeded = true
          break
        }

        const retryable = config.mergeRetry.retryOn.some((message) => mergeResult.output.includes(message))
        if (!retryable || attempt === config.mergeRetry.maxAttempts) {
          throw new DeploymentFailure(mergeResult.output || `创建并合并代码失败，退出码 ${mergeResult.exitCode}`)
        }

        const waitSeconds = Math.round(config.mergeRetry.intervalMs / 1000)
        addLog(session, 'merge', `GitLab 分支状态尚未同步，${waitSeconds} 秒后进行第 ${attempt + 1} 次尝试`)
        await delay(session, config.mergeRetry.intervalMs)
      }
      if (!mergeSucceeded) throw new DeploymentFailure('创建并合并代码失败')
      finishStep(session, 'merge', input.useCrsAiTitle ? '合并请求已提交，标题由 crs2 AI 生成' : '合并请求已提交')

      startStep(session, 'merge_sync')
      const switchResult = await runCommand(session, 'merge_sync', config.commands.switchTarget, context)
      if (switchResult.exitCode !== 0) {
        await runRequiredCommand(session, 'merge_sync', config.commands.switchTargetFromRemote, context)
      }

      let merged = false
      for (let attempt = 1; attempt <= config.mergePoll.maxAttempts; attempt += 1) {
        const step = getStep(session, 'merge_sync')
        step.detail = `第 ${attempt}/${config.mergePoll.maxAttempts} 次同步`
        const pullResult = await runCommand(session, 'merge_sync', config.commands.pullTarget, context)
        if (pullResult.exitCode === 0) {
          const containsSource = await gitResult(session.path, ['merge-base', '--is-ancestor', context.sourceCommit, 'HEAD'])
          if (containsSource.exitCode === 0) {
            merged = true
            break
          }
        }
        if (attempt < config.mergePoll.maxAttempts) await delay(session, config.mergePoll.intervalMs)
      }
      if (!merged) throw new DeploymentFailure(`等待 ${config.targetBranch} 同步合并内容超时`)
      finishStep(session, 'merge_sync', `${config.targetBranch} 已包含 ${context.sourceCommit.slice(0, 8)}`)
    }

    startStep(session, 'test_release')
    await runRequiredCommand(session, 'test_release', config.commands.testRelease, context)
    finishStep(session, 'test_release', `${config.display.testEnvironment} / ${config.display.testTask}`)

    startStep(session, 'production_release')
    let productionSucceeded = false
    for (let attempt = 1; attempt <= config.productionPoll.maxAttempts; attempt += 1) {
      const step = getStep(session, 'production_release')
      step.detail = `第 ${attempt}/${config.productionPoll.maxAttempts} 次尝试`
      addLog(session, 'production_release', `${Math.round(config.productionPoll.intervalMs / 60000)} 分钟后开始第 ${attempt} 次生产发布检查`)
      await delay(session, config.productionPoll.intervalMs)
      const releaseResult = await runCommand(session, 'production_release', config.commands.productionRelease, context)
      if (releaseResult.exitCode === 0) {
        productionSucceeded = true
        break
      }
    }
    if (!productionSucceeded) {
      throw new DeploymentFailure(`生产发布连续 ${config.productionPoll.maxAttempts} 次未成功`)
    }
    finishStep(session, 'production_release', `${config.display.productionEnvironment} 发布成功`)

    session.status = 'success'
    session.currentStep = undefined
    session.finishedAt = new Date().toISOString()
    session.repository = await dependencies.inspectRepository(session.path)
  } catch (error) {
    const message = error instanceof Error ? error.message : '部署失败'
    if (session.currentStep) failStep(session, session.currentStep, message)
    session.status = error instanceof DeploymentCancelled ? 'cancelled' : 'failed'
    session.error = message
    session.finishedAt = new Date().toISOString()
    addLog(session, session.currentStep || 'deployment', message, 'error')
    session.repository = await dependencies.inspectRepository(session.path)
  }
}

function sendError(response: Response, status: number, error: string) {
  response.status(status).json({ error })
}

export function registerDeploymentRoutes(app: Express, configPath: string, ownerMapPath: string, dependencies: Dependencies) {
  app.get('/api/deployment/config', async (_request: Request, response: Response) => {
    try {
      response.json({ config: await loadConfig(configPath) })
    } catch (error) {
      sendError(response, 500, error instanceof Error ? error.message : '无法读取流程配置')
    }
  })

  app.put('/api/deployment/config', async (request: Request, response: Response) => {
    let config: WorkflowConfig
    try {
      config = validateWorkflowConfig(request.body?.config)
    } catch (error) {
      return sendError(response, 400, error instanceof Error ? error.message : '流程配置无效')
    }
    try {
      await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
      response.json({ config })
    } catch (error) {
      sendError(response, 500, error instanceof Error ? error.message : '无法保存流程配置')
    }
  })

  app.get('/api/deployments', (_request: Request, response: Response) => {
    response.json(getDeploymentsSnapshot())
  })

  app.get('/api/deployment/prefill', async (request: Request, response: Response) => {
    const path = typeof request.query.path === 'string' ? request.query.path : ''
    const repository = await dependencies.inspectRepository(path)
    if (!repository.isGitRepository || !repository.root || !repository.branch) {
      return sendError(response, 400, '请选择有效的 Git 项目')
    }

    try {
      const config = await loadConfig(configPath)
      const directRelease = isDirectReleaseBranch(repository.branch, config)
      if (repository.isProtectedBranch && !directRelease) {
        return sendError(response, 400, `分支 ${repository.branch} 未配置直接发布，请修改 deploy.workflow.json 的 directReleaseBranches`)
      }
      const ownerAccess = directRelease
        ? null
        : await inspectOwnerAccess(repository.root, repository.gitUserName || '', ownerMapPath)
      const [latest, logRange, submoduleCommitMessage] = await Promise.all([
        gitResult(repository.root, ['log', '-1', '--pretty=%s']),
        directRelease
          ? Promise.resolve({ exitCode: 0, output: '' })
          : gitResult(repository.root, ['log', '--pretty=- %s', `${config.remote}/${config.targetBranch}..HEAD`]),
        inferSubmoduleCommitMessage(repository.root),
      ])
      const subject = latest.output || repository.branch
      const angularPattern = /^(feat|fix|docs|style|refactor|perf|test|chore|revert|build|ci)(\(.+\))?:\s/i
      const mergeTitle = angularPattern.test(subject) ? subject : `chore: ${subject}`
      const mergeDescription = directRelease
        ? ''
        : logRange.exitCode === 0 && logRange.output
        ? logRange.output
        : `- 合并 ${repository.branch} 到 ${config.targetBranch}`

      response.json({
        commitMessage: submoduleCommitMessage || '',
        mergeTitle,
        mergeDescription,
        ownerAccess,
        config: {
          targetBranch: config.targetBranch,
          testEnvironment: config.display.testEnvironment,
          testTask: config.display.testTask,
          productionEnvironment: config.display.productionEnvironment,
          productionIntervalSeconds: Math.round(config.productionPoll.intervalMs / 1000),
          productionMaxAttempts: config.productionPoll.maxAttempts,
          directRelease,
        },
      })
    } catch (error) {
      sendError(response, 500, error instanceof Error ? error.message : '无法读取部署配置')
    }
  })

  app.post('/api/deployments', async (request: Request, response: Response) => {
    const path = request.body?.path
    if (typeof path !== 'string') return sendError(response, 400, '项目目录无效')
    const repository = await dependencies.inspectRepository(path)
    if (!repository.isGitRepository || !repository.root || !repository.branch) {
      return sendError(response, 400, '该目录未被 Git 管理')
    }
    if (repository.detached) {
      return sendError(response, 400, '请先切换到一个有效分支')
    }
    if (!repository.remote || repository.remote === '未配置 origin') {
      return sendError(response, 400, '当前仓库未配置 origin')
    }
    if ([...sessions.values()].some((session) => session.path === repository.root && session.status === 'running')) {
      return sendError(response, 409, '当前项目已有部署任务正在运行')
    }

    const input: DeploymentInput = {
      commitMessage: String(request.body?.commitMessage || '').trim(),
      mergeTitle: String(request.body?.mergeTitle || '').trim(),
      mergeDescription: String(request.body?.mergeDescription || '').trim(),
      useCrsAiTitle: request.body?.useCrsAiTitle !== false,
      reviewerName: String(request.body?.reviewerName || '').trim(),
      updateSubmodules: request.body?.updateSubmodules === true,
      syncPackageOwner: request.body?.syncPackageOwner === true,
    }
    if (!repository.isClean && !input.commitMessage) {
      input.commitMessage = await inferSubmoduleCommitMessage(repository.root) || ''
    }
    const needsCommitMessage = !repository.isClean
    if (needsCommitMessage && !input.commitMessage) {
      return sendError(response, 400, '当前工作区存在改动，请填写提交信息')
    }
    if (input.commitMessage.length > 300 || input.mergeTitle.length > 300 || input.mergeDescription.length > 4000) {
      return sendError(response, 400, '部署输入内容过长')
    }

    try {
      const config = await loadConfig(configPath)
      const directRelease = isDirectReleaseBranch(repository.branch, config)
      if (repository.isProtectedBranch && !directRelease) {
        return sendError(response, 400, `分支 ${repository.branch} 未配置直接发布，请修改 deploy.workflow.json 的 directReleaseBranches`)
      }
      if (!directRelease && !input.useCrsAiTitle && !input.mergeTitle) {
        return sendError(response, 400, '关闭 crs2 AI 后，请填写 Merge 标题')
      }
      const ownerAccess = directRelease
        ? null
        : await inspectOwnerAccess(repository.root, repository.gitUserName || '', ownerMapPath)
      if (ownerAccess?.reviewerRequired && !ownerAccess.owners.some((owner) => owner.displayName === input.reviewerName)) {
        return sendError(response, 400, '当前 Git 用户不是项目 Owner，请选择审核人')
      }
      const session: DeploymentSession = {
        id: randomUUID(),
        path: repository.root,
        sourceBranch: repository.branch,
        targetBranch: config.targetBranch,
        status: 'running',
        startedAt: new Date().toISOString(),
        steps: initializeSteps(config),
        logs: [],
        cancelled: false,
      }
      sessions.set(session.id, session)
      if (sessions.size > 20) {
        const completed = [...sessions.values()].find((item) => item.status !== 'running')
        if (completed) sessions.delete(completed.id)
      }
      void executeDeployment(session, input, config, dependencies, ownerAccess)
      response.status(202).json(publicSession(session))
    } catch (error) {
      sendError(response, 500, error instanceof Error ? error.message : '无法启动部署')
    }
  })

  app.get('/api/deployments/:id', (request: Request, response: Response) => {
    const session = sessions.get(String(request.params.id))
    if (!session) return sendError(response, 404, '部署任务不存在或服务已重启')
    response.json(publicSession(session))
  })

  app.post('/api/deployments/:id/cancel', (request: Request, response: Response) => {
    const session = sessions.get(String(request.params.id))
    if (!session) return sendError(response, 404, '部署任务不存在')
    if (session.status !== 'running') return response.json(publicSession(session))
    session.cancelled = true
    if (session.child) terminateChild(session.child)
    response.json(publicSession(session))
  })
}
