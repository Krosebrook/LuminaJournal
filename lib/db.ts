
import Dexie, { type Table } from 'https://esm.sh/dexie@^4.0.1';
import { WritingTone, UserProfile } from '../types';

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
  sources?: any[];
}

/**
 * Lumina Database implementation using Dexie.
 */
const db = new Dexie('LuminaDB') as Dexie & {
  drafts: Table<Draft>;
  terminalLogs: Table<TerminalLog>;
  profiles: Table<UserProfile>;
};

// Initialize the database schema and versioning.
// Version 3 adds sources field to terminalLogs
db.version(3).stores({
  drafts: '++id, title, updatedAt',
  terminalLogs: '++id, timestamp',
  profiles: '++id, name, isDefault'
});

export { db };
