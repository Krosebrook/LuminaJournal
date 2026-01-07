
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

// --- Encryption Utilities ---
const CIPHER_SALT = 'LUMINA_NEURAL_CORE_v1';

const encryptValue = (text: string): string => {
  const textChars = text.split('').map(c => c.charCodeAt(0));
  const saltChars = CIPHER_SALT.split('').map(c => c.charCodeAt(0));
  const encrypted = textChars.map((char, i) => 
    char ^ saltChars[i % saltChars.length]
  );
  return btoa(String.fromCharCode(...encrypted));
};

const decryptValue = (cipher: string): string => {
  try {
    const raw = atob(cipher);
    const rawChars = raw.split('').map(c => c.charCodeAt(0));
    const saltChars = CIPHER_SALT.split('').map(c => c.charCodeAt(0));
    const decrypted = rawChars.map((char, i) => 
      char ^ saltChars[i % saltChars.length]
    );
    return String.fromCharCode(...decrypted);
  } catch (e) { return '*** CORRUPTED ***'; }
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
    // Consider it "long" if it has more than 8 lines
    const isLongJson = lineCount > 8;

    // Syntax highlighting for JSON
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

    // Generate a concise summary
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
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <span className="text-[10px] bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded font-black uppercase tracking-widest">JSON Data</span>
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
            className="p-4 bg-white/5 rounded-xl border border-white/5 overflow-x-auto custom-scrollbar font-light leading-relaxed text-[11px]"
            dangerouslySetInnerHTML={{ __html: highlightedJson }}
          />
        ) : (
            <div 
                onClick={() => setIsJsonExpanded(true)}
                className="p-3 bg-white/5 rounded-xl border border-white/5 text-emerald-500/60 text-xs font-mono cursor-pointer hover:bg-white/10 transition-colors flex items-center gap-2"
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
          if (!part.trim()) return null;
          return <div key={i} className="whitespace-pre-wrap font-light opacity-90">{part}</div>;
        })}
        {renderSources()}
      </div>
    );
  }

  // Handle plain long text responses
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

  // Vault Actions
  const saveKey = () => {
    if (!newKeyName.trim() || !newKeyValue.trim()) return;
    
    const newEntry: StoredKey = {
      id: `k-${Date.now()}`,
      name: newKeyName.trim(),
      value: encryptValue(newKeyValue.trim()),
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

  const copyKey = async (encryptedValue: string) => {
    const raw = decryptValue(encryptedValue);
    await navigator.clipboard.writeText(raw);
    alert('API Key copied to clipboard!');
  };

  return (
    <div className="flex flex-col h-full bg-black text-emerald-400 font-mono text-xs rounded-[2rem] overflow-hidden border border-white/10 shadow-2xl relative">
      {/* Header with Model Selector */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-white/5">
        <div className="flex flex-col">
          <span className="text-[9px] font-black uppercase tracking-widest text-emerald-500/50">Lumina Terminal v1.4</span>
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
                           <button onClick={() => copyKey(k.value)} className="p-1.5 hover:bg-white/10 rounded text-blue-400" title="Copy Decrypted"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg></button>
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
