<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import packageMetadata from '../package.json'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Download,
  Eraser,
  FileJson,
  FolderInput,
  FolderGit2,
  FolderPlus,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequestArrow,
  Github,
  History,
  LoaderCircle,
  Layers3,
  Minimize2,
  PackageCheck,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  Send,
  Settings2,
  ShieldAlert,
  TerminalSquare,
  UserRoundCheck,
  X,
} from 'lucide-vue-next'

const appVersion = packageMetadata.version

type Repository = {
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
  packageOwner?: {
    exists: boolean
    ownerExists: boolean
    ownerName?: string
    ownerKind?: 'string' | 'object'
    needsUpdate: boolean
    canSync: boolean
    error?: string
  }
  checkedAt?: string
  error?: string
}

type TerminalEntry = {
  id: number
  command: string
  output: string
  exitCode: number
  durationMs: number
}

type DeploymentStep = {
  id: string
  label: string
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped'
  detail?: string
  command?: string
}

type DeploymentLog = {
  id: number
  at: string
  stepId: string
  message: string
  level: 'info' | 'command' | 'error'
}

type Deployment = {
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
  repository?: Repository
}

type DeploymentConfigSummary = {
  targetBranch: string
  testEnvironment: string
  testTask: string
  productionEnvironment: string
  productionIntervalSeconds: number
  productionMaxAttempts: number
}

type OwnerAccess = {
  projectName: string
  currentGitUser: string
  owners: Array<{
    displayName: string
    gitUserName?: string
    mapped: boolean
  }>
  isCurrentUserOwner: boolean
  reviewerRequired: boolean
}

type ProjectWorkspace = {
  id: string
  path: string
  repository: Repository | null
  isInspecting: boolean
  isSwitchingBranch: boolean
  isUpdatingSubmodules: boolean
  isSyncingPackageOwner: boolean
  isExecutingCommand: boolean
  updateBeforeDeploy: boolean
  syncPackageOwnerBeforeDeploy: boolean
  commandOutput: string
  terminalCommand: string
  terminalEntries: TerminalEntry[]
  terminalHistory: string[]
  historyIndex: number
  errorMessage: string
  developmentBranch: string
  developmentBranchDraft: string
  branchSetupOpen: boolean
  saved: boolean
  lastPublishedAt?: string
}

let projectSequence = 0
function createProjectWorkspace(path = '', savedProject?: SavedProjectRecord): ProjectWorkspace {
  projectSequence += 1
  const developmentBranch = savedProject?.developmentBranch || 'dev'
  return {
    id: `project-${Date.now()}-${projectSequence}`,
    path,
    repository: null,
    isInspecting: false,
    isSwitchingBranch: false,
    isUpdatingSubmodules: false,
    isSyncingPackageOwner: false,
    isExecutingCommand: false,
    updateBeforeDeploy: true,
    syncPackageOwnerBeforeDeploy: false,
    commandOutput: '',
    terminalCommand: '',
    terminalEntries: [],
    terminalHistory: [],
    historyIndex: -1,
    errorMessage: '',
    developmentBranch,
    developmentBranchDraft: developmentBranch,
    branchSetupOpen: false,
    saved: Boolean(savedProject),
    lastPublishedAt: savedProject?.lastPublishedAt,
  }
}

const projectTabs = ref<ProjectWorkspace[]>([createProjectWorkspace()])
const activeProjectId = ref(projectTabs.value[0].id)
const activeProject = computed(() => projectTabs.value.find((item) => item.id === activeProjectId.value) || projectTabs.value[0])
const projectPath = computed({ get: () => activeProject.value.path, set: (value: string) => (activeProject.value.path = value) })
const repository = computed({ get: () => activeProject.value.repository, set: (value: Repository | null) => (activeProject.value.repository = value) })
const isInspecting = computed({ get: () => activeProject.value.isInspecting, set: (value: boolean) => (activeProject.value.isInspecting = value) })
const isSwitchingBranch = computed({ get: () => activeProject.value.isSwitchingBranch, set: (value: boolean) => (activeProject.value.isSwitchingBranch = value) })
const isUpdatingSubmodules = computed({ get: () => activeProject.value.isUpdatingSubmodules, set: (value: boolean) => (activeProject.value.isUpdatingSubmodules = value) })
const isSyncingPackageOwner = computed({ get: () => activeProject.value.isSyncingPackageOwner, set: (value: boolean) => (activeProject.value.isSyncingPackageOwner = value) })
const isExecutingCommand = computed({ get: () => activeProject.value.isExecutingCommand, set: (value: boolean) => (activeProject.value.isExecutingCommand = value) })
const updateBeforeDeploy = computed({ get: () => activeProject.value.updateBeforeDeploy, set: (value: boolean) => (activeProject.value.updateBeforeDeploy = value) })
const syncPackageOwnerBeforeDeploy = computed({ get: () => activeProject.value.syncPackageOwnerBeforeDeploy, set: (value: boolean) => (activeProject.value.syncPackageOwnerBeforeDeploy = value) })
const commandOutput = computed({ get: () => activeProject.value.commandOutput, set: (value: string) => (activeProject.value.commandOutput = value) })
const terminalCommand = computed({ get: () => activeProject.value.terminalCommand, set: (value: string) => (activeProject.value.terminalCommand = value) })
const terminalEntries = computed({ get: () => activeProject.value.terminalEntries, set: (value: TerminalEntry[]) => (activeProject.value.terminalEntries = value) })
const terminalHistory = computed({ get: () => activeProject.value.terminalHistory, set: (value: string[]) => (activeProject.value.terminalHistory = value) })
const historyIndex = computed({ get: () => activeProject.value.historyIndex, set: (value: number) => (activeProject.value.historyIndex = value) })
const errorMessage = computed({ get: () => activeProject.value.errorMessage, set: (value: string) => (activeProject.value.errorMessage = value) })
const isSelecting = ref(false)
const isDraggingDirectory = ref(false)
const terminalOutput = ref<HTMLElement | null>(null)
const deploymentLogOutput = ref<HTMLElement | null>(null)
const deploymentLogPinned = ref(true)
const deployDialogOpen = ref(false)
const deploymentDockOpen = ref(false)
const isPreparingDeployment = ref(false)
const isStartingDeployment = ref(false)
const deployments = ref<Deployment[]>([])
const activeDeploymentId = ref('')
const deploymentError = ref('')
const deploymentConfig = ref<DeploymentConfigSummary | null>(null)
const deploymentOwnerAccess = ref<OwnerAccess | null>(null)
const deploymentForm = ref({ commitMessage: '', mergeTitle: '', mergeDescription: '', useCrsAiTitle: true, reviewerName: '' })
const toast = ref('')
const updateState = ref<DesktopUpdateState>({ phase: 'idle', currentVersion: appVersion })
const updateDialogOpen = ref(false)
let toastTimer: number | undefined
const deploymentPollTimers = new Map<string, number>()
let directoryDragDepth = 0
let removeDesktopOpenPathListener: (() => void) | undefined
let removeUpdateStateListener: (() => void) | undefined

const deployment = computed(() => deployments.value.find((item) => item.id === activeDeploymentId.value) || null)
const deploymentIsRunning = computed(() => deployment.value?.status === 'running')
const runningDeploymentCount = computed(() => deployments.value.filter((item) => item.status === 'running').length)
const dockDeployments = computed(() => [...deployments.value].sort((left, right) => {
  if (left.status === 'running' && right.status !== 'running') return -1
  if (left.status !== 'running' && right.status === 'running') return 1
  return new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime()
}))
const desktopPlatform = window.launchlineDesktop?.platform || 'browser'
const terminalShellLabel = desktopPlatform === 'darwin'
  ? 'macOS zsh'
  : desktopPlatform === 'win32'
    ? 'Microsoft Windows CMD'
    : 'POSIX shell'
