
import React, { useState, useEffect, useRef } from 'react';
import { executeRawTerminalPrompt } from '../services/geminiService';
import { db, TerminalLog } from '../lib/db';

const EXAMPLES = [
  { label: 'Sensory Immersion', text: 'Expand this memory using only sensory details (smell, sound, touch): "I remember my grandmother\'s kitchen on a Sunday morning."' },
  { label: 'Memory Hook', text: 'Give me 5 evocative opening sentences for a chapter about leaving my hometown for the first time.' },
  { label: 'Dialogue Repair', text: 'Rewrite this conversation to sound more authentic to a 1970s teenager:\nMe: "I really want to go to the concert."\nDad: "No, it is too dangerous."' },
  { label: 'Timeline Anchor', text: 'I have these memories: [A, B, C]. Suggest a narrative theme that connects them into a single chapter.' },
  { label: 'Emotional Depth', text: 'Analyze this paragraph for emotional honesty. Where am I "telling" instead of "showing" my feelings?' }
];

interface FormattedOutputProps {
  content: string;
  type: 'request' | 'response' | 'error';
}

const FormattedOutput: React.FC<FormattedOutputProps> = ({ content, type }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  
  // Try to detect if it's JSON
  let isJson = false;
  let jsonParsed: any = null;
  try {
    const trimmed = content.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      jsonParsed = JSON.parse(trimmed);
      isJson = true;
    }
  } catch (e) {
    isJson = false;
  }

  // Detect code blocks (```code```)
  const hasCodeBlocks = content.includes('```');

  if (isJson && type === 'response') {
    const jsonString = JSON.stringify(jsonParsed, null, 2);
    // Basic syntax highlighting for JSON
    const highlightedJson = jsonString
      .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
        let cls = 'text-pink-300'; // Numbers/Booleans
        if (/^"/.test(match)) {
          if (/:$/.test(match)) {
            cls = 'text-blue-300'; // Keys
          } else {
            cls = 'text-yellow-200'; // Strings
          }
        } else if (/true|false/.test(match)) {
          cls = 'text-orange-300';
        } else if (/null/.test(match)) {
          cls = 'text-gray-400';
        }
        return `<span class="${cls}">${match}</span>`;
      });

    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <span className="text-[10px] bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded font-black uppercase tracking-widest">Data Structure</span>
          <button 
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="text-[9px] text-white/40 hover:text-white transition-colors uppercase tracking-widest underline decoration-white/20"
          >
            {isCollapsed ? 'Expand' : 'Collapse'}
          </button>
        </div>
        {!isCollapsed && (
          <pre 
            className="p-4 bg-white/5 rounded-xl border border-white/5 overflow-x-auto custom-scrollbar font-light leading-relaxed"
            dangerouslySetInnerHTML={{ __html: highlightedJson }}
          />
        )}
      </div>
    );
  }

  if (hasCodeBlocks && type === 'response') {
    const parts = content.split(/(```[\s\S]*?```)/g);
    return (
      <div className="space-y-4">
        {parts.map((part, i) => {
          if (part.startsWith('```')) {
            const lines = part.split('\n');
            const language = lines[0].replace('```', '').trim() || 'draft';
            const code = lines.slice(1, -1).join('\n');
            return (
              <div key={i} className="rounded-xl overflow-hidden border border-white/10 shadow-lg bg-[#0d0d0d]">
                <div className="bg-white/5 px-4 py-2 flex justify-between items-center">
                  <span className="text-[9px] font-black uppercase tracking-widest text-emerald-500/70">{language}</span>
                  <div className="flex gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-red-500/20"></div>
                    <div className="w-2 h-2 rounded-full bg-amber-500/20"></div>
                    <div className="w-2 h-2 rounded-full bg-emerald-500/20"></div>
                  </div>
                </div>
                <pre className="p-4 overflow-x-auto text-emerald-300/90 custom-scrollbar font-mono text-[11px] leading-relaxed">
                  {code}
                </pre>
              </div>
            );
          }
          return <div key={i} className="whitespace-pre-wrap font-light opacity-90">{part}</div>;
        })}
      </div>
    );
  }

  return <div className="whitespace-pre-wrap font-light break-words">{content}</div>;
};

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
      <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar bg-[radial-gradient(circle_at_50%_0%,_rgba(16,185,129,0.05)_0%,_transparent_70%)]">
        {logs.length === 0 && <div className="opacity-30 italic">// Awaiting memory excavation command...</div>}
        {logs.map((log, i) => (
          <div key={i} className={`animate-in fade-in slide-in-from-left-2 duration-300 ${log.type === 'request' ? 'text-white' : 'text-emerald-400/80'}`}>
            <div className="flex gap-3 items-start">
              <span className="opacity-20 shrink-0 font-light mt-0.5">[{new Date(log.timestamp).toLocaleTimeString([], { hour12: false })}]</span>
              <span className={`shrink-0 font-black mt-0.5 ${log.type === 'request' ? 'text-blue-400' : 'text-emerald-500'}`}>
                {log.type === 'request' ? 'CMD' : 'OUT'}
              </span>
              <div className="flex-1 min-w-0">
                <FormattedOutput 
                  content={log.type === 'request' ? log.prompt : log.response} 
                  type={log.type} 
                />
              </div>
            </div>
          </div>
        ))}
        {isBusy && (
          <div className="flex items-center gap-2 text-emerald-500">
            <span className="animate-bounce">●</span>
            <span className="animate-pulse">_ Accessing neural history...</span>
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
            placeholder="Execute memory command..."
            className="flex-1 bg-transparent outline-none text-emerald-300 placeholder:opacity-20 text-[11px]"
            disabled={isBusy}
          />
        </div>
      </div>
    </div>
  );
};

export default Terminal;
