
export interface FileAttachment {
  name: string;
  type: string;
  data: string; // base64
}

export type WritingTone = 'creative' | 'professional' | 'punchy' | 'academic' | 'casual' | 'memoir';

export interface UserProfile {
  id?: number;
  name: string;
  tone: WritingTone;
  systemInstruction: string;
  isDefault: boolean;
}

export interface Suggestion {
  id: string;
  type: 'improvement' | 'grammar' | 'expansion' | 'critique';
  originalText: string;
  suggestedText: string;
  explanation: string;
}

export interface Comment {
  id: string;
  text: string;
  originalText: string;
  timestamp: number;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  sources?: any[];
}

export interface Draft {
  id?: number;
  title: string;
  content: string;
  tone: WritingTone;
  wordCount: number;
  updatedAt: number;
}

export interface AppState {
  content: string;
  tone: WritingTone;
  isProcessing: boolean;
  suggestions: Suggestion[];
  comments: Comment[];
  attachments: FileAttachment[];
  chatHistory: ChatMessage[];
}
