// 端口定义 - 定义核心领域层需要的外部依赖接口

export interface FileReader {
  readFile(path: string): Promise<string>
}

export interface DirectoryPicker {
  pickDirectory(): Promise<string | null>
}

export interface HubClient {
  search(query: string): Promise<import('./types').HubCandidate[]>
}
