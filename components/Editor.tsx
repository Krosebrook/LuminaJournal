
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { rewriteSelectionStream, getProactiveSuggestions, getSpellingCorrections } from '../services/geminiService';
import { Suggestion, WritingTone } from '../types';

interface EditorProps {
  content: string;
  tone: WritingTone;
  onChange: (content: string) => void;
  isProcessing: boolean;
  setIsProcessing: (v: boolean) => void;
}

interface SpellError {
  id: string;
  word: string;
  corrections: string[];
}

const Editor: React.FC<EditorProps> = ({ content, tone, onChange, isProcessing, setIsProcessing }) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ text: string; range: Range | null; rect: DOMRect | null }>({ text: '', range: null, rect: null });
  const [feedback, setFeedback] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [spellErrors, setSpellErrors] = useState<SpellError[]>([]);
  const [isSpellcheckEnabled, setIsSpellcheckEnabled] = useState(false);
  
  // Dynamic UI States
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, error: SpellError } | null>(null);
  const [activeInlineSuggestion, setActiveInlineSuggestion] = useState<{ s: Suggestion, rect: DOMRect } | null>(null);

  /**
   * Virtual DOM Highlight Layer
   * Converts plain text into enriched HTML with interactive spans.
   */
  const highlightedContent = useMemo(() => {
    if (!content) return '';
    let html = content;

    // Layer 1: Linguistic Accuracy (Red Wavy)
    if (isSpellcheckEnabled) {
      spellErrors.forEach((err) => {
        const escaped = err.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        html = html.replace(new RegExp(`\\b${escaped}\\b`, 'g'), `<span class="spell-error" data-error-id="${err.id}">${err.word}</span>`);
      });
    }

    // Layer 2: AI Enhancements (Blue Dashed)
    suggestions.forEach((s) => {
      const escaped = s.originalText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      html = html.replace(new RegExp(escaped), `<span class="ai-suggestion" data-suggestion-id="${s.id}">${s.originalText}</span>`);
    });

    return html;
  }, [content, suggestions, spellErrors, isSpellcheckEnabled]);

  /**
   * Safe Sync Effect
   * Updates the contenteditable div without breaking the browser's selection range.
   */
  useEffect(() => {
    if (editorRef.current && !isStreaming) {
      if (document.activeElement !== editorRef.current) {
        editorRef.current.innerHTML = highlightedContent;
      }
    }
  }, [highlightedContent, isStreaming]);

  /**
   * Proactive Analysis Loop
   */
  useEffect(() => {
    if (isProcessing || content.length < 50) return;
    const timer = setTimeout(async () => {
      try {
        const results = await getProactiveSuggestions(content, tone);
        setSuggestions(prev => {
          const newSuggestions = results.map((r, i) => ({ ...r, id: `s-${Date.now()}-${i}` }));
          return [...prev.slice(-1), ...newSuggestions].slice(-4);
        });
      } catch (e) {
        console.error("Proactive scan failed", e);
      }
    }, 15000);
    return () => clearTimeout(timer);
  }, [content, tone, isProcessing]);

  /**
   * Spellcheck Processing
   */
  useEffect(() => {
    if (!isSpellcheckEnabled || content.length < 5) {
      setSpellErrors([]);
      return;
    }
    const timer = setTimeout(async () => {
      setIsProcessing(true);
      try {
        const errors = await getSpellingCorrections(content);
        setSpellErrors(errors.map((e, i) => ({ ...e, id: `err-${Date.now()}-${i}` })));
      } catch (e) {
        console.error("Spellcheck pipeline error", e);
      } finally {
        setIsProcessing(false);
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, [content, isSpellcheckEnabled]);

  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 0) {
      const range = sel.getRangeAt(0);
      setSelection({
        text: sel.toString(),
        range: range.cloneRange(),
        rect: range.getBoundingClientRect()
      });
    } else {
      const activeElement = document.activeElement;
      if (activeElement?.tagName !== 'INPUT' && activeElement?.id !== 'iteration-box') {
        setSelection({ text: '', range: null, rect: null });
      }
    }
  }, []);

  const handleContextMenu = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('spell-error')) {
      e.preventDefault();
      const id = target.getAttribute('data-error-id');
      const error = spellErrors.find(err => err.id === id);
      if (error) {
        setContextMenu({ x: e.clientX, y: e.clientY, error });
      }
    } else {
      setContextMenu(null);
    }
  };

  const handleEditorClick = (e: React.MouseEvent) => {
    setContextMenu(null);
    const target = e.target as HTMLElement;
    
    if (target.classList.contains('ai-suggestion')) {
      const id = target.getAttribute('data-suggestion-id');
      const suggestion = suggestions.find(s => s.id === id);
      if (suggestion) {
        setActiveInlineSuggestion({ s: suggestion, rect: target.getBoundingClientRect() });
      }
    } 
  };

  const applyCorrection = (error: SpellError, correction: string) => {
    const newContent = content.replace(error.word, correction);
    onChange(newContent);
    setSpellErrors(prev => prev.filter(e => e.id !== error.id));
    setContextMenu(null);
  };

  const handleRewrite = async (quickFeedback?: string) => {
    const targetFeedback = quickFeedback || feedback;
    if (!selection.text || !targetFeedback || !selection.range) return;

    setIsProcessing(true);
    setIsStreaming(true);
    
    try {
      let currentRewrite = "";
      await rewriteSelectionStream(content, selection.text, targetFeedback, tone, (chunk) => {
        currentRewrite = chunk;
      });

      const newContent = content.replace(selection.text, currentRewrite);
      onChange(newContent);
      setSelection({ text: '', range: null, rect: null });
      setFeedback('');
    } catch (e) {
      console.error("Rewrite failed", e);
    } finally {
      setIsProcessing(false);
      setIsStreaming(false);
    }
  };

  const applySuggestion = (s: Suggestion) => {
    if (content.includes(s.originalText)) {
      const newContent = content.replace(s.originalText, s.suggestedText);
      onChange(newContent);
    }
    setSuggestions(prev => prev.filter(x => x.id !== s.id));
    setActiveInlineSuggestion(null);
  };

  const dismissSuggestion = (id: string) => {
    setSuggestions(prev => prev.filter(x => x.id !== id));
    setActiveInlineSuggestion(null);
  };

  const applyAllSuggestions = () => {
    let newContent = content;
    suggestions.forEach(s => {
      if (newContent.includes(s.originalText)) {
        newContent = newContent.replace(s.originalText, s.suggestedText);
      }
    });
    onChange(newContent);
    setSuggestions([]);
    setActiveInlineSuggestion(null);
  };

  const renderTypeIcon = (type: string, size: string = "w-5 h-5") => {
    switch (type) {
      case 'critique': 
        return <svg className={`${size} text-amber-500`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>;
      case 'grammar': 
        return <svg className={`${size} text-emerald-500`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>;
      default: 
        return <svg className={`${size} text-blue-500`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>;
    }
  };

  return (
    <div className="relative max-w-3xl mx-auto py-32 px-12 min-h-screen">
      {/* GLOBAL ACTIONS LAYER */}
      {suggestions.length > 0 && (
        <div className="fixed bottom-24 right-16 z-20 animate-in slide-in-from-bottom-8 duration-500 pointer-events-auto flex flex-col items-end gap-3">
          <div className="glass px-4 py-2 rounded-2xl border border-blue-100 shadow-sm mb-1">
             <span className="text-[9px] font-black text-blue-600 uppercase tracking-widest">{suggestions.length} Improvements Identified</span>
          </div>
          <button 
            onClick={applyAllSuggestions}
            className="flex items-center gap-4 px-8 py-5 bg-blue-600 text-white rounded-full shadow-2xl hover:bg-blue-700 hover:scale-105 transition-all group active:scale-95"
          >
            <div className="flex -space-x-2">
               {suggestions.slice(0, 3).map((s) => (
                 <div key={s.id} className="w-8 h-8 rounded-full bg-white border-2 border-blue-600 flex items-center justify-center p-1.5 shadow-sm">
                   {renderTypeIcon(s.type, "w-full h-full")}
                 </div>
               ))}
            </div>
            <span className="text-[11px] font-black uppercase tracking-[0.25em]">Accept All Refinements</span>
            <svg className="w-5 h-5 text-blue-200 group-hover:rotate-12 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
          </button>
        </div>
      )}

      {/* Toggles & Context Layers */}
      <div className="fixed top-28 right-16 z-20">
        <button 
          onClick={() => setIsSpellcheckEnabled(!isSpellcheckEnabled)}
          className={`flex items-center gap-3 px-6 py-3 rounded-full glass border transition-all ${isSpellcheckEnabled ? 'border-red-200 text-red-600 bg-red-50/50 shadow-lg' : 'border-gray-200 text-gray-500 hover:border-blue-200'}`}
        >
          <div className={`w-2 h-2 rounded-full ${isSpellcheckEnabled ? 'bg-red-500 animate-pulse' : 'bg-gray-300'}`}></div>
          <span className="text-[10px] font-black uppercase tracking-widest">{isSpellcheckEnabled ? 'Deep Spellcheck Active' : 'Enable Spellcheck'}</span>
        </button>
      </div>

      {/* Refined Context Menu for Spellcheck */}
      {contextMenu && (
        <div 
          className="fixed z-[100] glass rounded-[1.5rem] shadow-[0_30px_60px_-12px_rgba(0,0,0,0.25)] border border-white/50 overflow-hidden min-w-[220px] animate-in fade-in zoom-in duration-200"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <div className="p-4 bg-red-50/30 border-b border-red-100/50 flex items-center justify-between">
             <div className="flex items-center gap-2">
               <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></div>
               <span className="text-[10px] font-black text-red-600 uppercase tracking-[0.2em]">Correct</span>
             </div>
             <span className="text-[10px] font-bold text-gray-400 font-mono">"{contextMenu.error.word}"</span>
          </div>
          <div className="py-2 bg-white/40">
            {contextMenu.error.corrections.length > 0 ? (
              contextMenu.error.corrections.map((c, i) => (
                <button 
                  key={i}
                  onClick={() => applyCorrection(contextMenu.error, c)}
                  className="w-full text-left px-5 py-3 text-[13px] font-bold text-gray-800 hover:bg-blue-600 hover:text-white transition-all flex items-center justify-between group"
                >
                  {c}
                  <svg className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>
                </button>
              ))
            ) : (
              <div className="px-5 py-3 text-[11px] text-gray-400 italic">No suggestions available</div>
            )}
            <div className="h-[1px] bg-gray-100/50 my-1 mx-2"></div>
            <button 
              onClick={() => { setSpellErrors(prev => prev.filter(e => e.id !== contextMenu.error.id)); setContextMenu(null); }}
              className="w-full text-left px-5 py-3 text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-red-500 transition-colors"
            >
              Add to Dictionary
            </button>
            <button 
              onClick={() => setContextMenu(null)}
              className="w-full text-left px-5 py-3 text-[10px] font-black uppercase tracking-widest text-gray-300 hover:text-gray-500 transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* EDITING INTERFACE */}
      {activeInlineSuggestion && (
        <div 
          className="fixed z-50 glass rounded-[2.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.15)] p-6 flex flex-col gap-5 animate-in fade-in slide-in-from-top-4 duration-300 border border-blue-100/50 overflow-hidden"
          style={{ 
            top: activeInlineSuggestion.rect.bottom + window.scrollY + 12, 
            left: Math.max(20, Math.min(window.innerWidth - 340, activeInlineSuggestion.rect.left + (activeInlineSuggestion.rect.width / 2) - 160)),
            width: '320px'
          }}
        >
          <div className="absolute -top-12 -right-12 w-24 h-24 bg-blue-500/5 blur-3xl rounded-full pointer-events-none"></div>
          <div className="flex items-center justify-between relative">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-gray-50 rounded-2xl border border-gray-100/50">
                {renderTypeIcon(activeInlineSuggestion.s.type)}
              </div>
              <div>
                <h4 className="text-[10px] font-black uppercase tracking-[0.25em] text-blue-600/60">Partner Suggestion</h4>
                <p className="text-sm font-bold text-gray-900 capitalize">{activeInlineSuggestion.s.type}</p>
              </div>
            </div>
            <button onClick={() => setActiveInlineSuggestion(null)} className="text-gray-300 hover:text-gray-600 transition-all p-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
          </div>
          <div className="space-y-4 relative">
            <div className="p-4 bg-blue-50/40 rounded-3xl border border-blue-100/50 shadow-inner">
              <p className="text-xs text-gray-700 leading-relaxed font-medium">{activeInlineSuggestion.s.explanation}</p>
            </div>
            <div className="px-1">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-[1px] flex-1 bg-gray-100"></div>
                <span className="text-[9px] font-black uppercase tracking-widest text-gray-300">Revised Output</span>
                <div className="h-[1px] flex-1 bg-gray-100"></div>
              </div>
              <p className="text-[13px] text-gray-600 italic leading-relaxed pl-3 border-l-2 border-blue-400/30">"{activeInlineSuggestion.s.suggestedText}"</p>
            </div>
          </div>
          <div className="flex gap-2 pt-1 relative">
            <button 
              onClick={() => applySuggestion(activeInlineSuggestion.s)}
              className="flex-[2] flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] bg-blue-600 text-white py-4 rounded-2xl hover:bg-blue-700 transition-all shadow-xl shadow-blue-500/20 active:scale-[0.98]"
            >
              Accept Change
            </button>
            <button onClick={() => dismissSuggestion(activeInlineSuggestion.s.id)} className="flex-1 text-[10px] font-black uppercase text-gray-400 hover:text-gray-800 tracking-widest transition-colors py-4">Dismiss</button>
          </div>
        </div>
      )}

      {/* Manual Selection Interface */}
      {selection.rect && !activeInlineSuggestion && (
        <div 
          id="iteration-box"
          className="fixed z-50 glass rounded-[2.5rem] shadow-2xl p-6 flex flex-col gap-4 animate-in fade-in zoom-in duration-300 border border-white"
          style={{ 
            top: selection.rect.top + window.scrollY - 220, 
            left: Math.max(20, Math.min(window.innerWidth - 380, selection.rect.left + (selection.rect.width / 2) - 180)),
            width: '360px'
          }}
        >
          <div className="flex flex-col gap-2">
            <span className="text-[9px] font-black uppercase tracking-[0.25em] text-gray-400 mb-1">Quick Actions</span>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Vivid', icon: '🎨' },
                { label: 'Concise', icon: '⚡' },
                { label: 'Professional', icon: '💼' },
                { label: 'Expand', icon: '➕' },
                { label: 'Details', icon: '🔍' },
                { label: 'Clarify', icon: '✨' }
              ].map(item => (
                <button 
                  key={item.label}
                  onClick={() => handleRewrite(item.label)}
                  className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest bg-gray-50 text-gray-700 px-3.5 py-2.5 rounded-xl hover:bg-blue-600 hover:text-white transition-all border border-gray-100 active:scale-95 group"
                >
                  <span className="text-xs group-hover:scale-110 transition-transform">{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="relative mt-2">
            <span className="text-[9px] font-black uppercase tracking-[0.25em] text-gray-400 block mb-2">Custom Guidance</span>
            <div className="relative">
              <input 
                autoFocus
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Direct your writing partner..."
                className="w-full bg-white/60 border border-gray-100 rounded-[1.5rem] py-4 px-6 text-sm focus:ring-4 focus:ring-blue-500/10 focus:border-blue-400 outline-none pr-12 transition-all shadow-inner"
                onKeyDown={(e) => e.key === 'Enter' && handleRewrite()}
              />
              <button onClick={() => handleRewrite()} disabled={!feedback && !isProcessing} className="absolute right-3 top-1/2 -translate-y-1/2 p-2.5 text-blue-600 hover:scale-110 transition-transform disabled:opacity-30">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M13 7l5 5m0 0l-5 5m5-5H6"></path></svg>
              </button>
            </div>
          </div>
          <button onClick={() => setSelection({text: '', range: null, rect: null})} className="text-[9px] font-bold text-gray-400 uppercase tracking-widest text-center hover:text-gray-700 transition-colors pt-1">Cancel Selection</button>
        </div>
      )}

      {/* PRIMARY CANVAS */}
      <div className="relative group">
        <div
          ref={editorRef}
          contentEditable
          spellCheck={false}
          onMouseUp={handleMouseUp}
          onClick={handleEditorClick}
          onContextMenu={handleContextMenu}
          onInput={(e) => {
            const newText = e.currentTarget.innerText;
            if (newText !== content) onChange(newText);
          }}
          className={`w-full min-h-[80vh] text-xl md:text-2xl leading-[2.1] text-gray-900 font-serif whitespace-pre-wrap outline-none selection:bg-blue-100/70 transition-opacity duration-700 ${isStreaming ? 'opacity-70 cursor-wait' : 'opacity-100'}`}
          dangerouslySetInnerHTML={{ __html: highlightedContent }}
        />
        {content === '' && (
          <div className="absolute top-0 pointer-events-none text-gray-300 text-xl md:text-2xl font-serif leading-[2.1]">
            Your narrative begins here. Prompt the collaborator or start typing to engage...
          </div>
        )}
      </div>

      {/* FEEDBACK SIDEBAR (XL ONLY) */}
      <div className="fixed right-16 top-48 w-72 space-y-6 pointer-events-none hidden xl:block">
        {suggestions.map((s) => (
          <div 
            key={s.id}
            className="pointer-events-auto group glass p-8 rounded-[2.5rem] shadow-sm border border-transparent hover:border-blue-200 hover:shadow-2xl transition-all translate-x-12 hover:translate-x-0 cursor-pointer"
            onClick={() => {
              const el = document.querySelector(`[data-suggestion-id="${s.id}"]`);
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                setActiveInlineSuggestion({ s, rect: el.getBoundingClientRect() });
              }
            }}
          >
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gray-50 rounded-xl">{renderTypeIcon(s.type)}</div>
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">{s.type}</span>
              </div>
              <button onClick={(e) => { e.stopPropagation(); setSuggestions(v => v.filter(x => x.id !== s.id)); }} className="text-gray-300 hover:text-gray-500 transition-colors p-1">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
            <p className="text-[13px] text-gray-800 font-bold leading-relaxed mb-6">{s.explanation}</p>
            <button onClick={(e) => { e.stopPropagation(); applySuggestion(s); }} className="w-full text-[10px] font-black uppercase tracking-[0.3em] bg-gray-900 text-white py-4 rounded-2xl hover:bg-black transition-all shadow-xl active:scale-95">Admit Change</button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Editor;
