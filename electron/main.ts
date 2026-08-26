import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app as electronApp,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  screen,
  Tray,
  type MessageBoxOptions,
} from 'electron'
import { autoUpdater } from 'electron-updater'
import { getDeploymentsSnapshot, getRunningDeploymentCount } from '../server/deployment.ts'
import { startServer, stopServer } from '../server/index.ts'

const currentDir = dirname(fileURLToPath(import.meta.url))
const configuredServerPort = Number(process.env.PORT || 0)
let appUrl = ''
const preloadPath = join(currentDir, 'preload.cjs')
const floatingPagePath = join(currentDir, '..', 'electron', 'floating.html')

let mainWindow: BrowserWindow | undefined
let floatingWindow: BrowserWindow | undefined
let tray: Tray | undefined
let forceQuit = false
let pendingOpenPath = ''
let statusTimer: NodeJS.Timeout | undefined
let updateTimer: NodeJS.Timeout | undefined
let updatePromptOpen = false
let updateDownloading = false
const previousStatuses = new Map<string, string>()
const previewDeploymentCount = process.env.LAUNCHLINE_FLOATING_PREVIEW === '1' ? 1 : 0

const iconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#303733"/>
  <path d="M20 42c9-2 20-11 23-25 4 1 7 4 8 8-2 12-10 21-23 25l-8-8Z" fill="#8ed0ad"/>
  <circle cx="39" cy="27" r="4" fill="#fbfcf9"/>
  <path d="M19 35l-6 7 9 1M29 47l-5 7-2-9" fill="none" stroke="#fbfcf9" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`

function desktopIcon() {
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(iconSvg).toString('base64')}`)
}

function hydrateMacShellEnvironment() {
  if (process.platform !== 'darwin') return
  const shell = process.env.SHELL || '/bin/zsh'
  try {
    const shellPath = execFileSync(shell, ['-ilc', 'printf %s "$PATH"'], {
      encoding: 'utf8',
      timeout: 5000,
    }).trim()
    if (shellPath) process.env.PATH = shellPath
    process.env.SHELL = shell
  } catch {
    process.env.PATH = [
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
      process.env.PATH || '',
    ].filter(Boolean).join(':')
  }
}

function validDirectory(path: string) {
  try {
    return Boolean(path && existsSync(path) && statSync(path).isDirectory())
  } catch {
    return false
  }
}

function runningDeploymentCount() {
  return Math.max(previewDeploymentCount, getRunningDeploymentCount())
}

function extractDirectoryArgument(args: string[], workingDirectory = process.cwd()) {
  for (const argument of args) {
    if (!argument || argument === '.' || argument.startsWith('--')) continue
    const candidate = isAbsolute(argument) ? argument : resolve(workingDirectory, argument)
    if (candidate !== resolve(process.cwd()) && validDirectory(candidate)) return candidate
  }
  return ''
}

function sendOpenPath(path: string) {
  if (!validDirectory(path)) return
  pendingOpenPath = path
  showMainWindow()
  if (mainWindow && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send('desktop:open-path', path)
    pendingOpenPath = ''
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 920,
    minWidth: 390,
    minHeight: 680,
    show: false,
    backgroundColor: '#eef0ed',
    icon: desktopIcon(),
    title: 'Launchline',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  void mainWindow.loadURL(appUrl)
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingOpenPath) {
      mainWindow?.webContents.send('desktop:open-path', pendingOpenPath)
      pendingOpenPath = ''
    }
  })
  mainWindow.on('close', (event) => {
    if (forceQuit || runningDeploymentCount() === 0) return
    event.preventDefault()
    mainWindow?.hide()
    showFloatingWindow()
  })
  mainWindow.on('closed', () => {
    mainWindow = undefined
  })
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow()
  floatingWindow?.hide()
  mainWindow?.show()
  mainWindow?.focus()
}

function ensureTray() {
  if (tray) return
  tray = new Tray(desktopIcon().resize({ width: 18, height: 18 }))
  tray.setToolTip('Launchline')
  tray.on('click', showMainWindow)
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 Launchline', click: showMainWindow },
    { label: '显示部署悬浮球', click: showFloatingWindow },
    { label: '隐藏部署悬浮球', click: () => floatingWindow?.hide() },
    { type: 'separator' },
    { label: '退出应用', click: quitApplication },
  ]))
}

