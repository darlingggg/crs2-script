/// <reference types="vite/client" />

interface LaunchlineDesktopBridge {
  isElectron: true
  platform: 'win32' | 'darwin' | 'linux' | string
  selectDirectory(initialPath: string): Promise<string | null>
  getPathForFile(file: File): string
  onOpenPath(callback: (path: string) => void): () => void
  restoreMainWindow(): void
  hideFloatingBall(): void
  quitApplication(): void
  getUpdateState(): Promise<DesktopUpdateState>
  checkForUpdates(): void
  downloadUpdate(): void
  installUpdate(): void
  onUpdateState(callback: (state: DesktopUpdateState) => void): () => void
  onDeploymentCount(callback: (count: number) => void): () => void
}

type DesktopUpdateState = {
  phase: 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'downloaded' | 'error'
  currentVersion: string
  availableVersion?: string
  percent?: number
  message?: string
}

interface Window {
  launchlineDesktop?: LaunchlineDesktopBridge
}
