import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('launchlineDesktop', {
  isElectron: true,
  platform: process.platform,
  selectDirectory: (initialPath: string) => ipcRenderer.invoke('desktop:select-directory', initialPath) as Promise<string | null>,
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  onOpenPath: (callback: (path: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, path: string) => callback(path)
    ipcRenderer.on('desktop:open-path', listener)
    return () => ipcRenderer.removeListener('desktop:open-path', listener)
  },
  restoreMainWindow: () => ipcRenderer.send('desktop:restore-main'),
  hideFloatingBall: () => ipcRenderer.send('desktop:hide-floating'),
  quitApplication: () => ipcRenderer.send('desktop:quit'),
  getUpdateState: () => ipcRenderer.invoke('desktop:get-update-state'),
  checkForUpdates: () => ipcRenderer.send('desktop:check-for-updates'),
  downloadUpdate: () => ipcRenderer.send('desktop:download-update'),
  installUpdate: () => ipcRenderer.send('desktop:install-update'),
  onUpdateState: (callback: (state: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state)
    ipcRenderer.on('desktop:update-state', listener)
    return () => ipcRenderer.removeListener('desktop:update-state', listener)
  },
  onDeploymentCount: (callback: (count: number) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, count: number) => callback(count)
    ipcRenderer.on('desktop:deployment-count', listener)
    return () => ipcRenderer.removeListener('desktop:deployment-count', listener)
  },
})
