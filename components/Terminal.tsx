
import React, { useState, useEffect, useRef } from 'react';
import { executeRawTerminalPrompt } from '../services/geminiService';
import { db, TerminalLog } from '../lib/db';

const EXAMPLES = [
  { label: 'Gemini JSON', text: 'Generate a list of 3 sci-fi book ideas. Return ONLY JSON in this format: [{"title": string, "hook": string}]' },
  { label: 'System Persona', text: 'SYSTEM_INSTRUCTION: You are a Victorian explorer.\nPROMPT: Describe a modern smartphone as if you just discovered it in the jungle.' },
  { label: 'OpenAI Schema', text: 'POST /v1/chat/completions\n{\n  "model": "gpt-4",\n  "messages": [{"role": "user", "content": "Explain recursion."}]\n}' },
  { label: 'Logic Proof', text: 'Perform a step-by-step logical proof for the statement: "If all men are mortal and Socrates is a man, then Socrates is mortal."' },
  { label: 'Code Refactor', text: 'Refactor this for O(n) complexity:\nfor(i=0;i<n;i++){\n  for(j=0;j<n;j++){\n    if(arr[i]==arr[j]) return true;\n  }\n}' }
];

const Terminal: React.FC = () => {
  const [input, setInput] = useState('');
  const [logs, setLogs] = useState<TerminalLog[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [selectedModel, setSelectedModel] = useState<'gemini-3-pro-preview' | 'gemini-3-flash-preview'>('gemini-3-pro-preview');
  const logEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

    const res = await executeRawTerminalPrompt(cmd, selectedModel);
    
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

  const prePopulate = (text: string) => {
    setInput(text);
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col h-full bg-black text-emerald-400 font-mono text-xs rounded-[2rem] overflow-hidden border border-white/10 shadow-2xl">
      {/* Header with Model Selector */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-white/5">
        <div className="flex flex-col">
          <span className="text-[9px] font-black uppercase tracking-widest text-emerald-500/50">Lumina Terminal v1.2</span>
          <div className="flex gap-2 mt-1">
            <button 
              onClick={() => setSelectedModel('gemini-3-pro-preview')}
              className={`text-[7px] uppercase tracking-tighter px-2 py-0.5 rounded ${selectedModel === 'gemini-3-pro-preview' ? 'bg-emerald-500 text-black font-bold' : 'text-white/30 border border-white/10'}`}
            >
              Pro (IQ)
            </button>
            <button 
              onClick={() => setSelectedModel('gemini-3-flash-preview')}
              className={`text-[7px] uppercase tracking-tighter px-2 py-0.5 rounded ${selectedModel === 'gemini-3-flash-preview' ? 'bg-blue-500 text-black font-bold' : 'text-white/30 border border-white/10'}`}
            >
              Flash (Speed)
            </button>
          </div>
        </div>
        <button onClick={clearLogs} className="text-[9px] font-black hover:text-red-400 transition-colors uppercase tracking-widest border border-white/10 px-3 py-1 rounded-full">Flush Buffer</button>
      </div>
      
      {/* Console Output */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar bg-[radial-gradient(circle_at_50%_0%,_rgba(16,185,129,0.05)_0%,_transparent_70%)]">
        {logs.length === 0 && <div className="opacity-30 italic">// Awaiting raw instruction set execution...</div>}
        {logs.map((log, i) => (
          <div key={i} className={`animate-in fade-in slide-in-from-left-2 duration-300 ${log.type === 'request' ? 'text-white' : 'text-emerald-400/80'}`}>
            <div className="flex gap-3">
              <span className="opacity-20 shrink-0">[{new Date(log.timestamp).toLocaleTimeString([], { hour12: false })}]</span>
              <span className="opacity-50 shrink-0">{log.type === 'request' ? 'SYS.REQ >' : 'SYS.RES <'}</span>
              <div className="whitespace-pre-wrap flex-1 break-words font-light">
                {log.type === 'request' ? log.prompt : log.response}
              </div>
            </div>
          </div>
        ))}
        {isBusy && (
          <div className="flex items-center gap-2 text-emerald-500">
            <span className="animate-bounce">●</span>
            <span className="animate-pulse">_ Processing neural weights...</span>
          </div>
        )}
        <div ref={logEndRef} />
      </div>

      {/* Input & Templates */}
      <div className="p-4 border-t border-white/5 bg-white/5 backdrop-blur-md">
        <div className="flex gap-2 overflow-x-auto pb-3 custom-scrollbar scroll-smooth">
          {EXAMPLES.map((ex, idx) => (
            <button 
              key={idx} 
              onClick={() => prePopulate(ex.text)}
              className="whitespace-nowrap px-3 py-1.5 rounded-lg border border-white/10 text-[8px] font-bold uppercase tracking-widest text-white/40 hover:text-emerald-400 hover:border-emerald-400/50 transition-all bg-white/5 hover:bg-emerald-500/5 shrink-0"
            >
              {ex.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 mt-2 group bg-white/5 rounded-xl px-4 py-3 border border-transparent focus-within:border-emerald-500/50 transition-all">
          <span className="text-emerald-500 font-bold group-focus-within:animate-pulse">$</span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCommand()}
            placeholder="Execute raw command payload..."
            className="flex-1 bg-transparent outline-none text-emerald-300 placeholder:opacity-20 text-[11px]"
            disabled={isBusy}
          />
        </div>
      </div>
    </div>
  );
};

export default Terminal;
