
import React, { useState, useEffect, useRef } from 'react';
import { executeRawTerminalPrompt } from '../services/geminiService';
import { encryptValue, decryptValue } from '../services/security';
import { db, TerminalLog } from '../lib/db';

// --- CONSTANTS & DATA ---

const PROMPT_CATEGORIES: Record<string, string[]> = {
  "Sensory": [
    "Describe the smell of your childhood home in 3 words.",
    "Write a paragraph focusing only on the texture of objects in the room.",
    "What is the loudest sound you remember from school?",
    "Describe a memory using only colors.",
    "Evoke the taste of a specific family meal without naming the dish.",
    "What does 'cold' feel like in this specific memory?",
    "Describe the lighting of the scene at 5:00 PM.",
    "Focus on the background noise of the city in this scene.",
    "Write about a tactile sensation that makes you cringe.",
    "Describe the weather not by how it looks, but how it feels on skin."
  ],
  "Character": [
    "What is your protagonist's biggest lie?",
    "Describe a character's hands and what they reveal about their work.",
    "What does this person fear most that they would never admit?",
    "Write a character profile based on the contents of their pocket.",
    "What is the one thing this character would save in a fire?",
    "How does your character react to an awkward silence?",
    "What is their nervous tic?",
    "Who is the person they most want to impress?",
    "What is a contradictory trait of this character?",
    "Describe their walk."
  ],
  "Plot": [
    "Start a scene in the middle of an argument.",
    "Write the climax of a chapter where a secret is revealed.",
    "Create a timeline of events for the year 1999.",
    "What is the inciting incident of this memory?",
    "Write a scene where something is lost forever.",
    "Describe a moment of unexpected grace.",
    "Write an ending that is ambiguous but satisfying.",
    "Outline the 'dark night of the soul' for this narrative arc.",
    "Create a twist involving a forgotten letter.",
    "Bridge the gap between two disparate memories."
  ],
  "Dialogue": [
    "Write a conversation where no one says what they mean.",
    "Fix this dialogue to sound more like a teenager from the 90s.",
    "Write a monologue about regret.",
    "Create subtext in a conversation about the weather.",
    "Write an argument between two people who love each other.",
    "Transcribe a memory of a phone call.",
    "Write dialogue that is interrupted by a sudden event.",
    "Give me 5 distinct voices for a crowded room scene.",
    "Write a whisper.",
    "Make this formal apology sound insincere."
  ],
  "Style": [
    "Rewrite this paragraph in the style of Hemingway (concise).",
    "Rewrite this sentence to be more lyrical and flowery.",
    "Remove all adverbs from this text.",
    "Make this passage sound like a noir detective novel.",
    "Use a central metaphor of 'water' throughout this paragraph.",
    "Write in the second person ('You').",
    "Experiment with sentence fragmenting for pacing.",
    "Turn this prose into a poem.",
    "Write a stream-of-consciousness passage.",
    "Simplify this complex idea for a child."
  ]
};

interface StoredKey {
  id: string;
  name: string;
  value: string; // Encrypted
  created: number;
}

interface FormattedOutputProps {
  content: string;
  type: 'request' | 'response' | 'error';
  sources?: any[];
}

