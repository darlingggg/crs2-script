/// <reference types="vite/client" />

interface LaunchlineDesktopBridge {
  isElectron: true
  platform: 'win32' | 'darwin' | 'linux' | string
  selectDirectories(initialPath: string): Promise<string[]>
  getSavedProjects(): Promise<{ projects: SavedProjectRecord[]; removed: SavedProjectRecord[] }>
  saveProject(project: SavedProjectRecord): Promise<SavedProjectRecord>
  reorderSavedProjects(paths: string[]): Promise<void>
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

type SavedProjectRecord = {
  path: string
  name: string
  remote?: string
  developmentBranch: string
  lastPublishedAt: string
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
