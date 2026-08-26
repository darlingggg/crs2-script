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
  onDeploymentCount: (callback: (count: number) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, count: number) => callback(count)
    ipcRenderer.on('desktop:deployment-count', listener)
    return () => ipcRenderer.removeListener('desktop:deployment-count', listener)
  },
})
