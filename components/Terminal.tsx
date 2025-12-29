
import React, { useState, useEffect, useRef } from 'react';
import { executeRawTerminalPrompt } from '../services/geminiService';
import { db, TerminalLog } from '../lib/db';

const Terminal: React.FC = () => {
  const [input, setInput] = useState('');
  const [logs, setLogs] = useState<TerminalLog[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    db.terminalLogs.orderBy('timestamp').toArray().then(setLogs);
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleCommand = async () => {
    if (!input.trim() || isBusy) return;
    setIsBusy(true);
    const cmd = input;
    setInput('');

    const newLogs: TerminalLog[] = [
      ...logs,
      { timestamp: Date.now(), prompt: cmd, response: '', type: 'request' }
    ];
    setLogs(newLogs);
    await db.terminalLogs.add(newLogs[newLogs.length - 1]);

    const res = await executeRawTerminalPrompt(cmd);
    
    const finalLogs: TerminalLog[] = [
      ...newLogs,
      { timestamp: Date.now(), prompt: cmd, response: res, type: 'response' }
    ];
    setLogs(finalLogs);
    await db.terminalLogs.add(finalLogs[finalLogs.length - 1]);
    setIsBusy(false);
  };

  const clearLogs = async () => {
    await db.terminalLogs.clear();
    setLogs([]);
  };

  return (
    <div className="flex flex-col h-full bg-black text-emerald-400 font-mono text-xs rounded-[2rem] overflow-hidden border border-white/10 shadow-2xl">
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-white/5">
        <span className="text-[9px] font-black uppercase tracking-widest text-emerald-500/50">Lumina Terminal v1.0</span>
        <button onClick={clearLogs} className="hover:text-red-400 transition-colors">CLEAR</button>
      </div>
      
      <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
        {logs.length === 0 && <div className="opacity-30 italic">// Awaiting raw prompt execution...</div>}
        {logs.map((log, i) => (
          <div key={i} className={log.type === 'request' ? 'text-white' : 'text-emerald-400/80'}>
            <div className="flex gap-3">
              <span className="opacity-30">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
              <span className="opacity-50">{log.type === 'request' ? '>' : '<'}</span>
              <div className="whitespace-pre-wrap flex-1">
                {log.type === 'request' ? log.prompt : log.response}
              </div>
            </div>
          </div>
        ))}
        {isBusy && <div className="animate-pulse">_ Processing payload...</div>}
        <div ref={logEndRef} />
      </div>

      <div className="p-4 border-t border-white/5 bg-white/5">
        <div className="flex items-center gap-3">
          <span className="text-emerald-500 font-bold">$</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCommand()}
            placeholder="Execute raw model command..."
            className="flex-1 bg-transparent outline-none text-emerald-300 placeholder:opacity-20"
            disabled={isBusy}
          />
        </div>
      </div>
    </div>
  );
};

export default Terminal;