const updatePercent = computed(() => Math.round(updateState.value.percent || 0))
const updateVisible = computed(() => desktopPlatform === 'win32' && updateState.value.phase !== 'idle')
const updateDialogVisible = computed(() => updateDialogOpen.value && ['available', 'downloading', 'downloaded', 'error'].includes(updateState.value.phase))
const currentProjectDeployment = computed(() => {
  const path = (repository.value?.root || projectPath.value).replace(/[\\/]+$/, '').toLowerCase()
  if (!path) return undefined
  return deployments.value.find((item) => item.status === 'running' && item.path.replace(/[\\/]+$/, '').toLowerCase() === path)
})
const projectIsDeploying = computed(() => Boolean(currentProjectDeployment.value))
const isBusy = computed(() => isInspecting.value || isSelecting.value || isSwitchingBranch.value || isUpdatingSubmodules.value || isSyncingPackageOwner.value || isExecutingCommand.value)
const hasRepository = computed(() => repository.value?.isGitRepository === true)
const hasOrigin = computed(() => Boolean(repository.value?.remote && repository.value.remote !== '未配置 origin'))
const canDeploy = computed(() => Boolean(
  hasRepository.value
  && !repository.value?.isProtectedBranch
  && !repository.value?.detached
  && hasOrigin.value
  && !projectIsDeploying.value
  && !isBusy.value,
))
const deploymentNeedsCommit = computed(() => repository.value?.isClean === false)
const deploymentFormValid = computed(() => Boolean(
  (!deploymentNeedsCommit.value || deploymentForm.value.commitMessage.trim())
  && (deploymentForm.value.useCrsAiTitle || deploymentForm.value.mergeTitle.trim())
  && deploymentOwnerAccess.value
  && (!deploymentOwnerAccess.value.reviewerRequired || deploymentForm.value.reviewerName),
))
const selectedReviewer = computed(() => deploymentOwnerAccess.value?.owners.find(
  (owner) => owner.displayName === deploymentForm.value.reviewerName,
))
const repositoryName = computed(() => {
  if (!repository.value?.root) return '等待选择项目'
  return repository.value.root.split(/[\\/]/).filter(Boolean).at(-1) || repository.value.root
})
const developmentBranchAvailable = computed(() => Boolean(
  repository.value?.localBranches?.includes(activeProject.value.developmentBranch),
))
const isOnDevelopmentBranch = computed(() => repository.value?.branch === activeProject.value.developmentBranch)
const checkedTime = computed(() => {
  if (!repository.value?.checkedAt) return '尚未检查'
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(repository.value.checkedAt))
})
const deployBlocker = computed(() => {
  if (!projectPath.value) return '先选择项目目录'
  if (!hasRepository.value) return '当前目录不是 Git 仓库'
  if (repository.value?.isProtectedBranch) return '请先切换到非 main / master 分支'
  if (repository.value?.detached) return '请先切换到一个工作分支'
  if (!hasOrigin.value) return '请先配置 origin 远程仓库'
  if (projectIsDeploying.value) return '当前项目正在部署，可从右下角查看进度'
  return ''
})
const ownerStatusText = computed(() => {
  const owner = repository.value?.packageOwner
  if (!hasRepository.value) return '等待项目'
  if (!repository.value?.gitUserName) return '未配置 Git user.name'
  if (!owner?.exists) return '未发现 package.json'
  if (owner.error) return owner.error
  if (!owner.ownerExists) return '没有 owner，无需修改'
  if (!owner.needsUpdate) return '当前值已一致'
  return '检测到不同值'
})

function showToast(message: string) {
  toast.value = message
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = ''), 3200)
}

function handleDeploymentLogScroll() {
  const output = deploymentLogOutput.value
  if (!output) return
  deploymentLogPinned.value = output.scrollHeight - output.scrollTop - output.clientHeight < 36
}

watch(
  () => [activeDeploymentId.value, deployment.value?.logs.length],
  async ([nextId], [previousId]) => {
    if (nextId !== previousId) deploymentLogPinned.value = true
    if (!deploymentLogPinned.value) return
    await nextTick()
    if (deploymentLogOutput.value) deploymentLogOutput.value.scrollTop = deploymentLogOutput.value.scrollHeight
  },
)

watch(() => updateState.value.phase, (phase) => {
  if (['available', 'downloaded', 'error'].includes(phase)) updateDialogOpen.value = true
})

function normalizePath(path: string) {
  return path.trim().replace(/[\\/]+$/, '').toLowerCase()
}

function projectTabName(project: ProjectWorkspace) {
  const root = project.repository?.root || project.path
  return root.split(/[\\/]/).filter(Boolean).at(-1) || '新项目'
}

function activateProject(id: string) {
  if (isBusy.value || id === activeProjectId.value) return
  activeProjectId.value = id
  directoryDragDepth = 0
  isDraggingDirectory.value = false
}

function closeProjectTab(id: string) {
  const index = projectTabs.value.findIndex((item) => item.id === id)
  const project = projectTabs.value[index]
  if (
    index === -1
    || project?.isInspecting
    || project?.isSwitchingBranch
    || project?.isUpdatingSubmodules
    || project?.isSyncingPackageOwner
    || project?.isExecutingCommand
  ) return
  projectTabs.value.splice(index, 1)
  if (!projectTabs.value.length) projectTabs.value.push(createProjectWorkspace())
  if (activeProjectId.value === id) {
    activeProjectId.value = projectTabs.value[Math.min(index, projectTabs.value.length - 1)]!.id
  }
}

function clearWorkspaceTerminal(project: ProjectWorkspace) {
  project.terminalEntries = []
  project.terminalHistory = []
  project.historyIndex = -1
  project.terminalCommand = ''
}

async function inspectWorkspace(project: ProjectWorkspace, path = project.path) {
  if (!path.trim()) {
    project.repository = null
    project.errorMessage = '请输入或选择一个项目目录'
    return
  }

  project.isInspecting = true
  project.errorMessage = ''
  project.commandOutput = ''
  try {
    const previousRoot = project.repository?.root
    const response = await fetch(`/api/repository?path=${encodeURIComponent(path.trim())}`)
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || '无法读取项目状态')
    if (previousRoot && previousRoot !== data.root) clearWorkspaceTerminal(project)
    project.path = data.root || path.trim()
    project.repository = data
  } catch (error) {
    project.repository = null
    project.errorMessage = error instanceof Error ? error.message : '无法读取项目状态'
  } finally {
    project.isInspecting = false
  }
}

async function inspect(path = projectPath.value) {
  await inspectWorkspace(activeProject.value, path)
}

async function openProjectPaths(paths: string[], records: SavedProjectRecord[] = [], activate = true) {
  const uniquePaths = [...new Set(paths.map((item) => item.trim()).filter(Boolean))]
  if (!uniquePaths.length) return
  const recordByPath = new Map(records.map((item) => [normalizePath(item.path), item]))
  const blank = projectTabs.value.length === 1 && !projectTabs.value[0]?.path && !projectTabs.value[0]?.repository
  if (blank) projectTabs.value = []

  const opened: ProjectWorkspace[] = []
  for (const path of uniquePaths) {
    const normalized = normalizePath(path)
    let project = projectTabs.value.find((item) => normalizePath(item.repository?.root || item.path) === normalized)
    if (!project) {
      project = createProjectWorkspace(path, recordByPath.get(normalized))
      projectTabs.value.push(project)
    }
    opened.push(project)
  }
  if (activate || blank) activeProjectId.value = opened[0]!.id
  await Promise.all(opened.map((project) => inspectWorkspace(project)))
}

function handlePathInput() {
  const nextPath = projectPath.value.trim().replace(/[\\/]+$/, '').toLowerCase()
  const currentRoot = repository.value?.root?.replace(/[\\/]+$/, '').toLowerCase()
  if (currentRoot && nextPath !== currentRoot) {
    repository.value = null
    clearTerminal()
  }
  errorMessage.value = ''
}

