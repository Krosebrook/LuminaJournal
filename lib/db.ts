
import Dexie, { type Table } from 'https://esm.sh/dexie@^4.0.1';
import { WritingTone, UserProfile, Draft } from '../types';

export interface TerminalLog {
  id?: number;
  timestamp: number;
  prompt: string;
  response: string;
  type: 'request' | 'response' | 'error';
  sources?: any[];
}

export interface Entity {
  id?: number;
  name: string;
  type: 'Person' | 'Location' | 'Object' | 'Theme';
  description: string;
  draftIds: number[];
  lastSeen: number;
}

export interface VectorEmbedding {
  draftId: number;
  vector: number[];
}

export interface PromptTemplate {
  id?: number;
  name: string;
  content: string;
  created: number;
}

/**
 * Lumina Database implementation using Dexie.
 */
const db = new Dexie('LuminaDB') as Dexie & {
  drafts: Table<Draft>;
  terminalLogs: Table<TerminalLog>;
  profiles: Table<UserProfile>;
  entities: Table<Entity>;
  embeddings: Table<VectorEmbedding>;
  promptTemplates: Table<PromptTemplate>;
};

// Initialize the database schema and versioning.
// Version 6 adds promptTemplates table
db.version(6).stores({
  drafts: '++id, title, wordCount, updatedAt',
  terminalLogs: '++id, timestamp',
  profiles: '++id, name, isDefault',
  entities: '++id, name, type, *draftIds',
  embeddings: 'draftId',
  promptTemplates: '++id, name, created'
});

export { db };