const FormattedOutput: React.FC<FormattedOutputProps> = ({ content, type, sources }) => {
  const [isJsonExpanded, setIsJsonExpanded] = useState(false);
  const [isTextExpanded, setIsTextExpanded] = useState(false);
  
  // JSON Detection
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

  // Code Block Detection
  const hasCodeBlocks = content.includes('```');

  const renderSources = () => {
    if (!sources || sources.length === 0) return null;
    return (
      <div className="mt-4 pt-4 border-t border-white/5 space-y-2">
        <div className="flex items-center gap-2 mb-2">
          <svg className="w-3 h-3 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
          <span className="text-[9px] font-black uppercase tracking-widest text-white/40">Verified Sources</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {sources.map((chunk, idx) => {
            const url = chunk.web?.uri || chunk.maps?.uri;
            const title = chunk.web?.title || chunk.maps?.title || "Reference";
            if (!url) return null;
            return (
              <a 
                key={idx} 
                href={url} 
                target="_blank" 
                rel="noopener noreferrer" 
                className="px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[9px] text-blue-400 truncate max-w-[180px] transition-colors"
                title={title}
              >
                {title}
              </a>
            );
          })}
        </div>
      </div>
    );
  };

  if (isJson && type === 'response') {
    const jsonString = JSON.stringify(jsonParsed, null, 2);
    const lineCount = jsonString.split('\n').length;
    const isLongJson = lineCount > 12;

    // Advanced JSON Syntax Highlighting
    const highlightedJson = jsonString
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
        let cls = 'text-purple-300'; // Numbers
        if (/^"/.test(match)) {
          if (/:$/.test(match)) {
            cls = 'text-blue-300 font-bold'; // Keys
          } else {
            cls = 'text-amber-200'; // Strings
          }
        } else if (/true|false/.test(match)) {
          cls = 'text-orange-400 font-bold'; // Booleans
        } else if (/null/.test(match)) {
          cls = 'text-gray-500 italic'; // Null
        }
        return `<span class="${cls}">${match}</span>`;
      });

    const getSummary = () => {
        if (Array.isArray(jsonParsed)) {
            const firstItem = jsonParsed[0];
            const itemType = typeof firstItem;
            return `Array(${jsonParsed.length}) [ ${itemType === 'object' ? '{...}' : itemType}, ... ]`;
        }
        if (typeof jsonParsed === 'object' && jsonParsed !== null) {
            const keys = Object.keys(jsonParsed);
            const preview = keys.slice(0, 3).join(', ');
            return `Object { ${preview}${keys.length > 3 ? ', ...' : ''} }`;
        }
        return 'JSON Data';
    };

    return (
      <div className="flex flex-col gap-2 my-2">
        <div className="flex items-center gap-3">
          <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded font-black uppercase tracking-widest border border-emerald-500/20">JSON Object</span>
          {isLongJson && (
            <button 
                onClick={() => setIsJsonExpanded(!isJsonExpanded)}
                className="text-[9px] text-white/40 hover:text-white transition-colors uppercase tracking-widest underline decoration-white/20"
            >
                {isJsonExpanded ? 'Collapse' : 'Expand View'}
            </button>
          )}
        </div>
        {(!isLongJson || isJsonExpanded) ? (
          <pre 
            className="p-4 bg-[#0a0a0a] rounded-xl border border-white/10 overflow-x-auto custom-scrollbar font-mono text-[11px] leading-relaxed shadow-inner"
            dangerouslySetInnerHTML={{ __html: highlightedJson }}
          />
        ) : (
            <div 
                onClick={() => setIsJsonExpanded(true)}
                className="p-3 bg-[#0a0a0a] rounded-xl border border-white/10 text-emerald-500/60 text-xs font-mono cursor-pointer hover:bg-white/5 transition-colors flex items-center gap-2"
            >
                <span className="text-blue-400">ℹ️</span> {getSummary()}
            </div>
        )}
        {renderSources()}
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
            const language = lines[0].replace('```', '').trim() || 'Text';
            const code = lines.slice(1, -1).join('\n');
            return (
              <div key={i} className="rounded-xl overflow-hidden border border-white/10 shadow-lg bg-[#0d0d0d] my-2">
                <div className="bg-white/5 px-4 py-2 flex justify-between items-center border-b border-white/5">
                  <span className="text-[9px] font-black uppercase tracking-widest text-emerald-500/70">{language}</span>
                  <button 
                    onClick={() => navigator.clipboard.writeText(code)}
                    className="text-[9px] uppercase font-bold text-white/30 hover:text-white transition-colors"
                  >
                    Copy
                  </button>
                </div>
                <pre className="p-4 overflow-x-auto text-emerald-300/90 custom-scrollbar font-mono text-[11px] leading-relaxed">
                  {code}
                </pre>
              </div>
            );
          }
          if (!part.trim()) return null;
          return <div key={i} className="whitespace-pre-wrap font-light opacity-90">{part}</div>;
        })}
        {renderSources()}
      </div>
    );
  }

  const CHAR_LIMIT = 350;
  const isLongText = content.length > CHAR_LIMIT;
  
  if (type === 'response') {
      return (
          <div className="group">
             <div className={`whitespace-pre-wrap font-light break-words transition-all ${!isTextExpanded && isLongText ? 'opacity-80' : 'opacity-100'}`}>
                {(!isTextExpanded && isLongText) ? (
                    <>
                        {content.slice(0, CHAR_LIMIT)}
                        <span className="opacity-40">...</span>
                    </>
                ) : content}
            </div>
            {isLongText && (
                <button 
                    onClick={() => setIsTextExpanded(!isTextExpanded)}
                    className="mt-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-emerald-500 hover:text-emerald-400 transition-colors"
                >
                    {isTextExpanded ? (
                        <>
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7"></path></svg>
                            Show Less
                        </>
                    ) : (
                        <>
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                            Read Full Response
                        </>
                    )}
                </button>
            )}
            {renderSources()}
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
  const [useSearch, setUseSearch] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeCategory, setActiveCategory] = useState<string>('Sensory');
  
  // History State
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [tempInput, setTempInput] = useState('');

  // Vault State
  const [showVault, setShowVault] = useState(false);
  const [vaultKeys, setVaultKeys] = useState<StoredKey[]>([]);
  const [activeKeyId, setActiveKeyId] = useState<string | null>(null);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyValue, setNewKeyValue] = useState('');

  useEffect(() => {
    db.terminalLogs.orderBy('timestamp').toArray().then(setLogs);
    
    // Load vault keys and active key
    try {
      const stored = localStorage.getItem('lumina_vault');
      const activeId = localStorage.getItem('lumina_active_key_id');
      if (stored) setVaultKeys(JSON.parse(stored));
      if (activeId) setActiveKeyId(activeId);
    } catch (e) {
      console.error('Failed to load vault', e);
    }
  }, []);

  useEffect(() => {
    if (!showVault) {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, showVault]);

  const handleCommand = async () => {
    if (!input.trim() || isBusy) return;
    setIsBusy(true);
    const cmd = input;
    setInput('');
    setHistoryIndex(-1); 

    const newRequestLog: TerminalLog = { timestamp: Date.now(), prompt: cmd, response: '', type: 'request' };
    const requestId = await db.terminalLogs.add(newRequestLog);
    setLogs(prev => [...prev, { ...newRequestLog, id: requestId }]);

    const res = await executeRawTerminalPrompt(cmd, selectedModel, useSearch);
    
    const newResponseLog: TerminalLog = { 
      timestamp: Date.now(), 
      prompt: cmd, 
      response: res.text, 
      type: 'response',
      sources: res.sources
    };
    const responseId = await db.terminalLogs.add(newResponseLog);
    setLogs(prev => [...prev, { ...newResponseLog, id: responseId }]);
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

  const suggestPrompt = async () => {
    setIsBusy(true);
    // Simple prompt to get a suggestion
    const res = await executeRawTerminalPrompt(
      "Generate a unique, thought-provoking prompt for a writer to help them unearth a deep memory. Return ONLY the prompt text.", 
      'gemini-3-flash-preview', 
      false
    );
    if (res.text) {
      prePopulate(res.text.trim());
    }
    setIsBusy(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
        handleCommand();
        return;
    }

    const historyLogs = logs.filter(l => l.type === 'request');
    if (historyLogs.length === 0) return;

    if (e.key === 'ArrowUp') {
        e.preventDefault();
        const newIndex = historyIndex < 0 
            ? historyLogs.length - 1 
            : Math.max(0, historyIndex - 1);
        
        if (historyIndex < 0) setTempInput(input);
        
        setHistoryIndex(newIndex);
        setInput(historyLogs[newIndex].prompt);
    } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (historyIndex < 0) return; 

        const newIndex = historyIndex + 1;
        if (newIndex >= historyLogs.length) {
            setHistoryIndex(-1);
            setInput(tempInput);
        } else {
            setHistoryIndex(newIndex);
            setInput(historyLogs[newIndex].prompt);
        }
    }
  };

  // Vault Actions
  const saveKey = () => {
    if (!newKeyName.trim() || !newKeyValue.trim()) return;
    
    // Encrypt before storage
    const encrypted = encryptValue(newKeyValue.trim());
    
    const newEntry: StoredKey = {
      id: `k-${Date.now()}`,
      name: newKeyName.trim(),
      value: encrypted,
      created: Date.now()
    };
    
    const updated = [...vaultKeys, newEntry];
    setVaultKeys(updated);
    localStorage.setItem('lumina_vault', JSON.stringify(updated));
    setNewKeyName('');
    setNewKeyValue('');
  };

  const deleteKey = (id: string) => {
    const updated = vaultKeys.filter(k => k.id !== id);
    setVaultKeys(updated);
    localStorage.setItem('lumina_vault', JSON.stringify(updated));
    if (activeKeyId === id) {
      setActiveKeyId(null);
      localStorage.removeItem('lumina_active_key_id');
    }
  };

  const toggleActiveKey = (id: string) => {
    const nextId = activeKeyId === id ? null : id;
    setActiveKeyId(nextId);
    if (nextId) {
      localStorage.setItem('lumina_active_key_id', nextId);
    } else {
      localStorage.removeItem('lumina_active_key_id');
    }
  };

  return (
    <div className="flex flex-col h-full bg-black text-emerald-400 font-mono text-xs rounded-[2rem] overflow-hidden border border-white/10 shadow-2xl relative">
      {/* Header with Model Selector */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-white/5">
        <div className="flex flex-col">
          <span className="text-[9px] font-black uppercase tracking-widest text-emerald-500/50">Lumina Terminal v2.0</span>
          <div className="flex gap-2 mt-1">
            <button 
              onClick={() => setSelectedModel('gemini-3-pro-preview')}
              className={`text-[7px] uppercase tracking-tighter px-2 py-0.5 rounded ${selectedModel === 'gemini-3-pro-preview' ? 'bg-emerald-50 text-black font-bold' : 'text-white/30 border border-white/10'}`}
            >
              Pro (IQ)
            </button>
            <button 
              onClick={() => setSelectedModel('gemini-3-flash-preview')}
              className={`text-[7px] uppercase tracking-tighter px-2 py-0.5 rounded ${selectedModel === 'gemini-3-flash-preview' ? 'bg-blue-500 text-black font-bold' : 'text-white/30 border border-white/10'}`}
            >
              Flash (Speed)
            </button>
            <button 
              onClick={() => setUseSearch(!useSearch)}
              className={`text-[7px] uppercase tracking-tighter px-2 py-0.5 rounded flex items-center gap-1 transition-all ${useSearch ? 'bg-amber-500 text-black font-bold' : 'text-white/30 border border-white/10'}`}
            >
              <div className={`w-1 h-1 rounded-full ${useSearch ? 'bg-black animate-ping' : 'bg-white/20'}`}></div>
              Search
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
           {activeKeyId && (
             <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-500/10 rounded-full border border-emerald-500/20" title="Custom Neural Key Active">
               <svg className="w-2.5 h-2.5 text-emerald-500 animate-pulse" fill="currentColor" viewBox="0 0 20 20"><circle cx="10" cy="10" r="10"></circle></svg>
               <span className="text-[8px] font-black uppercase text-emerald-500">Secured</span>
             </div>
           )}
           <button 
             onClick={() => setShowVault(!showVault)}
             className={`text-[9px] font-black transition-all uppercase tracking-widest border px-3 py-1 rounded-full flex items-center gap-2 ${showVault ? 'bg-amber-500 border-amber-500 text-black' : 'border-white/10 text-amber-500 hover:text-amber-400'}`}
           >
             <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"></path></svg>
             {showVault ? 'Close Vault' : 'Key Vault'}
           </button>
           <button onClick={clearLogs} className="text-[9px] font-black hover:text-red-400 transition-colors uppercase tracking-widest border border-white/10 px-3 py-1 rounded-full">Flush Buffer</button>
        </div>
      </div>
      
      {/* Console Output */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar bg-[radial-gradient(circle_at_50%_0%,_rgba(16,185,129,0.05)_0%,_transparent_70%)] relative">
        {showVault && (
            <div className="absolute inset-0 z-20 bg-black/90 backdrop-blur-sm p-8 animate-in fade-in zoom-in-95 duration-200 overflow-y-auto custom-scrollbar">
               <div className="max-w-md mx-auto pb-10">
                 <h3 className="text-sm font-black text-amber-500 uppercase tracking-widest mb-6 flex items-center gap-2">
                   <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                   Neural Key Vault
                 </h3>
                 <p className="text-[10px] text-gray-400 mb-4">Keys are encrypted with a local cipher before storage. They are never transmitted except to Google AI servers.</p>
                 
                 {/* Add Key Form */}
                 <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6 space-y-3">
                   <input 
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      placeholder="Key Alias (e.g. Production Gemini)"
                      className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/20 outline-none focus:border-amber-500/50"
                   />
                   <input 
                      value={newKeyValue}
                      onChange={(e) => setNewKeyValue(e.target.value)}
                      placeholder="sk-..."
                      type="password"
                      autoComplete="off"
                      className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/20 outline-none focus:border-amber-500/50"
                   />
                   <button 
                     onClick={saveKey}
                     disabled={!newKeyName || !newKeyValue}
                     className="w-full bg-amber-600 hover:bg-amber-500 text-black font-bold text-[10px] uppercase tracking-widest py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                   >
                     Encrypt & Save Key
                   </button>
                 </div>

                 {/* Key List */}
                 <div className="space-y-3">
                   {vaultKeys.length === 0 && <div className="text-center text-white/20 italic text-xs">No keys secured in vault.</div>}
                   {vaultKeys.map((k) => (
                     <div key={k.id} className={`flex items-center justify-between p-3 rounded-lg border transition-all group ${activeKeyId === k.id ? 'bg-emerald-500/10 border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.1)]' : 'border-white/10 bg-white/5'}`}>
                        <div className="flex items-center gap-3">
                           <button 
                             onClick={() => toggleActiveKey(k.id)}
                             className={`p-2 rounded-lg transition-all ${activeKeyId === k.id ? 'bg-emerald-500 text-black' : 'bg-white/5 text-white/30 hover:bg-white/10'}`}
                             title={activeKeyId === k.id ? "Key Active" : "Activate Key"}
                           >
                             <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                           </button>
                           <div className="flex flex-col">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-white text-xs">{k.name}</span>
                                {activeKeyId === k.id && <span className="text-[7px] font-black bg-emerald-500 text-black px-1 rounded">PRIMARY</span>}
                              </div>
                              <span className="text-[10px] text-emerald-500/50 font-mono mt-0.5">••••••••{decryptValue(k.value).slice(-4)}</span>
                           </div>
                        </div>
                        <div className="flex gap-2 opacity-50 group-hover:opacity-100 transition-opacity">
                           <button onClick={() => deleteKey(k.id)} className="p-1.5 hover:bg-white/10 rounded text-red-400" title="Delete"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
                        </div>
                     </div>
                   ))}
                 </div>
               </div>
            </div>
        )}

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
                  sources={log.sources}
                />
              </div>
            </div>
          </div>
        ))}
        {isBusy && (
          <div className="flex items-center gap-2 text-emerald-500">
            <span className="animate-bounce">●</span>
            <span className="animate-pulse">_ Processing neural input...</span>
          </div>
        )}
        <div ref={logEndRef} />
      </div>

      {/* Categories & Examples */}
      <div className="p-4 border-t border-white/5 bg-white/5 backdrop-blur-md">
        
        {/* Category Tabs */}
        <div className="flex items-center gap-2 mb-3 overflow-x-auto pb-1 custom-scrollbar">
           <button 
             onClick={suggestPrompt}
             disabled={isBusy}
             className="whitespace-nowrap px-3 py-1.5 rounded-lg bg-gradient-to-r from-pink-500 to-purple-600 text-white text-[9px] font-black uppercase tracking-widest hover:scale-105 transition-transform flex items-center gap-1 shadow-lg shrink-0 disabled:opacity-50"
           >
             <span className="text-xs">✨</span> AI Suggest
           </button>
           <div className="w-px h-6 bg-white/10 mx-1 shrink-0"></div>
           {Object.keys(PROMPT_CATEGORIES).map(cat => (
             <button
               key={cat}
               onClick={() => setActiveCategory(cat)}
               className={`whitespace-nowrap px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all shrink-0 ${activeCategory === cat ? 'bg-white text-black' : 'text-white/40 hover:text-white hover:bg-white/5'}`}
             >
               {cat}
             </button>
           ))}
        </div>

        {/* Prompts List */}
        <div className="flex gap-2 overflow-x-auto pb-3 custom-scrollbar scroll-smooth">
          {PROMPT_CATEGORIES[activeCategory]?.map((prompt, idx) => (
            <button 
              key={idx} 
              onClick={() => prePopulate(prompt)}
              className="whitespace-nowrap px-3 py-1.5 rounded-lg border border-white/10 text-[8px] font-bold uppercase tracking-widest text-white/40 hover:text-emerald-400 hover:border-emerald-400/50 transition-all bg-white/5 hover:bg-emerald-500/5 shrink-0 max-w-[200px] truncate"
              title={prompt}
            >
              {prompt}
            </button>
          ))}
        </div>

        {/* Input Field */}
        <div className="flex items-center gap-3 mt-2 group bg-white/5 rounded-xl px-4 py-3 border border-transparent focus-within:border-emerald-500/50 transition-all">
          <span className="text-emerald-500 font-bold group-focus-within:animate-pulse">$</span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Execute memory command..."
            className="flex-1 bg-transparent outline-none text-emerald-300 placeholder:opacity-20 text-[11px]"
            disabled={isBusy}
            autoComplete="off"
          />
        </div>
        <div className="text-[8px] text-white/20 mt-1 pl-6 flex justify-between">
           <span>Use ↑/↓ to navigate history</span>
           <span>Press Enter to execute</span>
        </div>
      </div>
    </div>
  );
};

export default Terminal;
