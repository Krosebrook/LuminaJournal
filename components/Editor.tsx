
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { rewriteSelectionStream, getProactiveSuggestions, getSpellingCorrections } from '../services/geminiService';
import { Suggestion, WritingTone, Comment } from '../types';

interface EditorProps {
  content: string;
  tone: WritingTone;
  onChange: (content: string) => void;
  isProcessing: boolean;
  setIsProcessing: (v: boolean) => void;
  suggestions: Suggestion[];
  setSuggestions: React.Dispatch<React.SetStateAction<Suggestion[]>>;
  comments: Comment[];
  setComments: React.Dispatch<React.SetStateAction<Comment[]>>;
  onApplyAll: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  pushToHistory: (content: string, suggestions: Suggestion[], comments: Comment[]) => void;
}

interface SpellError {
  id: string;
  word: string;
  corrections: string[];
}

const Editor: React.FC<EditorProps> = ({ 
  content, 
  tone, 
  onChange, 
  isProcessing, 
  setIsProcessing, 
  suggestions, 
  setSuggestions,
  comments,
  setComments,
  onApplyAll,
  undo,
  redo,
  pushToHistory
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ text: string; range: Range | null; rect: DOMRect | null }>({ text: '', range: null, rect: null });
  const [feedback, setFeedback] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [spellErrors, setSpellErrors] = useState<SpellError[]>([]);
  const [isSpellcheckEnabled, setIsSpellcheckEnabled] = useState(false);
  const [isFlashing, setIsFlashing] = useState(false);
  const [isCommenting, setIsCommenting] = useState(false);
  const [commentText, setCommentText] = useState('');
  
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, error: SpellError } | null>(null);
  const [activeInlineSuggestion, setActiveInlineSuggestion] = useState<{ s: Suggestion, rect: DOMRect } | null>(null);
  const [hoveredSuggestion, setHoveredSuggestion] = useState<{ s: Suggestion, rect: DOMRect } | null>(null);
  const [hoveredCommentId, setHoveredCommentId] = useState<string | null>(null);
  const [showMarginNotes, setShowMarginNotes] = useState(true);

  const highlightedContent = useMemo(() => {
    if (!content) return '';
    let html = content;

    if (isSpellcheckEnabled) {
      spellErrors.forEach((err) => {
        const escaped = err.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        html = html.replace(new RegExp(`\\b${escaped}\\b`, 'g'), `<span class="spell-error" data-error-id="${err.id}">${err.word}</span>`);
      });
    }

    // Wrap suggestions
    suggestions.forEach((s) => {
      const escaped = s.originalText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const replacement = `
        <span class="ai-suggestion" data-suggestion-id="${s.id}">
          ${s.originalText}<span class="quick-accept-trigger" data-quick-accept="${s.id}" contenteditable="false" title="Accept Suggestion">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" style="width:10px;height:10px;"><polyline points="20 6 9 17 4 12"></polyline></svg>
          </span>
        </span>`.trim();
      
      html = html.replace(new RegExp(escaped, 'g'), replacement);
    });

    // Wrap comments
    comments.forEach((c) => {
      const escaped = c.originalText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const isHovered = hoveredCommentId === c.id;
      const replacement = `<span class="user-comment ${isHovered ? 'ring-2 ring-amber-400/50 bg-amber-100/50' : ''}" data-comment-id="${c.id}">${c.originalText}</span>`;
      html = html.replace(new RegExp(escaped, 'g'), replacement);
    });

    return html;
  }, [content, suggestions, spellErrors, isSpellcheckEnabled, comments, hoveredCommentId]);

  const handleMagicApplyAll = useCallback(() => {
    if (suggestions.length === 0) return;
    setIsFlashing(true);
    onApplyAll();
    setTimeout(() => setIsFlashing(false), 1200);
  }, [suggestions.length, onApplyAll]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdKey = isMac ? e.metaKey : e.ctrlKey;

      if (cmdKey && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      }
      else if ((cmdKey && e.shiftKey && e.key.toLowerCase() === 'z') || (cmdKey && e.key.toLowerCase() === 'y')) {
        e.preventDefault();
        redo();
      }
      else if (cmdKey && e.shiftKey && e.key.toLowerCase() === 'a') {
        if (suggestions.length > 0) {
          e.preventDefault();
          handleMagicApplyAll();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleMagicApplyAll, suggestions.length, undo, redo]);

  useEffect(() => {
    if (editorRef.current && !isStreaming) {
      if (document.activeElement !== editorRef.current) {
        editorRef.current.innerHTML = highlightedContent;
      }
    }
  }, [highlightedContent, isStreaming, content]);

  useEffect(() => {
    if (isProcessing || content.length < 50) return;
    const timer = setTimeout(async () => {
      try {
        const results = await getProactiveSuggestions(content, tone);
        setSuggestions(prev => {
          const newSuggestions = results.map((r, i) => ({ ...r, id: `s-${Date.now()}-${i}` }));
          const merged = [...prev, ...newSuggestions];
          const valid = merged.filter(s => content.includes(s.originalText));
          const final = valid.slice(-6);
          if (final.length !== prev.length) {
             pushToHistory(content, final, comments);
          }
          return final;
        });
      } catch (e) {
        console.error("Proactive scan failed", e);
      }
    }, 15000);
    return () => clearTimeout(timer);
  }, [content, tone, isProcessing, setSuggestions, pushToHistory, comments]);

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
        console.error("Spellcheck error", e);
      } finally {
        setIsProcessing(false);
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, [content, isSpellcheckEnabled, setIsProcessing]);

  const applySuggestion = useCallback((s: Suggestion) => {
    if (content.includes(s.originalText)) {
      const newContent = content.replace(s.originalText, s.suggestedText);
      const newSuggestions = suggestions.filter(x => x.id !== s.id);
      onChange(newContent);
      setSuggestions(newSuggestions);
      pushToHistory(newContent, newSuggestions, comments);
    }
    setActiveInlineSuggestion(null);
    setHoveredSuggestion(null);
  }, [content, suggestions, comments, onChange, setSuggestions, pushToHistory]);

  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 0) {
      const range = sel.getRangeAt(0);
      setSelection({
        text: sel.toString(),
        range: range.cloneRange(),
        rect: range.getBoundingClientRect()
      });
      setIsCommenting(false);
    } else {
      const activeElement = document.activeElement;
      if (activeElement?.tagName !== 'INPUT' && activeElement?.id !== 'iteration-box') {
        setSelection({ text: '', range: null, rect: null });
        setIsCommenting(false);
      }
    }
  }, []);

  const handleEditorClick = (e: React.MouseEvent) => {
    setContextMenu(null);
    const target = e.target as HTMLElement;
    
    const quickAcceptBtn = target.closest('.quick-accept-trigger') as HTMLElement;
    if (quickAcceptBtn) {
      e.stopPropagation();
      e.preventDefault();
      const id = quickAcceptBtn.getAttribute('data-quick-accept');
      const suggestion = suggestions.find(s => s.id === id);
      if (suggestion) {
        applySuggestion(suggestion);
      }
      return;
    }

    const suggestionSpan = target.closest('.ai-suggestion') as HTMLElement;
    if (suggestionSpan) {
      const id = suggestionSpan.getAttribute('data-suggestion-id');
      const suggestion = suggestions.find(s => s.id === id);
      if (suggestion) {
        setActiveInlineSuggestion({ s: suggestion, rect: suggestionSpan.getBoundingClientRect() });
        setHoveredSuggestion(null);
      }
      return;
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const suggestionSpan = target.closest('.ai-suggestion') as HTMLElement;
    const commentSpan = target.closest('.user-comment') as HTMLElement;
    
    if (suggestionSpan) {
      const id = suggestionSpan.getAttribute('data-suggestion-id');
      const suggestion = suggestions.find(s => s.id === id);
      if (suggestion && (!hoveredSuggestion || hoveredSuggestion.s.id !== id)) {
        setHoveredSuggestion({ s: suggestion, rect: suggestionSpan.getBoundingClientRect() });
      }
      setHoveredCommentId(null);
    } else if (commentSpan) {
      const id = commentSpan.getAttribute('data-comment-id');
      setHoveredCommentId(id);
      setHoveredSuggestion(null);
    } else {
      if (hoveredSuggestion) setHoveredSuggestion(null);
      if (hoveredCommentId) setHoveredCommentId(null);
    }
  };

  const handleAddComment = () => {
    if (!commentText.trim() || !selection.text) return;
    const newComment: Comment = {
      id: `c-${Date.now()}`,
      text: commentText,
      originalText: selection.text,
      timestamp: Date.now()
    };
    const newComments = [...comments, newComment];
    setComments(newComments);
    pushToHistory(content, suggestions, newComments);
    setCommentText('');
    setSelection({ text: '', range: null, rect: null });
    setIsCommenting(false);
  };

  const handleDeleteComment = (id: string) => {
    const newComments = comments.filter(c => c.id !== id);
    setComments(newComments);
    pushToHistory(content, suggestions, newComments);
  };

  const handleCommentClick = (id: string) => {
    const commentEl = editorRef.current?.querySelector(`[data-comment-id="${id}"]`);
    if (commentEl) {
      commentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Visual feedback
      (commentEl as HTMLElement).classList.add('animate-pulse');
      setTimeout(() => (commentEl as HTMLElement).classList.remove('animate-pulse'), 2000);
    }
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
      pushToHistory(newContent, suggestions, comments);
      setSelection({ text: '', range: null, rect: null });
      setFeedback('');
    } catch (e) {
      console.error("Rewrite failed", e);
    } finally {
      setIsProcessing(false);
      setIsStreaming(false);
    }
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

  const isMac = typeof window !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

  return (
    <div className={`relative flex gap-12 max-w-[1400px] mx-auto py-32 px-12 min-h-screen transition-all duration-700 ${isFlashing ? 'bg-blue-50/50 ring-8 ring-blue-500/10' : ''}`} onMouseMove={handleMouseMove}>
      
      {/* SUGGESTION HOVER TOOLTIP */}
      {hoveredSuggestion && !activeInlineSuggestion && (
        <div 
          className="fixed z-[60] glass px-5 py-3.5 rounded-2xl shadow-xl border border-white/50 pointer-events-none animate-in fade-in zoom-in duration-200"
          style={{ 
            top: hoveredSuggestion.rect.top + window.scrollY - 60, 
            left: hoveredSuggestion.rect.left + (hoveredSuggestion.rect.width / 2) - 100,
            maxWidth: '240px'
          }}
        >
          <div className="flex items-center gap-2 mb-1.5">
            {renderTypeIcon(hoveredSuggestion.s.type, "w-3.5 h-3.5")}
            <span className="text-[9px] font-black uppercase tracking-widest text-blue-600/80">Suggestion Insight</span>
          </div>
          <p className="text-[11px] text-gray-700 font-medium leading-relaxed">{hoveredSuggestion.s.explanation}</p>
          <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 glass rotate-45 border-r border-b border-white/50"></div>
        </div>
      )}

      {/* PRIMARY EDITOR CANVAS */}
      <div className="flex-1 relative group">
        <div
          ref={editorRef}
          contentEditable
          spellCheck={false}
          onMouseUp={handleMouseUp}
          onClick={handleEditorClick}
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

      {/* MARGIN NOTES SIDEBAR */}
      {comments.length > 0 && (
        <aside 
          className={`w-80 h-fit sticky top-32 transition-all duration-500 ${showMarginNotes ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8 pointer-events-none'}`}
        >
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-400">Margin Notes ({comments.length})</h3>
            <button 
              onClick={() => setShowMarginNotes(false)}
              className="p-1 hover:bg-gray-100 rounded-lg text-gray-400 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
          </div>
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2 custom-scrollbar pb-20">
            {comments.map((c) => (
              <div 
                key={c.id}
                onMouseEnter={() => setHoveredCommentId(c.id)}
                onMouseLeave={() => setHoveredCommentId(null)}
                onClick={() => handleCommentClick(c.id)}
                className={`group glass p-5 rounded-3xl border transition-all cursor-pointer hover:shadow-lg hover:-translate-y-1 ${hoveredCommentId === c.id ? 'border-amber-300 ring-4 ring-amber-500/5 shadow-xl' : 'border-gray-100'}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></div>
                    <span className="text-[9px] font-black uppercase tracking-widest text-amber-600">User Thought</span>
                  </div>
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleDeleteComment(c.id); }}
                    className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-50 text-gray-300 hover:text-red-500 rounded-lg transition-all"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                  </button>
                </div>
                <div className="mb-3">
                  <span className="text-[10px] font-bold text-gray-400 italic block mb-1">Context:</span>
                  <p className="text-[11px] text-gray-500 line-clamp-2 leading-relaxed pl-2 border-l-2 border-gray-100">"{c.originalText}"</p>
                </div>
                <p className="text-sm font-medium text-gray-800 leading-snug">{c.text}</p>
                <div className="mt-4 pt-3 border-t border-gray-50 flex items-center justify-between text-[8px] font-black uppercase tracking-widest text-gray-300">
                  <span>{new Date(c.timestamp).toLocaleDateString()}</span>
                  <span>{new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              </div>
            ))}
          </div>
        </aside>
      )}

      {/* MARGIN NOTES TOGGLE (If hidden) */}
      {!showMarginNotes && comments.length > 0 && (
        <button 
          onClick={() => setShowMarginNotes(true)}
          className="fixed bottom-36 right-16 p-5 glass rounded-full shadow-xl hover:scale-110 hover:shadow-2xl transition-all text-amber-600 border border-white group z-30"
        >
          <div className="relative">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg>
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-amber-500 text-white text-[8px] font-bold flex items-center justify-center rounded-full ring-2 ring-white">{comments.length}</span>
          </div>
        </button>
      )}

      {/* FLOATING ACTION: ACCEPT ALL */}
      {suggestions.length > 0 && (
        <div className="fixed bottom-24 right-16 z-20 animate-in slide-in-from-bottom-8 duration-500 pointer-events-auto flex flex-col items-end gap-3">
          <div className="glass px-4 py-2 rounded-2xl border border-blue-100 shadow-sm mb-1">
             <span className="text-[9px] font-black text-blue-600 uppercase tracking-widest">{suggestions.length} Improvements Available</span>
          </div>
          
          <div className="relative group overflow-visible">
            {isFlashing && (
              <>
                <div className="sonar-ring"></div>
                <div className="sonar-ring" style={{ animationDelay: '0.2s' }}></div>
                <div className="sparkle text-blue-400" style={{ top: '-40px', left: '20px', fontSize: '24px' }}>✦</div>
                <div className="sparkle text-amber-400" style={{ top: '-10px', left: '80%', fontSize: '18px', animationDelay: '0.1s' }}>✨</div>
                <div className="sparkle text-blue-300" style={{ top: '-50px', left: '50%', fontSize: '16px', animationDelay: '0.2s' }}>✧</div>
                <div className="sparkle text-emerald-500" style={{ top: '40px', left: '0px', fontSize: '22px', animationDelay: '0.3s' }}>✨</div>
                <div className="sparkle text-indigo-400" style={{ top: '60px', left: '70%', fontSize: '14px', animationDelay: '0.4s' }}>✦</div>
              </>
            )}
            
            <button 
              onClick={handleMagicApplyAll}
              className={`relative flex items-center gap-4 px-8 py-5 rounded-full shadow-2xl transition-all active:scale-95 border-2 overflow-hidden ${isFlashing ? 'bg-emerald-500 border-emerald-400 text-white magic-pop' : 'bg-blue-600 border-transparent text-white hover:bg-blue-700 hover:scale-105'}`}
            >
              <div className="shine-overlay"></div>
              <div className="flex -space-x-2 relative z-10">
                 {isFlashing ? (
                   <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center p-1.5 shadow-sm text-emerald-500 scale-110 transition-transform">
                     <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M5 13l4 4L19 7"></path></svg>
                   </div>
                 ) : (
                   suggestions.slice(0, 3).map((s) => (
                     <div key={s.id} className="w-8 h-8 rounded-full bg-white border-2 border-blue-600 flex items-center justify-center p-1.5 shadow-sm transition-transform group-hover:scale-110">
                       {renderTypeIcon(s.type, "w-full h-full")}
                     </div>
                   ))
                 )}
              </div>
              <div className="flex flex-col items-start leading-none relative z-10">
                <span className="text-[11px] font-black uppercase tracking-[0.25em]">
                  {isFlashing ? 'Successfully Applied' : 'Accept All Refinements'}
                </span>
                {!isFlashing && (
                  <span className="text-[8px] font-bold text-blue-200 mt-1 uppercase tracking-widest">{isMac ? '⌘' : 'Ctrl'} + Shift + A</span>
                )}
              </div>
            </button>
          </div>
        </div>
      )}

      {selection.rect && !activeInlineSuggestion && (
        <div 
          id="iteration-box"
          className="fixed z-50 glass rounded-[2.5rem] shadow-2xl p-6 flex flex-col gap-4 animate-in fade-in zoom-in duration-300 border border-white"
          style={{ 
            top: selection.rect.top + window.scrollY - (isCommenting ? 150 : 220), 
            left: Math.max(20, Math.min(window.innerWidth - 380, selection.rect.left + (selection.rect.width / 2) - 180)),
            width: '360px'
          }}
        >
          {isCommenting ? (
            <div className="flex flex-col gap-3">
              <span className="text-[9px] font-black uppercase tracking-[0.25em] text-amber-500 mb-1">Add Margin Note</span>
              <div className="relative">
                <input 
                  autoFocus
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Record your observation..."
                  className="w-full bg-amber-50/30 border border-amber-100 rounded-[1.5rem] py-4 px-6 text-sm focus:ring-4 focus:ring-amber-500/10 focus:border-amber-400 outline-none transition-all shadow-inner"
                  onKeyDown={(e) => e.key === 'Enter' && handleAddComment()}
                />
                <button onClick={handleAddComment} className="absolute right-3 top-1/2 -translate-y-1/2 p-2.5 text-amber-600 hover:scale-110 transition-transform">
                   <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>
                </button>
              </div>
              <button onClick={() => setIsCommenting(false)} className="text-[9px] font-bold text-gray-400 uppercase tracking-widest text-center">Back</button>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-black uppercase tracking-[0.25em] text-gray-400 mb-1">Quick Actions</span>
                  <button 
                    onClick={() => setIsCommenting(true)}
                    className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-amber-600 hover:text-amber-700 transition-colors"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg>
                    Comment
                  </button>
                </div>
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
            </>
          )}
          <button onClick={() => setSelection({text: '', range: null, rect: null})} className="text-[9px] font-bold text-gray-400 uppercase tracking-widest text-center hover:text-gray-700 transition-colors pt-1">Cancel Selection</button>
        </div>
      )}
    </div>
  );
};

export default Editor;
