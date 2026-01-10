
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { rewriteSelectionStream, getProactiveSuggestions } from '../services/geminiService';
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
  const isInternalUpdate = useRef(false);
  const hoverTimeoutRef = useRef<any>(null);
  
  const [selection, setSelection] = useState<{ text: string; range: Range | null; rect: DOMRect | null }>({ text: '', range: null, rect: null });
  const [feedback, setFeedback] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [spellErrors, setSpellErrors] = useState<SpellError[]>([
    // Mock spell errors for demonstration
    { id: 'se-1', word: 'biographry', corrections: ['biography', 'biographies'] },
    { id: 'se-2', word: 'memoire', corrections: ['memoir', 'memoirs'] },
    { id: 'se-3', word: 'autobiograpy', corrections: ['autobiography'] }
  ]);
  const [isSpellcheckEnabled, setIsSpellcheckEnabled] = useState(true);
  const [isFlashing, setIsFlashing] = useState(false);
  const [isCommenting, setIsCommenting] = useState(false);
  const [commentText, setCommentText] = useState('');
  
  const [hoveredSuggestion, setHoveredSuggestion] = useState<{ s: Suggestion, rect: DOMRect } | null>(null);
  const [hoveredComment, setHoveredComment] = useState<{ c: Comment, rect: DOMRect } | null>(null);
  const [hoveredCommentId, setHoveredCommentId] = useState<string | null>(null);
  const [inspectedSpellError, setInspectedSpellError] = useState<{ err: SpellError, rect: DOMRect } | null>(null);
  const [showMarginNotes, setShowMarginNotes] = useState(true);

  // Synchronize internal state with DOM
  const highlightedContent = useMemo(() => {
    if (!content) return '';
    let html = content;

    // Apply Highlights (Spellcheck, Suggestions, Comments)
    if (isSpellcheckEnabled) {
      spellErrors.forEach((err) => {
        const escaped = err.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        html = html.replace(new RegExp(`\\b${escaped}\\b`, 'g'), `<span class="spell-error" data-error-id="${err.id}">${err.word}</span>`);
      });
    }

    suggestions.forEach((s) => {
      const escaped = s.originalText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Updated Quick Accept Trigger: Green color, better icon, explicit styling to override defaults if needed
      const replacement = `
        <span class="ai-suggestion" data-suggestion-id="${s.id}">
          ${s.originalText}<span class="quick-accept-trigger" data-quick-accept="${s.id}" contenteditable="false" title="Accept Suggestion" style="background-color: #10b981;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;"><polyline points="20 6 9 17 4 12"></polyline></svg>
          </span>
        </span>`.trim();
      html = html.replace(new RegExp(escaped, 'g'), replacement);
    });

    comments.forEach((c) => {
      const escaped = c.originalText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const isHovered = hoveredCommentId === c.id;
      const replacement = `<span class="user-comment ${isHovered ? 'ring-2 ring-amber-400/50 bg-amber-100/50' : ''}" data-comment-id="${c.id}">${c.originalText}</span>`;
      html = html.replace(new RegExp(escaped, 'g'), replacement);
    });

    return html;
  }, [content, suggestions, spellErrors, isSpellcheckEnabled, comments, hoveredCommentId]);

  // Effect to update DOM when content state changes (e.g. from AI)
  useEffect(() => {
    if (editorRef.current && !isInternalUpdate.current) {
      const isFocused = document.activeElement === editorRef.current;
      if (isProcessing || !isFocused) {
        editorRef.current.innerHTML = highlightedContent;
      }
    }
    isInternalUpdate.current = false;
  }, [highlightedContent, isProcessing]);

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    };
  }, []);

  const handleMagicApplyAll = useCallback(() => {
    if (suggestions.length === 0) return;
    setIsFlashing(true);
    onApplyAll();
    setTimeout(() => setIsFlashing(false), 1200);
  }, [suggestions.length, onApplyAll]);

  const handleInput = (e: React.FormEvent<HTMLDivElement>) => {
    const newText = e.currentTarget.innerText;
    isInternalUpdate.current = true;
    onChange(newText);
    pushToHistory(newText, suggestions, comments);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const cmdKey = navigator.platform.toUpperCase().includes('MAC') ? e.metaKey : e.ctrlKey;
      if (cmdKey && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      else if ((cmdKey && e.shiftKey && e.key.toLowerCase() === 'z') || (cmdKey && e.key.toLowerCase() === 'y')) { e.preventDefault(); redo(); }
      else if (cmdKey && e.shiftKey && e.key.toLowerCase() === 'a') { if (suggestions.length > 0) { e.preventDefault(); handleMagicApplyAll(); } }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleMagicApplyAll, suggestions.length, undo, redo]);

  useEffect(() => {
    if (isProcessing || content.length < 50) return;
    const timer = setTimeout(async () => {
      try {
        const results = await getProactiveSuggestions(content, tone);
        setSuggestions(prev => {
          const newSuggestions = results.map((r, i) => ({ ...r, id: `s-${Date.now()}-${i}` }));
          const valid = [...prev, ...newSuggestions].filter(s => content.includes(s.originalText)).slice(-6);
          return valid;
        });
      } catch (e) { console.error("Proactive scan failed", e); }
    }, 15000);
    return () => clearTimeout(timer);
  }, [content, tone, isProcessing, setSuggestions]);

  const applySuggestion = useCallback((s: Suggestion) => {
    if (content.includes(s.originalText)) {
      const newContent = content.replace(s.originalText, s.suggestedText);
      const newSuggestions = suggestions.filter(x => x.id !== s.id);
      onChange(newContent);
      setSuggestions(newSuggestions);
      setHoveredSuggestion(null);
      pushToHistory(newContent, newSuggestions, comments);
    }
  }, [content, suggestions, comments, onChange, setSuggestions, pushToHistory]);

  const rejectSuggestion = useCallback((s: Suggestion) => {
    const newSuggestions = suggestions.filter(x => x.id !== s.id);
    setSuggestions(newSuggestions);
    setHoveredSuggestion(null);
    pushToHistory(content, newSuggestions, comments);
  }, [suggestions, setSuggestions, content, comments, pushToHistory]);

  const applyCorrection = (errorId: string, correction: string) => {
    const err = spellErrors.find(e => e.id === errorId);
    if (!err) return;
    const newContent = content.replace(new RegExp(`\\b${err.word}\\b`, 'g'), correction);
    const newErrors = spellErrors.filter(e => e.id !== errorId);
    onChange(newContent);
    setSpellErrors(newErrors);
    setInspectedSpellError(null);
    pushToHistory(newContent, suggestions, comments);
  };

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
      setInspectedSpellError(null);
    } else {
      if (!document.activeElement?.closest('#iteration-box') && !document.activeElement?.closest('#spellcheck-box')) {
        setSelection({ text: '', range: null, rect: null });
        setIsCommenting(false);
      }
    }
  }, []);

  const handleEditorClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    
    const spellErrorSpan = target.closest('.spell-error') as HTMLElement;
    if (spellErrorSpan) {
      e.stopPropagation();
      const id = spellErrorSpan.getAttribute('data-error-id');
      const err = spellErrors.find(e => e.id === id);
      if (err) {
        setInspectedSpellError({ err, rect: spellErrorSpan.getBoundingClientRect() });
        setSelection({ text: '', range: null, rect: null });
        return;
      }
    }

    const quickAcceptBtn = target.closest('.quick-accept-trigger') as HTMLElement;
    if (quickAcceptBtn) {
      e.stopPropagation();
      e.preventDefault();
      const id = quickAcceptBtn.getAttribute('data-quick-accept');
      const suggestion = suggestions.find(s => s.id === id);
      if (suggestion) applySuggestion(suggestion);
      return;
    }

    const suggestionSpan = target.closest('.ai-suggestion') as HTMLElement;
    if (suggestionSpan) {
      const id = suggestionSpan.getAttribute('data-suggestion-id');
      const suggestion = suggestions.find(s => s.id === id);
      if (suggestion) {
        setHoveredSuggestion({ s: suggestion, rect: suggestionSpan.getBoundingClientRect() });
      }
      return;
    }

    setInspectedSpellError(null);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;

    const isOverTooltip = target.closest('.suggestion-tooltip');
    const isOverSuggestion = target.closest('.ai-suggestion');
    const isOverComment = target.closest('.user-comment');

    // 1. Handle Suggestion Tooltip Persistence
    // If over tooltip or suggestion, keep it alive (clear timeout)
    if (isOverTooltip || isOverSuggestion) {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = null;
      }
    }

    if (isOverSuggestion) {
      const id = (isOverSuggestion as HTMLElement).getAttribute('data-suggestion-id');
      if (hoveredSuggestion?.s.id !== id) {
         const suggestion = suggestions.find(s => s.id === id);
         if (suggestion) {
           setHoveredSuggestion({ s: suggestion, rect: (isOverSuggestion as HTMLElement).getBoundingClientRect() });
         }
      }
      // If we are on a suggestion, we shouldn't show comments
      setHoveredCommentId(null);
      setHoveredComment(null);
      return; 
    }

    if (isOverTooltip) {
      // Don't do anything, just keep showing it.
      // Also ensure comments are hidden if we are interacting with suggestion tooltip
      setHoveredCommentId(null);
      setHoveredComment(null);
      return;
    }

    // 2. If not over suggestion or tooltip, schedule hiding
    if (hoveredSuggestion) {
       if (!hoverTimeoutRef.current) {
         hoverTimeoutRef.current = setTimeout(() => {
           setHoveredSuggestion(null);
           hoverTimeoutRef.current = null;
         }, 400); // 400ms delay to allow moving to tooltip
       }
    }

    // 3. Handle Comments (Simple instant hover)
    if (isOverComment) {
       const id = (isOverComment as HTMLElement).getAttribute('data-comment-id');
       const comment = comments.find(c => c.id === id);
       if (comment) {
         setHoveredComment({ c: comment, rect: (isOverComment as HTMLElement).getBoundingClientRect() });
         setHoveredCommentId(id);
       }
       // Don't show suggestion tooltip if we are hovering a comment
       // (Unless we are already hovering one and moving out, handled above)
    } else {
       setHoveredCommentId(null);
       setHoveredComment(null);
    }
  };

  const handleRewrite = async (quickFeedback?: string) => {
    const targetFeedback = quickFeedback || feedback;
    if (!selection.text || !targetFeedback) return;

    setIsProcessing(true);
    setIsStreaming(true);
    
    let finalContent = content;

    try {
      await rewriteSelectionStream(content, selection.text, targetFeedback, tone, (chunk) => {
        const updatedContent = content.replace(selection.text, chunk);
        onChange(updatedContent);
        finalContent = updatedContent;
      });
      setSelection({ text: '', range: null, rect: null });
      setFeedback('');
      pushToHistory(finalContent, suggestions, comments);
    } catch (e) { console.error("Rewrite failed", e); }
    finally { setIsProcessing(false); setIsStreaming(false); }
  };

  const handleAddComment = () => {
    if (!commentText.trim() || !selection.text) return;
    const newComment: Comment = { id: `c-${Date.now()}`, text: commentText, originalText: selection.text, timestamp: Date.now() };
    const newComments = [...comments, newComment];
    setComments(newComments);
    pushToHistory(content, suggestions, newComments);
    setCommentText('');
    setSelection({ text: '', range: null, rect: null });
    setIsCommenting(false);
  };

  const deleteComment = (id: string) => {
    const newComments = comments.filter(c => c.id !== id);
    setComments(newComments);
    pushToHistory(content, suggestions, newComments);
  };

  const renderTypeIcon = (type: string, size: string = "w-5 h-5") => {
    if (type === 'critique') return <svg className={`${size} text-amber-500`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>;
    if (type === 'grammar') return <svg className={`${size} text-emerald-500`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>;
    return <svg className={`${size} text-blue-500`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>;
  };

  return (
    <div className={`relative flex gap-12 max-w-[1400px] mx-auto py-32 px-12 min-h-screen transition-all duration-700 ${isFlashing ? 'bg-blue-50/50 ring-8 ring-blue-500/10' : ''}`} onMouseMove={handleMouseMove}>
      
      {/* SUGGESTION TOOLTIP */}
      {hoveredSuggestion && (
        <div 
          className="suggestion-tooltip fixed z-[60] glass px-5 py-3.5 rounded-2xl shadow-xl border border-white/50 animate-in fade-in zoom-in duration-200 pointer-events-auto flex flex-col gap-3"
          style={{ top: hoveredSuggestion.rect.top + window.scrollY - 90, left: hoveredSuggestion.rect.left + (hoveredSuggestion.rect.width / 2) - 100, maxWidth: '260px' }}
        >
          <div className="flex items-center gap-2 mb-0.5">{renderTypeIcon(hoveredSuggestion.s.type, "w-3.5 h-3.5")}<span className="text-[9px] font-black uppercase tracking-widest text-blue-600/80">Suggestion</span></div>
          <p className="text-[11px] text-gray-700 font-medium leading-relaxed">{hoveredSuggestion.s.explanation}</p>
          <div className="flex gap-2 pt-2 border-t border-blue-50">
            <button 
              onClick={() => applySuggestion(hoveredSuggestion.s)}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold uppercase tracking-widest py-1.5 rounded-lg transition-colors flex items-center justify-center gap-1.5"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>
              Apply
            </button>
            <button 
              onClick={() => rejectSuggestion(hoveredSuggestion.s)}
              className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-700 text-[10px] font-bold uppercase tracking-widest py-1.5 rounded-lg transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* COMMENT TOOLTIP */}
      {hoveredComment && (
        <div className="fixed z-[60] glass px-5 py-3.5 rounded-2xl shadow-xl border border-amber-200 pointer-events-none animate-in fade-in zoom-in duration-200"
          style={{ top: hoveredComment.rect.top + window.scrollY - 80, left: hoveredComment.rect.left + (hoveredComment.rect.width / 2) - 120, maxWidth: '240px' }}>
          <div className="flex items-center gap-2 mb-1.5">
            <svg className="w-3.5 h-3.5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"></path></svg>
            <span className="text-[9px] font-black uppercase tracking-widest text-amber-600/80">Margin Note</span>
          </div>
          <p className="text-[11px] text-gray-700 font-medium">{hoveredComment.c.text}</p>
        </div>
      )}

      {/* SPELLCHECK POPOVER */}
      {inspectedSpellError && (
        <div id="spellcheck-box" className="fixed z-[60] glass rounded-3xl shadow-2xl p-2 min-w-[180px] animate-in fade-in zoom-in duration-200 border border-red-100"
          style={{ top: inspectedSpellError.rect.bottom + window.scrollY + 10, left: inspectedSpellError.rect.left + (inspectedSpellError.rect.width / 2) - 90 }}>
          <div className="px-4 py-2 mb-1 border-b border-gray-100 flex items-center justify-between">
            <span className="text-[8px] font-black uppercase tracking-widest text-red-500">Correct Spelling</span>
            <button onClick={() => setInspectedSpellError(null)} className="text-gray-300 hover:text-gray-500"><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"></path></svg></button>
          </div>
          <div className="flex flex-col gap-1">
            {inspectedSpellError.err.corrections.length > 0 ? (
              inspectedSpellError.err.corrections.map(c => (
                <button 
                  key={c} 
                  onClick={() => applyCorrection(inspectedSpellError.err.id, c)}
                  className="w-full text-left px-4 py-2.5 rounded-2xl hover:bg-red-50 text-sm font-semibold text-gray-800 transition-colors flex items-center justify-between group"
                >
                  {c}
                  <svg className="w-3 h-3 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7"></path></svg>
                </button>
              ))
            ) : (
              <div className="px-4 py-3 text-xs text-gray-400 italic">No suggestions found</div>
            )}
            <div className="border-t border-gray-100 mt-1 pt-1">
               <button 
                onClick={() => setInspectedSpellError(null)}
                className="w-full text-left px-4 py-2.5 rounded-2xl hover:bg-gray-50 text-[10px] font-bold text-gray-400 uppercase tracking-widest transition-colors"
               >
                 Ignore All
               </button>
            </div>
          </div>
        </div>
      )}

      {/* EDITOR MAIN AREA */}
      <div className="flex-1 relative group">
        <div
          ref={editorRef}
          contentEditable
          spellCheck={false}
          onMouseUp={handleMouseUp}
          onClick={handleEditorClick}
          onInput={handleInput}
          className={`w-full min-h-[80vh] text-xl md:text-2xl leading-[2.1] text-gray-900 font-serif whitespace-pre-wrap outline-none transition-opacity duration-700 ${isStreaming ? 'opacity-80' : 'opacity-100'}`}
          dangerouslySetInnerHTML={{ __html: highlightedContent }}
        />
        {!content && !isProcessing && (
          <div className="absolute top-0 pointer-events-none text-gray-300 text-xl md:text-2xl font-serif leading-[2.1]">Start writing or use the Collaborator to generate a draft...</div>
        )}
      </div>

      {/* DEDICATED SIDEBAR PANEL FOR COMMENTS */}
      {comments.length > 0 && showMarginNotes && (
        <aside className="w-80 h-fit sticky top-32 transition-all shrink-0">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-400">Margin Notes</h3>
            <span className="bg-amber-100 text-amber-700 text-[9px] font-bold px-2 py-0.5 rounded-full">{comments.length}</span>
          </div>
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2 custom-scrollbar">
            {comments.map(c => (
              <div 
                key={c.id} 
                className={`glass p-5 rounded-3xl border transition-all relative group/item ${hoveredCommentId === c.id ? 'border-amber-300 shadow-xl bg-amber-50/40' : 'border-gray-100'}`}
                onMouseEnter={() => setHoveredCommentId(c.id)}
                onMouseLeave={() => setHoveredCommentId(null)}
              >
                <div className="flex justify-between items-start mb-2">
                  <p className="text-sm font-semibold text-gray-800 leading-snug">{c.text}</p>
                  <button 
                    onClick={() => deleteComment(c.id)}
                    className="opacity-0 group-hover/item:opacity-100 text-gray-300 hover:text-red-500 transition-all p-1"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>
                  </button>
                </div>
                <p className="text-[10px] text-gray-400 mt-2 italic border-l-2 border-gray-100 pl-2">"{c.originalText}"</p>
                <div className="mt-3 text-[8px] font-black text-gray-300 uppercase tracking-widest">{new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
              </div>
            ))}
          </div>
        </aside>
      )}

      {/* SELECTION POPUP MENU */}
      {selection.rect && (
        <div id="iteration-box" className="fixed z-50 glass rounded-[2.5rem] shadow-2xl p-6 flex flex-col gap-4 animate-in fade-in zoom-in border border-white"
          style={{ top: selection.rect.top + window.scrollY - (isCommenting ? 150 : 220), left: Math.max(20, Math.min(window.innerWidth - 380, selection.rect.left + (selection.rect.width / 2) - 180)), width: '360px' }}>
          {isCommenting ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 mb-1">
                <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                <span className="text-[10px] font-black uppercase tracking-widest text-amber-600">New Margin Note</span>
              </div>
              <input autoFocus value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="What are your thoughts on this section?" className="w-full bg-amber-50/30 border border-amber-100 rounded-2xl py-3 px-4 text-sm outline-none focus:ring-2 ring-amber-200 transition-all" onKeyDown={(e) => e.key === 'Enter' && handleAddComment()} />
              <div className="flex gap-2">
                <button onClick={() => setIsCommenting(false)} className="flex-1 py-2 text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-600 transition-all">Cancel</button>
                <button onClick={handleAddComment} className="flex-[2] bg-amber-500 text-white rounded-xl py-2 text-[10px] font-black uppercase tracking-widest shadow-lg shadow-amber-500/20 active:scale-95 transition-all">Post Note</button>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                {['Vivid', 'Concise', 'Professional', 'Expand'].map(label => (
                  <button key={label} onClick={() => handleRewrite(label)} className="text-[9px] font-black uppercase tracking-widest bg-gray-50 p-2 rounded-xl hover:bg-blue-600 hover:text-white transition-all border border-gray-100">{label}</button>
                ))}
              </div>
              <div className="relative">
                <input value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Custom instructions..." className="w-full bg-white border border-gray-100 rounded-2xl py-3 px-4 text-sm outline-none pr-10 focus:ring-2 ring-blue-100 transition-all" onKeyDown={(e) => e.key === 'Enter' && handleRewrite()} />
                <button onClick={() => handleRewrite()} className="absolute right-2 top-1/2 -translate-y-1/2 text-blue-600 hover:scale-110 transition-all"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M13 7l5 5m0 0l-5 5m5-5H6"></path></svg></button>
              </div>
              <button onClick={() => setIsCommenting(true)} className="flex items-center justify-center gap-2 text-[9px] font-black uppercase text-amber-600 text-center py-2 hover:bg-amber-50 rounded-xl transition-all">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"></path></svg>
                Add Margin Note
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default Editor;
