
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
// Version 4 adds wordCount to drafts for the Archive view
db.version(4).stores({
  drafts: '++id, title, wordCount, updatedAt',
  terminalLogs: '++id, timestamp',
  profiles: '++id, name, isDefault'
});

export { db };
