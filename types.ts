
export interface FileAttachment {
  name: string;
  type: string;
  data: string; // base64
}

export type WritingTone = 'creative' | 'professional' | 'punchy' | 'academic' | 'casual';

export interface Suggestion {
  id: string;
  type: 'improvement' | 'grammar' | 'expansion' | 'critique';
  originalText: string;
  suggestedText: string;
  explanation: string;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export interface AppState {
  content: string;
  tone: WritingTone;
  isProcessing: boolean;
  suggestions: Suggestion[];
  attachments: FileAttachment[];
  chatHistory: ChatMessage[];
}
