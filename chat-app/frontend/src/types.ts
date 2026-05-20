export interface Attachment {
  kind: 'file' | 'image';
  name: string;
  ext?: string;
  size?: string;
  dataUrl?: string;
  file?: File;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  latency?: string;
  pod?: string;
  attachments?: Attachment[];
}

export interface Thread {
  id: string;
  title: string;
  model: string;
  time: string;
  group: string;
  messages: ChatMessage[];
}

export interface Settings {
  model: string;
  temp: number;
  topP: number;
  maxTokens: number;
  stream: boolean;
  voice: boolean;
  system: string;
}

export interface NodeInfo {
  role: string;
  name: string;
  ip: string;
  cpu: number;
  mem: number;
  pods: number;
}

export interface PodRow {
  name: string;
  namespace: string;
  model?: string;
  status: 'Running' | 'Pending' | 'Failed';
  ready: string;
  restarts: number;
  age: string;
}

export type View = 'chat' | 'cluster' | 'models' | 'admin' | 'apidocs';

export interface CurrentUser {
  username: string;
  role: string;
  email?: string;
}
