export interface Capabilities {
  fileSystemAccess: boolean
}

export function getCapabilities(): Capabilities {
  return {
    // 检查浏览器是否支持 File System Access API
    fileSystemAccess: 'showDirectoryPicker' in window
  }
}
