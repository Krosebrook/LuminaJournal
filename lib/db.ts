
import Dexie, { Table } from 'https://esm.sh/dexie@^4.0.1';
import { WritingTone, Suggestion, Comment } from '../types';

export interface Draft {
  id?: number;
  title: string;
  content: string;
  tone: WritingTone;
  updatedAt: number;
}

export interface TerminalLog {
  id?: number;
  timestamp: number;
  prompt: string;
  response: string;
  type: 'request' | 'response' | 'error';
}

/**
 * Lumina Database implementation using Dexie.
 */
export class LuminaDB extends Dexie {
  drafts!: Table<Draft>;
  terminalLogs!: Table<TerminalLog>;

  constructor() {
    super('LuminaDB');
    // Fixed: version method is inherited from Dexie base class.
    this.version(1).stores({
      drafts: '++id, title, updatedAt',
      terminalLogs: '++id, timestamp'
    });
  }
}

export const db = new LuminaDB();
