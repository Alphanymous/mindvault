export type ItemType = 'note' | 'pdf' | 'web' | 'prompt' | 'file'
export type ItemStatus = 'inbox' | 'organized'

/** What the classifier proposes for an item sitting in the inbox. */
export interface Suggestion {
  type: ItemType
  folder: string
  tags: string[]
  confidence: number // 0..1
  reason: string
}

export type HighlightColor = 'yellow' | 'green' | 'pink' | 'blue'

/** A highlight on a PDF page (normalised rects) or on rendered text (character offsets). Synced with the item. */
export interface Annotation {
  id: string
  text: string
  color: HighlightColor
  createdAt: number
  /** PDF: 1-based page and rectangles as [x, y, w, h] fractions of the page. */
  page?: number
  rects?: number[][]
  /** Text items: character offsets into the rendered text. */
  start?: number
  end?: number
  note?: string
}

export interface Item {
  id: string
  type: ItemType
  title: string
  /** Markdown / plain text body. For PDFs and web pages this is the extracted readable text. */
  content: string
  /** Original link for web clips. */
  url?: string
  /** Folder path using "/" as separator, "" = unfiled. */
  folder: string
  tags: string[]
  status: ItemStatus
  suggestion?: Suggestion
  /** Id of the stored original (PDF / file) in the blob store. */
  blobId?: string
  mime?: string
  fileName?: string
  size?: number
  pinned?: boolean
  annotations?: Annotation[]
  createdAt: number
  updatedAt: number
  /** Tombstone so deletions can sync. */
  deleted?: boolean
}

export interface BlobRecord {
  id: string
  mime: string
  data: Blob
  updatedAt: number
}

export interface Settings {
  theme: 'dark' | 'light' | 'system'
  googleClientId: string
  /** CORS proxy template for web clipping in the browser, e.g. "https://example.com/?url={url}". Empty = off. */
  clipProxy: string
  /** Optional OpenAI-compatible endpoint used to refine classification. */
  llmEndpoint: string
  llmModel: string
  llmApiKey: string
  autoSync: boolean
  lastSyncAt?: number
  /** Paired computer running Mindvault (LAN sync), e.g. http://192.168.1.5:47822 */
  peerUrl: string
  peerToken: string
  peerAutoSync: boolean
  lastPeerSyncAt?: number
  /** Optional OpenAI-compatible embeddings endpoint for meaning-based search. */
  embeddingsEndpoint: string
  embeddingsModel: string
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  googleClientId: '',
  clipProxy: '',
  llmEndpoint: '',
  llmModel: 'gpt-4o-mini',
  llmApiKey: '',
  autoSync: true,
  peerUrl: '',
  peerToken: '',
  peerAutoSync: true,
  embeddingsEndpoint: '',
  embeddingsModel: 'text-embedding-3-small',
}

export type EdgeKind = 'link' | 'tag' | 'folder'

export interface GraphNode {
  id: string
  label: string
  kind: 'item' | 'ghost' | 'tag' | 'folder'
  itemType?: ItemType
  /** Number of connections, used for node size. */
  degree: number
  folder?: string
}

export interface GraphEdge {
  source: string
  target: string
  kind: EdgeKind
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}