function createFloatingWindow() {
  const { workArea } = screen.getPrimaryDisplay()
  floatingWindow = new BrowserWindow({
    width: 82,
    height: 82,
    x: workArea.x + workArea.width - 102,
    y: workArea.y + workArea.height - 112,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  floatingWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  floatingWindow.setAlwaysOnTop(true, 'floating')
  floatingWindow.webContents.on('context-menu', () => {
    Menu.buildFromTemplate([
      { label: '打开部署任务', click: showMainWindow },
      { label: '隐藏悬浮球', click: () => floatingWindow?.hide() },
      { type: 'separator' },
      { label: '退出 Launchline', click: quitApplication },
    ]).popup({ window: floatingWindow })
  })
  floatingWindow.on('closed', () => {
    floatingWindow = undefined
  })
  void floatingWindow.loadFile(floatingPagePath)
}

function showFloatingWindow() {
  ensureTray()
  if (!floatingWindow || floatingWindow.isDestroyed()) createFloatingWindow()
  floatingWindow?.showInactive()
  floatingWindow?.webContents.send('desktop:deployment-count', runningDeploymentCount())
}

function quitApplication() {
  forceQuit = true
  electronApp.quit()
}

function showDeploymentNotification(path: string, status: string, error?: string) {
  const success = status === 'success'
  const notification = new Notification({
    title: success ? '部署成功' : status === 'cancelled' ? '部署已取消' : '部署失败',
    body: success
      ? `${basename(path)} 已完成全部部署步骤`
      : `${basename(path)}：${error || (status === 'cancelled' ? '任务已取消' : '请打开 Launchline 查看日志')}`,
    icon: desktopIcon(),
    silent: false,
  })
  notification.on('click', showMainWindow)
  notification.show()
}

function watchDeployments() {
  statusTimer = setInterval(() => {
    const deployments = getDeploymentsSnapshot()
    for (const deployment of deployments) {
      const previous = previousStatuses.get(deployment.id)
      if (previous === 'running' && deployment.status !== 'running') {
        showDeploymentNotification(deployment.path, deployment.status, deployment.error)
      }
      previousStatuses.set(deployment.id, deployment.status)
    }
    const runningCount = Math.max(previewDeploymentCount, deployments.filter((deployment) => deployment.status === 'running').length)
    floatingWindow?.webContents.send('desktop:deployment-count', runningCount)
    if (tray) tray.setToolTip(runningCount ? `Launchline · ${runningCount} 个任务部署中` : 'Launchline')
  }, 1000)
}

function showDesktopMessage(options: MessageBoxOptions) {
  return mainWindow && !mainWindow.isDestroyed()
    ? dialog.showMessageBox(mainWindow, options)
    : dialog.showMessageBox(options)
}

function configureAutoUpdater() {
  if (!electronApp.isPackaged || process.platform !== 'win32') return

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false

  autoUpdater.on('update-available', async (info) => {
    if (updatePromptOpen || updateDownloading) return
    updatePromptOpen = true
    const result = await showDesktopMessage({
      type: 'info',
      title: '发现新版本',
      message: `Launchline ${info.version} 已发布`,
      detail: `当前版本为 ${electronApp.getVersion()}。是否现在下载更新？`,
      buttons: ['下载更新', '稍后提醒'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    updatePromptOpen = false
    if (result.response !== 0) return

    updateDownloading = true
    try {
      await autoUpdater.downloadUpdate()
    } catch (error) {
      updateDownloading = false
      mainWindow?.setProgressBar(-1)
      await showDesktopMessage({
        type: 'error',
        title: '更新下载失败',
        message: '无法下载 Launchline 更新',
        detail: error instanceof Error ? error.message : '请稍后重试，或从 GitHub Releases 手动下载安装包。',
        buttons: ['关闭'],
      })
    }
  })

  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.setProgressBar(Math.max(0, Math.min(1, progress.percent / 100)))
  })

  autoUpdater.on('update-downloaded', async (info) => {
    updateDownloading = false
    mainWindow?.setProgressBar(-1)
    const result = await showDesktopMessage({
      type: 'info',
      title: '更新已下载',
      message: `Launchline ${info.version} 已准备好`,
      detail: '重启应用后会自动完成安装。',
      buttons: ['立即重启并安装', '下次启动时安装'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    if (result.response === 0) {
      forceQuit = true
      autoUpdater.quitAndInstall(false, true)
    }
  })

  autoUpdater.on('error', (error) => {
    console.error('[auto-update]', error)
  })

  const checkForUpdates = () => {
    if (!updateDownloading && !updatePromptOpen) {
      void autoUpdater.checkForUpdates().catch((error) => console.error('[auto-update]', error))
    }
  }
  setTimeout(checkForUpdates, 8000)
  updateTimer = setInterval(checkForUpdates, 4 * 60 * 60 * 1000)
}

ipcMain.handle('desktop:select-directory', async (_event, initialPath: string) => {
  const options: Electron.OpenDialogOptions = {
    title: '选择需要部署的 Git 项目',
    defaultPath: validDirectory(initialPath) ? initialPath : undefined,
    properties: ['openDirectory'],
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  return result.canceled ? null : result.filePaths[0] || null
})
ipcMain.on('desktop:restore-main', showMainWindow)
ipcMain.on('desktop:hide-floating', () => floatingWindow?.hide())
ipcMain.on('desktop:quit', quitApplication)

electronApp.on('open-file', (event, path) => {
  event.preventDefault()
  sendOpenPath(path)
})

const hasSingleInstanceLock = electronApp.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  electronApp.quit()
} else {
  electronApp.on('second-instance', (_event, argv, workingDirectory) => {
    const path = extractDirectoryArgument(argv, workingDirectory)
    if (path) sendOpenPath(path)
    else showMainWindow()
  })

  electronApp.whenReady().then(async () => {
    electronApp.setName('Launchline')
    hydrateMacShellEnvironment()
    const serverRuntime = await startServer(configuredServerPort)
    appUrl = `http://127.0.0.1:${serverRuntime.port}`
    pendingOpenPath ||= extractDirectoryArgument(process.argv)
    createMainWindow()
    watchDeployments()
    configureAutoUpdater()
  })
}

electronApp.on('activate', showMainWindow)
electronApp.on('window-all-closed', () => {
  if (runningDeploymentCount() > 0 && !forceQuit) {
    showFloatingWindow()
    return
  }
  quitApplication()
})
electronApp.on('before-quit', () => {
  forceQuit = true
  if (statusTimer) clearInterval(statusTimer)
  if (updateTimer) clearInterval(updateTimer)
})
electronApp.on('will-quit', () => {
  void stopServer()
})
