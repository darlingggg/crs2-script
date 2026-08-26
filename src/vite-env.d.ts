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
  onDeploymentCount(callback: (count: number) => void): () => void
}

interface Window {
  launchlineDesktop?: LaunchlineDesktopBridge
}