async function switchToBranch(branch: string, project = activeProject.value) {
  const currentBranch = project.repository?.branch || ''
  if (!project.repository?.isGitRepository || !branch || branch === currentBranch || project.isSwitchingBranch) return

  project.isSwitchingBranch = true
  project.errorMessage = ''
  const startedAt = Date.now()
  try {
    const response = await fetch('/api/repository/switch-branch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: project.repository?.root || project.path, branch }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || '分支切换失败')

    if (data.repository) project.repository = data.repository
    project.terminalEntries.push({
      id: Date.now(),
      command: `git switch ${branch}`,
      output: data.output || `已切换到 ${branch} 分支`,
      exitCode: 0,
      durationMs: Date.now() - startedAt,
    })
    showToast(`已切换到 ${branch} 分支`)
  } catch (error) {
    project.errorMessage = error instanceof Error ? error.message : '分支切换失败'
  } finally {
    project.isSwitchingBranch = false
  }
}

async function switchBranch(event: Event) {
  const select = event.currentTarget as HTMLSelectElement
  const branch = select.value
  const currentBranch = repository.value?.branch || ''
  if (!hasRepository.value || !branch || branch === currentBranch || isSwitchingBranch.value) return
  await switchToBranch(branch)
  select.value = repository.value?.branch || currentBranch
}

async function switchToDevelopmentBranch() {
  if (!developmentBranchAvailable.value) {
    activeProject.value.branchSetupOpen = true
    activeProject.value.developmentBranchDraft = activeProject.value.developmentBranch
    showToast(`本地没有 ${activeProject.value.developmentBranch} 分支，请选择或创建开发分支`)
    return
  }
  await switchToBranch(activeProject.value.developmentBranch)
}

async function saveDevelopmentBranch() {
  const branch = activeProject.value.developmentBranchDraft.trim()
  if (!branch || !repository.value?.localBranches?.includes(branch)) return
  activeProject.value.developmentBranch = branch
  activeProject.value.branchSetupOpen = false
  if (activeProject.value.saved) await persistProject(activeProject.value)
  if (repository.value.isClean && !projectIsDeploying.value) await switchToBranch(branch)
  else showToast(`已将 ${branch} 设为开发分支`)
}

async function createDevelopmentBranch() {
  const project = activeProject.value
  const branch = project.developmentBranchDraft.trim()
  if (!project.repository?.isGitRepository || !branch || project.isSwitchingBranch) return
  project.isSwitchingBranch = true
  project.errorMessage = ''
  const startedAt = Date.now()
  try {
    const response = await fetch('/api/repository/create-branch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: project.repository.root || project.path, branch }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || '开发分支创建失败')
    project.repository = data.repository
    project.developmentBranch = branch
    project.branchSetupOpen = false
    project.terminalEntries.push({
      id: Date.now(),
      command: `git switch -c ${branch}`,
      output: data.output || `已创建并切换到 ${branch} 分支`,
      exitCode: 0,
      durationMs: Date.now() - startedAt,
    })
    if (project.saved) await persistProject(project)
    showToast(`已创建并设定开发分支 ${branch}`)
  } catch (error) {
    project.errorMessage = error instanceof Error ? error.message : '开发分支创建失败'
  } finally {
    project.isSwitchingBranch = false
  }
}

function decodeDroppedPath(value: string) {
  const candidate = value.trim().split(/\r?\n/, 1)[0]?.trim().replace(/^['"]|['"]$/g, '') || ''
  if (!candidate) return ''
  if (!candidate.toLowerCase().startsWith('file:')) return candidate

  try {
    const url = new URL(candidate)
    const path = decodeURIComponent(url.pathname)
    return /^\/[a-zA-Z]:/.test(path) ? path.slice(1).replace(/\//g, '\\') : path
  } catch {
    return ''
  }
}

function handleDirectoryDragEnter() {
  if (isBusy.value) return
  directoryDragDepth += 1
  isDraggingDirectory.value = true
}

function handleDirectoryDragLeave() {
  directoryDragDepth = Math.max(0, directoryDragDepth - 1)
  if (!directoryDragDepth) isDraggingDirectory.value = false
}

async function handleDirectoryDrop(event: DragEvent) {
  directoryDragDepth = 0
  isDraggingDirectory.value = false
  if (isBusy.value) return

  const transfer = event.dataTransfer
  const droppedFile = transfer?.files?.[0] as (File & { path?: string }) | undefined
  let electronPath = ''
  if (droppedFile && window.launchlineDesktop) {
    try {
      electronPath = window.launchlineDesktop.getPathForFile(droppedFile)
    } catch {
      electronPath = ''
    }
  }
  const droppedPath = decodeDroppedPath(
    electronPath
      || droppedFile?.path
      || transfer?.getData('text/uri-list')
      || transfer?.getData('text/plain')
      || '',
  )

  if (!droppedPath) {
    errorMessage.value = '浏览器未提供该文件夹的完整路径，请在路径框中粘贴后按 Enter'
    return
  }

  await openProjectPaths([droppedPath])
}

async function selectDirectory() {
  isSelecting.value = true
  errorMessage.value = ''
  try {
    if (window.launchlineDesktop) {
      const paths = await window.launchlineDesktop.selectDirectories(projectPath.value.trim())
      await openProjectPaths(paths)
      return
    }
    const response = await fetch('/api/select-directory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: projectPath.value.trim() }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || '无法打开目录选择器')
    if (data.path) await openProjectPaths([data.path])
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '无法打开目录选择器'
  } finally {
    isSelecting.value = false
  }
}

function clearTerminal() {
  clearWorkspaceTerminal(activeProject.value)
}

function navigateCommandHistory(direction: -1 | 1) {
  if (!terminalHistory.value.length) return
  const nextIndex = Math.min(
    terminalHistory.value.length,
    Math.max(0, historyIndex.value + direction),
  )
  historyIndex.value = nextIndex
  terminalCommand.value = nextIndex === terminalHistory.value.length
    ? ''
    : terminalHistory.value[nextIndex]
}

function handleTerminalKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    navigateCommandHistory(-1)
  } else if (event.key === 'ArrowDown') {
    event.preventDefault()
    navigateCommandHistory(1)
  } else if (event.ctrlKey && event.key.toLowerCase() === 'l') {
    event.preventDefault()
    clearTerminal()
  }
}

async function executeTerminalCommand() {
  const command = terminalCommand.value.trim()
  if (!hasRepository.value || !command || isExecutingCommand.value) return

  isExecutingCommand.value = true
  terminalHistory.value.push(command)
  historyIndex.value = terminalHistory.value.length
  terminalCommand.value = ''
  errorMessage.value = ''

  try {
    const response = await fetch('/api/terminal/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: repository.value?.root || projectPath.value, command }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || '命令执行失败')

    terminalEntries.value.push({
      id: Date.now(),
      command,
      output: data.output || '',
      exitCode: data.exitCode,
      durationMs: data.durationMs,
    })
    if (data.repository) repository.value = data.repository
  } catch (error) {
    terminalEntries.value.push({
      id: Date.now(),
      command,
      output: error instanceof Error ? error.message : '命令执行失败',
      exitCode: 1,
      durationMs: 0,
    })
  } finally {
    isExecutingCommand.value = false
    await nextTick()
    terminalOutput.value?.scrollTo({ top: terminalOutput.value.scrollHeight, behavior: 'smooth' })
  }
}

async function updateSubmodules() {
  if (!hasRepository.value || isUpdatingSubmodules.value) return
  isUpdatingSubmodules.value = true
  commandOutput.value = ''
  errorMessage.value = ''
  try {
    const response = await fetch('/api/submodules/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: repository.value?.root || projectPath.value }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || '子包更新失败')
    repository.value = data.repository
    commandOutput.value = data.output
    showToast('子包更新完成')
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '子包更新失败'
  } finally {
    isUpdatingSubmodules.value = false
  }
}

async function syncPackageOwner() {
  if (
    !hasRepository.value
    || !syncPackageOwnerBeforeDeploy.value
    || !repository.value?.packageOwner?.canSync
    || isSyncingPackageOwner.value
  ) return

  isSyncingPackageOwner.value = true
  errorMessage.value = ''
  try {
    const response = await fetch('/api/package-owner/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: repository.value?.root || projectPath.value }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || '无法同步 package owner')
    if (data.repository) repository.value = data.repository
    showToast(data.message || 'package owner 同步完成')
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '无法同步 package owner'
  } finally {
    isSyncingPackageOwner.value = false
  }
}

async function startDeploy() {
  if (!canDeploy.value) return
  activeDeploymentId.value = ''
  deployDialogOpen.value = true
  document.body.style.overflow = 'hidden'
  isPreparingDeployment.value = true
  deploymentError.value = ''
  deploymentOwnerAccess.value = null
  deploymentForm.value = { commitMessage: '', mergeTitle: '', mergeDescription: '', useCrsAiTitle: true, reviewerName: '' }
  try {
    const response = await fetch(`/api/deployment/prefill?path=${encodeURIComponent(repository.value?.root || projectPath.value)}`)
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || '无法准备部署信息')
    deploymentForm.value = {
      commitMessage: data.commitMessage || '',
      mergeTitle: data.mergeTitle || '',
      mergeDescription: data.mergeDescription || '',
      useCrsAiTitle: true,
      reviewerName: data.ownerAccess?.reviewerRequired ? data.ownerAccess.owners?.[0]?.displayName || '' : '',
    }
    deploymentConfig.value = data.config
    deploymentOwnerAccess.value = data.ownerAccess
  } catch (error) {
    deploymentError.value = error instanceof Error ? error.message : '无法准备部署信息'
  } finally {
    isPreparingDeployment.value = false
  }
}

async function confirmDeploy() {
  if (!deploymentFormValid.value || isStartingDeployment.value) return
  isStartingDeployment.value = true
  deploymentError.value = ''
  try {
    const response = await fetch('/api/deployments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: repository.value?.root || projectPath.value,
        ...deploymentForm.value,
        updateSubmodules: updateBeforeDeploy.value,
        syncPackageOwner: syncPackageOwnerBeforeDeploy.value,
      }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || '无法启动部署')
    upsertDeployment(data)
    activeDeploymentId.value = data.id
    startDeploymentPolling(data.id)
  } catch (error) {
    deploymentError.value = error instanceof Error ? error.message : '无法启动部署'
  } finally {
    isStartingDeployment.value = false
  }
}

function upsertDeployment(nextDeployment: Deployment) {
  const index = deployments.value.findIndex((item) => item.id === nextDeployment.id)
  if (index === -1) deployments.value.unshift(nextDeployment)
  else deployments.value.splice(index, 1, nextDeployment)
}

function deploymentProjectName(item: Deployment) {
  return item.path.split(/[\\/]/).filter(Boolean).at(-1) || item.path
}

function deploymentProgressText(item: Deployment) {
  if (item.status === 'success') return '部署完成'
  if (item.status === 'failed') return '部署失败'
  if (item.status === 'cancelled') return '已取消'
  const step = item.steps.find((entry) => entry.id === item.currentStep)
  return step?.label || '正在准备'
}

function stopDeploymentPolling(id: string) {
  const timer = deploymentPollTimers.get(id)
  if (timer) window.clearInterval(timer)
  deploymentPollTimers.delete(id)
}

function startDeploymentPolling(id: string) {
  if (deploymentPollTimers.has(id)) return
  deploymentPollTimers.set(id, window.setInterval(() => void pollDeployment(id), 1000))
  void pollDeployment(id)
}

async function pollDeployment(id: string) {
  try {
    const response = await fetch(`/api/deployments/${id}`)
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || '无法读取部署状态')
    const previous = deployments.value.find((item) => item.id === id)
    upsertDeployment(data)
    if (data.status !== 'running') {
      stopDeploymentPolling(id)
      const currentRoot = repository.value?.root?.replace(/[\\/]+$/, '').toLowerCase()
      if (data.repository && currentRoot === data.path.replace(/[\\/]+$/, '').toLowerCase()) repository.value = data.repository
      if (previous?.status === 'running') {
        if (data.status === 'success') {
          const project = projectTabs.value.find((item) => normalizePath(item.repository?.root || item.path) === normalizePath(data.path))
          if (project) void persistProject(project, data.finishedAt || new Date().toISOString())
        }
        showToast(`${deploymentProjectName(data)}：${data.status === 'success' ? '部署成功' : data.status === 'cancelled' ? '部署已取消' : '部署失败'}`)
      }
    }
  } catch (error) {
    stopDeploymentPolling(id)
    if (activeDeploymentId.value === id) deploymentError.value = error instanceof Error ? error.message : '无法读取部署状态'
  }
}

const browserSavedProjectKey = 'launchline.saved-projects.v1'

function savedProjectRecord(project: ProjectWorkspace, publishedAt = project.lastPublishedAt || new Date().toISOString()): SavedProjectRecord {
  const path = project.repository?.root || project.path
  return {
    path,
    name: projectTabName(project),
    remote: project.repository?.remote && project.repository.remote !== '未配置 origin' ? project.repository.remote : undefined,
    developmentBranch: project.developmentBranch || 'dev',
    lastPublishedAt: publishedAt,
  }
}

async function persistProject(project: ProjectWorkspace, publishedAt = project.lastPublishedAt || new Date().toISOString()) {
  if (!project.repository?.isGitRepository) return
  const record = savedProjectRecord(project, publishedAt)
  try {
    if (window.launchlineDesktop) {
      await window.launchlineDesktop.saveProject(record)
    } else {
      const stored = JSON.parse(localStorage.getItem(browserSavedProjectKey) || '[]') as SavedProjectRecord[]
      const next = [record, ...stored.filter((item) => normalizePath(item.path) !== normalizePath(record.path))]
      localStorage.setItem(browserSavedProjectKey, JSON.stringify(next))
    }
    project.saved = true
    project.lastPublishedAt = record.lastPublishedAt
  } catch (error) {
    showToast(error instanceof Error ? `项目记录保存失败：${error.message}` : '项目记录保存失败')
  }
}

async function restoreSavedProjects() {
  try {
    let records: SavedProjectRecord[] = []
    let removed: SavedProjectRecord[] = []
    if (window.launchlineDesktop) {
      const result = await window.launchlineDesktop.getSavedProjects()
      records = result.projects
      removed = result.removed
    } else {
      records = JSON.parse(localStorage.getItem(browserSavedProjectKey) || '[]') as SavedProjectRecord[]
    }

    if (records.length) await openProjectPaths(records.map((item) => item.path), records, false)
    if (!window.launchlineDesktop && records.length) {
      const unavailable = projectTabs.value.filter((item) => item.saved && item.repository?.error === '目录不存在或无法访问')
      if (unavailable.length) {
        const paths = new Set(unavailable.map((item) => normalizePath(item.path)))
        localStorage.setItem(browserSavedProjectKey, JSON.stringify(records.filter((item) => !paths.has(normalizePath(item.path)))))
        unavailable.forEach((item) => closeProjectTab(item.id))
        removed = unavailable.map((item) => savedProjectRecord(item))
      }
    }
    if (removed.length) {
      const names = removed.slice(0, 2).map((item) => item.name).join('、')
      showToast(`${names}${removed.length > 2 ? ` 等 ${removed.length} 个项目` : ''}的目录不存在，记录已删除`)
    }
  } catch {
    // Saved projects are a convenience; a damaged history file must not block the workspace.
  }
}

async function restoreDeployments() {
  try {
    const response = await fetch('/api/deployments')
    if (!response.ok) return
    const data = await response.json() as Deployment[]
    deployments.value = data
    data.filter((item) => item.status === 'running').forEach((item) => startDeploymentPolling(item.id))
  } catch {
    // The workspace remains usable if the task history cannot be restored.
  }
}

async function cancelDeployment() {
  if (!deployment.value?.id || !deploymentIsRunning.value) return
  const response = await fetch(`/api/deployments/${deployment.value.id}/cancel`, { method: 'POST' })
  const data = await response.json()
  if (response.ok) upsertDeployment(data)
}

function minimizeDeployDialog() {
  deployDialogOpen.value = false
  deploymentDockOpen.value = false
  document.body.style.overflow = ''
  deploymentError.value = ''
}

function closeDeployDialog() {
  minimizeDeployDialog()
  if (!deploymentIsRunning.value) activeDeploymentId.value = ''
}

function openDeployment(item: Deployment) {
  activeDeploymentId.value = item.id
  deploymentDockOpen.value = false
  deploymentError.value = ''
  deployDialogOpen.value = true
  document.body.style.overflow = 'hidden'
}

function dismissDeployment(id: string) {
  const item = deployments.value.find((deploymentItem) => deploymentItem.id === id)
  if (!item || item.status === 'running') return
  deployments.value = deployments.value.filter((deploymentItem) => deploymentItem.id !== id)
  if (activeDeploymentId.value === id) activeDeploymentId.value = ''
}

function handleFocus() {
  if (projectPath.value && !isBusy.value) inspect()
}

function handleUpdateAction() {
  if (updateState.value.phase === 'available') {
    updateDialogOpen.value = true
    window.launchlineDesktop?.downloadUpdate()
  }
  else if (updateState.value.phase === 'downloaded') window.launchlineDesktop?.installUpdate()
  else if (updateState.value.phase === 'error') {
    updateDialogOpen.value = false
    window.launchlineDesktop?.checkForUpdates()
  }
}

onMounted(() => {
  window.addEventListener('focus', handleFocus)
  document.documentElement.dataset.platform = desktopPlatform
  removeDesktopOpenPathListener = window.launchlineDesktop?.onOpenPath((path) => {
    void openProjectPaths([path])
  })
  const desktopBridge = window.launchlineDesktop
  if (desktopBridge) {
    removeUpdateStateListener = desktopBridge.onUpdateState((state) => (updateState.value = state))
    void desktopBridge.getUpdateState().then((state) => (updateState.value = state))
  }
  void restoreSavedProjects()
  void restoreDeployments()
})
onBeforeUnmount(() => {
  window.removeEventListener('focus', handleFocus)
  removeDesktopOpenPathListener?.()
  removeUpdateStateListener?.()
  document.body.style.overflow = ''
  window.clearTimeout(toastTimer)
  deploymentPollTimers.forEach((timer) => window.clearInterval(timer))
  deploymentPollTimers.clear()
})
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <a class="brand" href="#" aria-label="Launchline 首页">
        <span class="brand-mark"><Rocket :size="17" stroke-width="2.4" /></span>
        <span>Launchline</span>
      </a>
      <div class="topbar-meta" :class="{ updating: updateVisible }">
        <span class="local-pill"><span class="live-dot"></span>本地运行</span>
        <div v-if="updateVisible" class="update-status" :class="updateState.phase" role="status" :title="updateState.message">
          <LoaderCircle v-if="updateState.phase === 'checking'" :size="13" class="spinning" />
          <template v-if="updateState.phase === 'checking'">检查更新</template>
          <template v-else-if="updateState.phase === 'up-to-date'"><Check :size="13" />已是最新</template>
          <template v-else-if="updateState.phase === 'downloading'">
            <Download :size="13" />下载 {{ updatePercent }}%
            <span class="update-progress" aria-hidden="true"><i :style="{ width: `${updatePercent}%` }"></i></span>
          </template>
          <button v-else-if="updateState.phase === 'available'" type="button" @click="handleUpdateAction">
            <Download :size="13" />下载 v{{ updateState.availableVersion }}
          </button>
          <button v-else-if="updateState.phase === 'downloaded'" type="button" @click="handleUpdateAction">
            <RefreshCw :size="13" />重启安装 v{{ updateState.availableVersion }}
          </button>
          <button v-else-if="updateState.phase === 'error'" type="button" @click="handleUpdateAction">
            <CircleAlert :size="13" />检查失败，重试
          </button>
        </div>
        <span class="version">v{{ appVersion }}</span>
      </div>
    </header>

    <section class="workspace">
      <div class="intro-row">
        <div>
          <p class="eyebrow">DEPLOY WORKSPACE</p>
          <h1>部署工作台</h1>
          <p class="intro-copy">管理项目、分支与发布任务。</p>
        </div>
        <div class="project-stamp" :class="{ active: hasRepository }">
          <FolderGit2 :size="20" />
          <div>
            <span>{{ projectTabs.length }} 个项目 · 当前项目</span>
            <strong>{{ repositoryName }}</strong>
          </div>
        </div>
      </div>

      <ol class="release-track" aria-label="部署进度">
        <li :class="{ complete: !!projectPath }">
          <span class="track-node"><Check v-if="projectPath" :size="14" /><span v-else>1</span></span>
          <div><small>01</small><strong>选择项目</strong></div>
        </li>
        <li :class="{ complete: hasRepository, current: projectPath && !hasRepository }">
          <span class="track-node"><Check v-if="hasRepository" :size="14" /><span v-else>2</span></span>
          <div><small>02</small><strong>仓库检查</strong></div>
        </li>
        <li :class="{ complete: canDeploy, current: hasRepository && !canDeploy }">
          <span class="track-node"><Check v-if="canDeploy" :size="14" /><span v-else>3</span></span>
          <div><small>03</small><strong>部署就绪</strong></div>
        </li>
      </ol>

      <nav class="project-tabbar" aria-label="已打开的项目">
        <div class="project-tabs" role="tablist">
          <div
            v-for="project in projectTabs"
            :key="project.id"
            class="project-tab"
            :class="{
              active: project.id === activeProjectId,
              deploying: deployments.some((item) => item.status === 'running' && normalizePath(item.path) === normalizePath(project.repository?.root || project.path)),
              invalid: project.repository && !project.repository.isGitRepository,
            }"
          >
            <button
              class="project-tab-main"
              type="button"
              role="tab"
              :aria-selected="project.id === activeProjectId"
              :disabled="isBusy"
              @click="activateProject(project.id)"
            >
              <span class="project-tab-state" aria-hidden="true"></span>
              <span class="project-tab-copy">
                <strong>{{ projectTabName(project) }}</strong>
                <small>{{ project.repository?.branch || (project.path ? '读取仓库…' : '选择项目目录') }}</small>
              </span>
              <History v-if="project.saved" :size="13" aria-label="已保存项目" />
            </button>
            <button
              class="project-tab-close"
              type="button"
              title="关闭项目标签"
              :aria-label="`关闭 ${projectTabName(project)}`"
              :disabled="isBusy"
              @click="closeProjectTab(project.id)"
            >
              <X :size="14" />
            </button>
          </div>
        </div>
        <button
          class="add-project-button"
          type="button"
          title="添加一个或多个项目"
          :disabled="isBusy"
          @click="selectDirectory"
        >
          <LoaderCircle v-if="isSelecting" :size="16" class="spinning" />
          <FolderPlus v-else :size="16" />
          <span>添加项目</span>
        </button>
      </nav>

      <div v-if="repository?.isProtectedBranch" class="persistent-warning" role="alert">
        <ShieldAlert :size="21" />
        <div>
          <strong>当前位于 {{ repository.branch }} 分支</strong>
          <span>主分支受保护，请使用下方按钮切换到开发分支。</span>
        </div>
      </div>

      <div class="content-grid">
        <section class="main-panel" aria-labelledby="project-title">
          <div class="section-heading">
            <div>
              <span class="step-label">项目来源</span>
              <h2 id="project-title">本地 Git 项目</h2>
            </div>
            <button
              class="icon-button"
              type="button"
              title="刷新仓库状态"
              aria-label="刷新仓库状态"
              :disabled="!projectPath || isBusy"
              @click="inspect()"
            >
              <RefreshCw :size="18" :class="{ spinning: isInspecting }" />
            </button>
          </div>

          <div
            class="path-drop-zone"
            :class="{ dragging: isDraggingDirectory, disabled: isBusy }"
            @dragenter.prevent="handleDirectoryDragEnter"
            @dragover.prevent
            @dragleave.prevent="handleDirectoryDragLeave"
            @drop.prevent="handleDirectoryDrop"
          >
            <div class="path-control">
              <div class="path-input-wrap">
                <FolderGit2 :size="18" />
                <input
                  v-model="projectPath"
                  type="text"
                  spellcheck="false"
                  placeholder="输入项目完整路径"
                  aria-label="项目目录"
                  @input="handlePathInput"
                  @keyup.enter="inspect()"
                />
                <button
                  class="path-submit"
                  type="button"
                  title="检查该路径"
                  aria-label="检查该路径"
                  :disabled="!projectPath.trim() || isBusy"
                  @click="inspect()"
                >
                  <ArrowRight :size="16" />
                </button>
              </div>
              <button class="secondary-button" type="button" :disabled="isBusy" @click="selectDirectory">
                <LoaderCircle v-if="isSelecting" :size="17" class="spinning" />
                <FolderGit2 v-else :size="17" />
                选择目录
              </button>
            </div>
            <div v-if="isDraggingDirectory" class="path-drop-overlay" aria-hidden="true">
              <FolderInput :size="20" />
              <strong>松开以读取此项目</strong>
            </div>
          </div>

          <p v-if="errorMessage" class="inline-error" role="alert">
            <CircleAlert :size="16" />{{ errorMessage }}
          </p>

          <div v-if="repository && !repository.isGitRepository" class="empty-state invalid">
            <AlertTriangle :size="25" />
            <div>
              <strong>Git 仓库不可用</strong>
              <span>{{ repository.error }}，部署相关功能已锁定。</span>
            </div>
          </div>

          <div v-else-if="hasRepository" class="repo-details">
            <section class="development-branch" :class="{ ready: developmentBranchAvailable, current: isOnDevelopmentBranch }">
              <div class="development-branch-summary">
                <span class="development-branch-icon"><GitBranch :size="17" /></span>
                <div>
                  <small>开发分支</small>
                  <strong>{{ activeProject.developmentBranch }}</strong>
                  <span v-if="isOnDevelopmentBranch">当前已在开发分支</span>
                  <span v-else-if="developmentBranchAvailable">本地分支已就绪</span>
                  <span v-else>本地尚未创建此分支</span>
                </div>
              </div>
              <div class="development-branch-actions">
                <button
                  class="icon-button"
                  type="button"
                  title="配置开发分支"
                  aria-label="配置开发分支"
                  :disabled="isBusy || projectIsDeploying"
                  @click="activeProject.branchSetupOpen = !activeProject.branchSetupOpen; activeProject.developmentBranchDraft = activeProject.developmentBranch"
                >
                  <Settings2 :size="16" />
                </button>
                <button
                  class="development-switch-button"
                  type="button"
                  :disabled="isOnDevelopmentBranch || !repository?.isClean || isBusy || projectIsDeploying"
                  :title="!repository?.isClean ? '工作区存在未提交改动，无法切换分支' : '切换到开发分支'"
                  @click="switchToDevelopmentBranch"
                >
                  <LoaderCircle v-if="isSwitchingBranch" :size="15" class="spinning" />
                  <GitBranch v-else :size="15" />
                  {{ isOnDevelopmentBranch ? '已在开发分支' : `切换到 ${activeProject.developmentBranch}` }}
                </button>
              </div>
              <div v-if="activeProject.branchSetupOpen" class="development-branch-setup">
                <label>
                  <span>选择本地分支</span>
                  <select v-model="activeProject.developmentBranchDraft">
                    <option value="" disabled>请选择分支</option>
                    <option v-for="branch in repository?.localBranches" :key="branch" :value="branch">{{ branch }}</option>
                  </select>
                </label>
                <button
                  class="branch-secondary-button"
                  type="button"
                  :disabled="!repository?.localBranches?.includes(activeProject.developmentBranchDraft) || isSwitchingBranch"
                  @click="saveDevelopmentBranch"
                >
                  {{ repository?.isClean && !projectIsDeploying ? '设定并切换' : '设为开发分支' }}
                </button>
                <span class="branch-setup-divider">或创建</span>
                <label class="branch-create-field">
                  <span>新开发分支</span>
                  <input v-model="activeProject.developmentBranchDraft" type="text" spellcheck="false" placeholder="dev" />
                </label>
                <code>git switch -c {{ activeProject.developmentBranchDraft || 'dev' }}</code>
                <button
                  class="branch-create-button"
                  type="button"
                  :disabled="!repository?.isClean || !activeProject.developmentBranchDraft.trim() || repository?.localBranches?.includes(activeProject.developmentBranchDraft.trim()) || isSwitchingBranch"
                  :title="!repository?.isClean ? '工作区存在未提交改动，无法创建分支' : '创建并选择开发分支'"
                  @click="createDevelopmentBranch"
                >
                  <Plus :size="15" />创建并选择
                </button>
              </div>
            </section>

            <dl class="repo-facts">
              <div>
                <dt><GitBranch :size="15" />当前分支</dt>
                <dd class="branch-fact" :class="{ warning: repository?.isProtectedBranch }">
                  <select
                    :value="repository?.branch"
                    :disabled="!repository?.isClean || isBusy || projectIsDeploying || (repository?.localBranches?.length || 0) < 2"
                    :title="!repository?.isClean ? '工作区存在未提交改动，无法切换分支' : projectIsDeploying ? '当前项目正在部署' : '切换本地分支'"
                    aria-label="切换本地分支"
                    @change="switchBranch"
                  >
                    <option v-for="branch in repository?.localBranches" :key="branch" :value="branch">
                      {{ branch }}
                    </option>
                  </select>
                  <LoaderCircle v-if="isSwitchingBranch" :size="13" class="spinning" />
                </dd>
              </div>
              <div>
                <dt><GitCommitHorizontal :size="15" />当前提交</dt>
                <dd>{{ repository?.commit }}</dd>
              </div>
              <div class="remote-fact">
                <dt><Github :size="15" />远程仓库</dt>
                <dd :title="repository?.remote">{{ repository?.remote }}</dd>
              </div>
            </dl>

            <div class="workspace-status" :class="repository?.isClean ? 'clean' : 'dirty'">
              <CheckCircle2 v-if="repository?.isClean" :size="21" />
              <AlertTriangle v-else :size="21" />
              <div>
                <strong>{{ repository?.isClean ? '工作区干净' : `发现 ${repository?.changes?.length || 0} 项未提交改动` }}</strong>
                <span>{{ repository?.isClean ? 'git status 未发现需要处理的文件' : '这些改动将在部署前使用提交信息自动提交' }}</span>
              </div>
              <time>{{ checkedTime }}</time>
            </div>

            <div v-if="repository?.changes?.length" class="change-list">
              <div v-for="change in repository.changes.slice(0, 5)" :key="change">
                <code>{{ change.slice(0, 2) }}</code>
                <span>{{ change.slice(3) }}</span>
              </div>
              <small v-if="repository.changes.length > 5">另有 {{ repository.changes.length - 5 }} 项改动</small>
            </div>
          </div>

          <div v-else-if="!repository" class="empty-state">
            <TerminalSquare :size="25" />
            <div>
              <strong>从项目目录开始</strong>
              <span>选择后会自动读取分支、提交和工作区状态。</span>
            </div>
          </div>
        </section>

        <aside class="side-panel" aria-labelledby="options-title">
          <div class="section-heading compact">
            <div>
              <span class="step-label">部署选项</span>
              <h2 id="options-title">执行设置</h2>
            </div>
          </div>

          <label class="option-row" :class="{ disabled: !hasRepository }">
            <input v-model="updateBeforeDeploy" type="checkbox" :disabled="!hasRepository" />
            <span class="checkbox-ui"><Check :size="13" /></span>
            <span class="option-copy">
              <strong>部署前更新子包</strong>
              <small>递归同步远程 submodule</small>
            </span>
            <PackageCheck :size="20" />
          </label>

          <div class="command-block" :class="{ disabled: !hasRepository }">
            <div class="command-heading">
              <span>执行命令</span>
              <button
                type="button"
                title="立即更新子包"
                aria-label="立即更新子包"
                :disabled="!hasRepository || isBusy || projectIsDeploying"
                @click="updateSubmodules"
              >
                <LoaderCircle v-if="isUpdatingSubmodules" :size="16" class="spinning" />
                <Play v-else :size="16" fill="currentColor" />
              </button>
            </div>
            <code>git submodule update<br />--remote --recursive</code>
          </div>

          <div v-if="commandOutput" class="command-output">
            <span>OUTPUT</span>
            <pre>{{ commandOutput }}</pre>
          </div>

          <label class="option-row owner-option" :class="{ disabled: !hasRepository }">
            <input v-model="syncPackageOwnerBeforeDeploy" type="checkbox" :disabled="!hasRepository" />
            <span class="checkbox-ui"><Check :size="13" /></span>
            <span class="option-copy">
              <strong>同步 package owner</strong>
              <small>使用当前 Git 用户名</small>
            </span>
            <FileJson :size="20" />
          </label>

          <div class="owner-sync" :class="{ disabled: !hasRepository || !syncPackageOwnerBeforeDeploy }">
            <div class="owner-sync-heading">
              <span>{{ ownerStatusText }}</span>
              <button
                type="button"
                title="同步 package owner"
                aria-label="同步 package owner"
                :disabled="!hasRepository || !syncPackageOwnerBeforeDeploy || !repository?.packageOwner?.canSync || isBusy || projectIsDeploying"
                @click="syncPackageOwner"
              >
                <LoaderCircle v-if="isSyncingPackageOwner" :size="16" class="spinning" />
                <UserRoundCheck v-else :size="16" />
              </button>
            </div>
            <div class="owner-values">
              <span>
                <small>PACKAGE OWNER</small>
                <code>{{ repository?.packageOwner?.ownerName || '—' }}</code>
              </span>
              <ArrowRight :size="14" />
              <span>
                <small>GIT USER</small>
                <code>{{ repository?.gitUserName || '—' }}</code>
              </span>
            </div>
          </div>

          <div class="readiness">
            <h3>部署条件</h3>
            <ul>
              <li :class="{ pass: hasRepository }">
                <span><Check v-if="hasRepository" :size="13" /><X v-else :size="13" /></span>有效的 Git 仓库
              </li>
              <li :class="{ pass: hasRepository && !repository?.isProtectedBranch && !repository?.detached }">
                <span><Check v-if="hasRepository && !repository?.isProtectedBranch && !repository?.detached" :size="13" /><X v-else :size="13" /></span>非主分支
              </li>
              <li :class="{ pass: hasRepository }">
                <span><Check v-if="hasRepository" :size="13" /><X v-else :size="13" /></span>
                {{ !hasRepository ? '工作区状态' : repository?.isClean ? '工作区干净' : `${repository?.changes?.length || 0} 项改动将自动提交` }}
              </li>
            </ul>
          </div>
        </aside>
      </div>

      <section class="terminal-panel" :class="{ disabled: !hasRepository }" aria-labelledby="terminal-title">
        <div class="terminal-toolbar">
          <div class="terminal-title-group">
            <span class="terminal-icon"><TerminalSquare :size="16" /></span>
            <div>
              <span class="terminal-kicker">PROJECT CMD</span>
              <h2 id="terminal-title">项目终端</h2>
            </div>
          </div>
          <div class="terminal-context">
            <span>{{ hasRepository ? repository?.root : '选择 Git 项目后启用' }}</span>
            <button
              type="button"
              title="清空终端"
              aria-label="清空终端"
              :disabled="!terminalEntries.length || isExecutingCommand"
              @click="clearTerminal"
            >
              <Eraser :size="16" />
            </button>
          </div>
        </div>

        <div ref="terminalOutput" class="terminal-output" aria-live="polite">
          <div v-if="!terminalEntries.length" class="terminal-welcome">
            <span>{{ terminalShellLabel }}</span>
            <code>{{ hasRepository ? `${repositoryName}>` : 'cmd>' }}</code>
          </div>
          <div v-for="entry in terminalEntries" :key="entry.id" class="terminal-entry">
            <div class="terminal-command-line">
              <span class="terminal-prompt">{{ repositoryName }}&gt;</span>
              <code>{{ entry.command }}</code>
            </div>
            <pre v-if="entry.output">{{ entry.output }}</pre>
            <div class="terminal-result" :class="entry.exitCode === 0 ? 'success' : 'failure'">
              <span>{{ entry.exitCode === 0 ? '执行成功' : `退出码 ${entry.exitCode}` }}</span>
              <span><Clock3 :size="11" />{{ entry.durationMs }} ms</span>
            </div>
          </div>
          <div v-if="isExecutingCommand" class="terminal-running">
            <LoaderCircle :size="14" class="spinning" />正在执行命令...
          </div>
        </div>

        <form class="terminal-input-row" @submit.prevent="executeTerminalCommand">
          <span class="terminal-prompt">{{ hasRepository ? `${repositoryName}>` : 'cmd>' }}</span>
          <input
            v-model="terminalCommand"
            type="text"
            autocomplete="off"
            spellcheck="false"
            aria-label="终端命令"
            placeholder="git switch feature/..."
            :disabled="!hasRepository || isExecutingCommand || projectIsDeploying"
            @keydown="handleTerminalKeydown"
          />
          <button
            type="submit"
            title="执行命令"
            aria-label="执行命令"
            :disabled="!hasRepository || !terminalCommand.trim() || isExecutingCommand || projectIsDeploying"
          >
            <LoaderCircle v-if="isExecutingCommand" :size="16" class="spinning" />
            <Play v-else :size="15" fill="currentColor" />
          </button>
        </form>
      </section>

      <footer class="deploy-bar">
        <div class="deploy-summary">
          <span :class="{ ready: canDeploy }"><CheckCircle2 v-if="canDeploy" :size="18" /><CircleAlert v-else :size="18" /></span>
          <div>
            <strong>{{ canDeploy ? '可以开始部署' : '尚未满足部署条件' }}</strong>
            <small>{{ canDeploy ? `${repository?.branch} · ${repository?.isClean ? repository?.commit : `${repository?.changes?.length || 0} 项待提交`}` : deployBlocker }}</small>
          </div>
        </div>
        <button class="deploy-button" type="button" :disabled="!canDeploy" @click="startDeploy">
          一键部署
          <ArrowRight :size="18" />
        </button>
      </footer>
    </section>

    <div v-if="deployDialogOpen" class="deploy-dialog-backdrop">
      <section class="deploy-dialog" :class="{ 'deployment-run-dialog': deployment }" role="dialog" aria-modal="true" aria-labelledby="deploy-dialog-title">
        <header class="deploy-dialog-header">
          <div class="deploy-dialog-title">
            <span><GitPullRequestArrow :size="19" /></span>
            <div>
              <small>{{ deployment ? 'DEPLOYMENT RUN' : 'DEPLOYMENT PLAN' }}</small>
              <h2 id="deploy-dialog-title">
                {{ deployment
                  ? `${deploymentProjectName(deployment)} · ${deployment.status === 'running' ? '部署进行中' : deployment.status === 'success' ? '部署完成' : '部署已停止'}`
                  : '确认一键部署' }}
              </h2>
            </div>
          </div>
          <button
            class="dialog-close"
            type="button"
            :title="deploymentIsRunning ? '收起部署窗口' : '关闭'"
            :aria-label="deploymentIsRunning ? '收起部署窗口' : '关闭'"
            @click="deploymentIsRunning ? minimizeDeployDialog() : closeDeployDialog()"
          >
            <Minimize2 v-if="deploymentIsRunning" :size="18" />
            <X v-else :size="18" />
          </button>
        </header>

        <div v-if="isPreparingDeployment" class="deploy-dialog-loading">
          <LoaderCircle :size="22" class="spinning" />
          <span>正在读取 Git 提交记录...</span>
        </div>

        <template v-else-if="!deployment">
          <div class="deploy-route" aria-label="部署路径">
            <span><small>来源</small><strong>{{ repository?.branch }}</strong></span>
            <ArrowRight :size="15" />
            <span><small>合并</small><strong>{{ deploymentConfig?.targetBranch || 'master' }}</strong></span>
            <ArrowRight :size="15" />
            <span><small>测试</small><strong>{{ deploymentConfig?.testTask || 'mtat-prod' }}</strong></span>
            <ArrowRight :size="15" />
            <span><small>生产</small><strong>{{ deploymentConfig?.productionEnvironment || '国内(PROD)' }}</strong></span>
          </div>

          <div v-if="deploymentOwnerAccess" class="owner-access-band" :class="deploymentOwnerAccess.isCurrentUserOwner ? 'authorized' : 'review-required'">
            <UserRoundCheck v-if="deploymentOwnerAccess.isCurrentUserOwner" :size="18" />
            <ShieldAlert v-else :size="18" />
            <div>
              <strong>
                {{ deploymentOwnerAccess.isCurrentUserOwner
                  ? `${deploymentOwnerAccess.currentGitUser} 是项目 Owner，可自行合并`
                  : `当前 Git 用户 ${deploymentOwnerAccess.currentGitUser || '未配置'} 不是项目 Owner` }}
              </strong>
              <span v-if="deploymentOwnerAccess.isCurrentUserOwner">
                {{ deploymentOwnerAccess.owners.map((owner) => owner.displayName).join('、') }}
              </span>
              <span v-else>请指定审核人，并通知对方执行合并分支。</span>
            </div>
            <label v-if="deploymentOwnerAccess.reviewerRequired" class="reviewer-select">
              <span>审核人</span>
              <select v-model="deploymentForm.reviewerName" required>
                <option v-for="owner in deploymentOwnerAccess.owners" :key="owner.displayName" :value="owner.displayName">
                  {{ owner.displayName }}{{ owner.gitUserName ? ` · ${owner.gitUserName}` : ' · 未配置映射' }}
                </option>
              </select>
            </label>
          </div>

          <p v-if="deploymentOwnerAccess?.reviewerRequired && selectedReviewer" class="reviewer-notice">
            请通知 <strong>{{ selectedReviewer.displayName }}</strong>（{{ selectedReviewer.gitUserName || '未配置 Git 用户名' }}）进行合并分支
          </p>

          <form class="deploy-form" @submit.prevent="confirmDeploy">
            <label>
              <span>提交信息 <small>{{ deploymentNeedsCommit ? '当前有改动，必填' : '可选，无改动时跳过' }}</small></span>
              <input
                v-model="deploymentForm.commitMessage"
                type="text"
                maxlength="300"
                :required="deploymentNeedsCommit"
                placeholder="chore: 更新部署内容"
              />
            </label>
            <div class="form-field merge-title-field">
              <div class="field-label">
                Merge 总结标题
                <label class="ai-title-choice">
                  <input v-model="deploymentForm.useCrsAiTitle" type="checkbox" />
                  <span class="checkbox-ui"><Check :size="11" /></span>
                  优先使用 crs2 AI
                </label>
              </div>
              <input
                v-model="deploymentForm.mergeTitle"
                type="text"
                maxlength="300"
                :disabled="deploymentForm.useCrsAiTitle"
                :required="!deploymentForm.useCrsAiTitle"
                :placeholder="deploymentForm.useCrsAiTitle ? '由 crs2 AI 生成' : 'feat(scope): 完善合并内容'"
              />
              <small class="field-note">
                {{ deploymentForm.useCrsAiTitle ? '执行合并时接受框架生成标题并在日志中回显；关闭 AI 后使用此处内容。' : '将直接使用此 Angular 风格标题。' }}
              </small>
            </div>
            <label class="full-field">
              <span>Merge 具体描述 <small>可选</small></span>
              <textarea v-model="deploymentForm.mergeDescription" rows="5" maxlength="4000" placeholder="可留空"></textarea>
            </label>
          </form>

          <div class="deploy-option-summary">
            <span :class="{ enabled: updateBeforeDeploy }"><PackageCheck :size="15" />更新子包</span>
            <span :class="{ enabled: syncPackageOwnerBeforeDeploy }"><FileJson :size="15" />同步 owner</span>
            <code>deploy.workflow.json</code>
          </div>
        </template>

        <template v-else>
          <div class="deployment-overview" :class="deployment.status">
            <div>
              <LoaderCircle v-if="deployment.status === 'running'" :size="21" class="spinning" />
              <CheckCircle2 v-else-if="deployment.status === 'success'" :size="21" />
              <CircleAlert v-else :size="21" />
              <span>
                <strong>{{ deployment.status === 'running' ? '正在执行部署流程' : deployment.status === 'success' ? '全部步骤已完成' : deployment.error }}</strong>
                <small>{{ deployment.sourceBranch }} → {{ deployment.targetBranch }}</small>
              </span>
            </div>
            <time>{{ new Date(deployment.startedAt).toLocaleTimeString('zh-CN', { hour12: false }) }}</time>
          </div>

          <ol class="deployment-steps">
            <li v-for="(step, index) in deployment.steps" :key="step.id" :class="step.status">
              <span class="deployment-step-icon">
                <LoaderCircle v-if="step.status === 'running'" :size="14" class="spinning" />
                <Check v-else-if="step.status === 'success'" :size="14" />
                <X v-else-if="step.status === 'failed'" :size="14" />
                <span v-else>{{ index + 1 }}</span>
              </span>
              <div>
                <strong>{{ step.label }}</strong>
                <small>{{ step.detail || step.command || '等待执行' }}</small>
              </div>
            </li>
          </ol>

          <div class="deployment-log">
            <div class="deployment-log-title"><TerminalSquare :size="14" />执行日志</div>
            <div ref="deploymentLogOutput" class="deployment-log-output" @scroll="handleDeploymentLogScroll">
              <div v-for="log in deployment.logs.slice(-80)" :key="log.id" :class="log.level">
                <time>{{ new Date(log.at).toLocaleTimeString('zh-CN', { hour12: false }) }}</time>
                <pre>{{ log.message }}</pre>
              </div>
            </div>
          </div>
        </template>

        <p v-if="deploymentError" class="deploy-dialog-error" role="alert"><CircleAlert :size="16" />{{ deploymentError }}</p>

        <footer class="deploy-dialog-actions">
          <template v-if="!deployment">
            <button class="dialog-secondary" type="button" @click="closeDeployDialog">取消</button>
            <button
              class="dialog-primary"
              type="button"
              :disabled="!deploymentFormValid || isPreparingDeployment || isStartingDeployment"
              @click="confirmDeploy"
            >
              <LoaderCircle v-if="isStartingDeployment" :size="16" class="spinning" />
              <Send v-else :size="16" />
              开始部署
            </button>
          </template>
          <template v-else-if="deploymentIsRunning">
            <span class="polling-note">
              生产发布每 {{ deploymentConfig?.productionIntervalSeconds || 60 }} 秒重试，最多 {{ deploymentConfig?.productionMaxAttempts || 10 }} 次
            </span>
            <button class="dialog-secondary" type="button" @click="minimizeDeployDialog">收起窗口</button>
            <button class="dialog-danger" type="button" @click="cancelDeployment">取消部署</button>
          </template>
          <button v-else class="dialog-primary" type="button" @click="closeDeployDialog">关闭</button>
        </footer>
      </section>
    </div>

    <div v-if="updateDialogVisible" class="update-dialog-backdrop" role="presentation">
      <section class="update-dialog" role="dialog" aria-modal="true" aria-labelledby="update-dialog-title">
        <header class="update-dialog-header">
          <div class="update-dialog-title">
            <span :class="updateState.phase">
              <Download v-if="updateState.phase === 'available' || updateState.phase === 'downloading'" :size="19" />
              <Check v-else-if="updateState.phase === 'downloaded'" :size="19" />
              <CircleAlert v-else :size="19" />
            </span>
            <div>
              <small>APPLICATION UPDATE</small>
              <h2 id="update-dialog-title">
                {{ updateState.phase === 'available' ? '发现新版本' : updateState.phase === 'downloading' ? '正在下载更新' : updateState.phase === 'downloaded' ? '更新已准备好' : '更新失败' }}
              </h2>
            </div>
          </div>
          <button class="dialog-close" type="button" title="稍后处理" aria-label="稍后处理" @click="updateDialogOpen = false"><X :size="17" /></button>
        </header>

        <div class="update-dialog-body">
          <div class="update-version-route">
            <span><small>当前版本</small><strong>v{{ updateState.currentVersion }}</strong></span>
            <ArrowRight :size="18" />
            <span><small>目标版本</small><strong>v{{ updateState.availableVersion || '—' }}</strong></span>
          </div>

          <template v-if="updateState.phase === 'available'">
            <p>新版本已发布，可以立即下载。下载期间仍可继续使用当前项目。</p>
          </template>
          <template v-else-if="updateState.phase === 'downloading'">
            <div class="update-download-heading"><span>下载安装包</span><strong>{{ updatePercent }}%</strong></div>
            <div class="update-download-track" role="progressbar" aria-label="更新下载进度" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="updatePercent">
              <span :style="{ width: `${updatePercent}%` }"></span>
            </div>
            <p>可以收起窗口继续工作，下载进度会保留在顶部状态栏。</p>
          </template>
          <template v-else-if="updateState.phase === 'downloaded'">
            <p>安装包已经下载完成。点击重启后会退出当前应用、完成安装并自动打开新版本。</p>
          </template>
          <template v-else>
            <p class="update-error-message">{{ updateState.message || '暂时无法获取更新，请检查网络后重试。' }}</p>
          </template>
        </div>

        <footer class="update-dialog-actions">
          <button class="dialog-secondary" type="button" @click="updateDialogOpen = false">
            {{ updateState.phase === 'downloading' ? '后台下载' : updateState.phase === 'downloaded' ? '下次启动安装' : '稍后处理' }}
          </button>
          <button v-if="updateState.phase !== 'downloading'" class="dialog-primary" type="button" @click="handleUpdateAction">
            <Download v-if="updateState.phase === 'available'" :size="15" />
            <RefreshCw v-else :size="15" />
            {{ updateState.phase === 'available' ? '下载更新' : updateState.phase === 'downloaded' ? '立即重启并安装' : '重新检查' }}
          </button>
        </footer>
      </section>
    </div>

    <aside v-if="deployments.length && !deployDialogOpen" class="deployment-dock" :class="{ open: deploymentDockOpen }" aria-label="部署任务">
      <button
        class="deployment-dock-toggle"
        type="button"
        :aria-expanded="deploymentDockOpen"
        aria-controls="deployment-task-list"
        @click="deploymentDockOpen = !deploymentDockOpen"
      >
        <span class="deployment-dock-icon"><Layers3 :size="17" /></span>
        <span>
          <strong>部署任务</strong>
          <small>{{ runningDeploymentCount ? `${runningDeploymentCount} 个正在进行` : `${deployments.length} 条记录` }}</small>
        </span>
        <ChevronRight :size="16" :class="{ expanded: deploymentDockOpen }" />
      </button>
      <div v-if="deploymentDockOpen" id="deployment-task-list" class="deployment-dock-list">
        <div v-for="item in dockDeployments" :key="item.id" class="deployment-dock-item" :class="item.status">
          <button type="button" class="deployment-dock-main" @click="openDeployment(item)">
            <span class="deployment-dock-status">
              <LoaderCircle v-if="item.status === 'running'" :size="15" class="spinning" />
              <Check v-else-if="item.status === 'success'" :size="15" />
              <X v-else :size="15" />
            </span>
            <span class="deployment-dock-copy">
              <strong>{{ deploymentProjectName(item) }}</strong>
              <small>{{ deploymentProgressText(item) }}</small>
            </span>
            <span class="deployment-dock-branch">{{ item.sourceBranch }}</span>
          </button>
          <button
            v-if="item.status !== 'running'"
            type="button"
            class="deployment-dock-dismiss"
            title="移除此记录"
            aria-label="移除此记录"
            @click="dismissDeployment(item.id)"
          >
            <X :size="13" />
          </button>
        </div>
      </div>
    </aside>

    <Transition name="toast">
      <div v-if="toast" class="toast" role="status">
        <CheckCircle2 :size="18" />{{ toast }}
        <ChevronRight :size="15" />
      </div>
    </Transition>
  </main>
</template>
