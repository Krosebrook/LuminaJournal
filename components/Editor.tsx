
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
// Fixed: Removed non-existent import getSpellingCorrections
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
  
  const [selection, setSelection] = useState<{ text: string; range: Range | null; rect: DOMRect | null }>({ text: '', range: null, rect: null });
  const [feedback, setFeedback] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [spellErrors, setSpellErrors] = useState<SpellError[]>([]);
  const [isSpellcheckEnabled, setIsSpellcheckEnabled] = useState(false);
  const [isFlashing, setIsFlashing] = useState(false);
  const [isCommenting, setIsCommenting] = useState(false);
  const [commentText, setCommentText] = useState('');
  
  const [hoveredSuggestion, setHoveredSuggestion] = useState<{ s: Suggestion, rect: DOMRect } | null>(null);
  const [hoveredCommentId, setHoveredCommentId] = useState<string | null>(null);
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
      const replacement = `
        <span class="ai-suggestion" data-suggestion-id="${s.id}">
          ${s.originalText}<span class="quick-accept-trigger" data-quick-accept="${s.id}" contenteditable="false" title="Accept Suggestion">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" style="width:10px;height:10px;"><polyline points="20 6 9 17 4 12"></polyline></svg>
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
      // If AI is streaming OR editor is NOT focused, force update the DOM
      const isFocused = document.activeElement === editorRef.current;
      if (isProcessing || !isFocused) {
        editorRef.current.innerHTML = highlightedContent;
      }
    }
    isInternalUpdate.current = false;
  }, [highlightedContent, isProcessing]);

  const handleMagicApplyAll = useCallback(() => {
    if (suggestions.length === 0) return;
    setIsFlashing(true);
    onApplyAll();
    setTimeout(() => setIsFlashing(false), 1200);
  }, [suggestions.length, onApplyAll]);

  const handleInput = (e: React.FormEvent<HTMLDivElement>) => {
    const newText = e.currentTarget.innerText;
    isInternalUpdate.current = true; // Mark as user-initiated update
    onChange(newText);
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
      pushToHistory(newContent, newSuggestions, comments);
    }
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
      if (!document.activeElement?.closest('#iteration-box')) {
        setSelection({ text: '', range: null, rect: null });
        setIsCommenting(false);
      }
    }
  }, []);

  const handleEditorClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
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
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const suggestionSpan = target.closest('.ai-suggestion') as HTMLElement;
    const commentSpan = target.closest('.user-comment') as HTMLElement;
    
    if (suggestionSpan) {
      const id = suggestionSpan.getAttribute('data-suggestion-id');
      const suggestion = suggestions.find(s => s.id === id);
      if (suggestion) setHoveredSuggestion({ s: suggestion, rect: suggestionSpan.getBoundingClientRect() });
      setHoveredCommentId(null);
    } else if (commentSpan) {
      setHoveredCommentId(commentSpan.getAttribute('data-comment-id'));
      setHoveredSuggestion(null);
    } else {
      setHoveredSuggestion(null);
      setHoveredCommentId(null);
    }
  };

  const handleRewrite = async (quickFeedback?: string) => {
    const targetFeedback = quickFeedback || feedback;
    if (!selection.text || !targetFeedback) return;

    setIsProcessing(true);
    setIsStreaming(true);
    
    try {
      let currentRewrite = "";
      await rewriteSelectionStream(content, selection.text, targetFeedback, tone, (chunk) => {
        currentRewrite = chunk;
        const updatedContent = content.replace(selection.text, currentRewrite);
        onChange(updatedContent);
      });
      setSelection({ text: '', range: null, rect: null });
      setFeedback('');
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

  const renderTypeIcon = (type: string, size: string = "w-5 h-5") => {
    if (type === 'critique') return <svg className={`${size} text-amber-500`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>;
    if (type === 'grammar') return <svg className={`${size} text-emerald-500`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>;
    return <svg className={`${size} text-blue-500`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>;
  };

  return (
    <div className={`relative flex gap-12 max-w-[1400px] mx-auto py-32 px-12 min-h-screen transition-all duration-700 ${isFlashing ? 'bg-blue-50/50 ring-8 ring-blue-500/10' : ''}`} onMouseMove={handleMouseMove}>
      
      {/* TOOLTIPS */}
      {hoveredSuggestion && (
        <div className="fixed z-[60] glass px-5 py-3.5 rounded-2xl shadow-xl border border-white/50 pointer-events-none animate-in fade-in zoom-in duration-200"
          style={{ top: hoveredSuggestion.rect.top + window.scrollY - 70, left: hoveredSuggestion.rect.left + (hoveredSuggestion.rect.width / 2) - 100, maxWidth: '240px' }}>
          <div className="flex items-center gap-2 mb-1.5">{renderTypeIcon(hoveredSuggestion.s.type, "w-3.5 h-3.5")}<span className="text-[9px] font-black uppercase tracking-widest text-blue-600/80">Suggestion</span></div>
          <p className="text-[11px] text-gray-700 font-medium">{hoveredSuggestion.s.explanation}</p>
        </div>
      )}

      {/* EDITOR */}
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

      {/* SIDEBARS & MENUS */}
      {comments.length > 0 && showMarginNotes && (
        <aside className="w-80 h-fit sticky top-32 transition-all">
          <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-400 mb-6">Margin Notes</h3>
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2 custom-scrollbar">
            {comments.map(c => (
              <div key={c.id} className={`glass p-5 rounded-3xl border transition-all ${hoveredCommentId === c.id ? 'border-amber-300 shadow-xl' : 'border-gray-100'}`}>
                <p className="text-sm font-medium text-gray-800">{c.text}</p>
                <p className="text-[10px] text-gray-400 mt-2 italic">"{c.originalText}"</p>
              </div>
            ))}
          </div>
        </aside>
      )}

      {/* SELECTION POPUP */}
      {selection.rect && (
        <div id="iteration-box" className="fixed z-50 glass rounded-[2.5rem] shadow-2xl p-6 flex flex-col gap-4 animate-in fade-in zoom-in border border-white"
          style={{ top: selection.rect.top + window.scrollY - (isCommenting ? 150 : 220), left: Math.max(20, Math.min(window.innerWidth - 380, selection.rect.left + (selection.rect.width / 2) - 180)), width: '360px' }}>
          {isCommenting ? (
            <div className="flex flex-col gap-3">
              <input autoFocus value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="Add a note..." className="w-full bg-amber-50/30 border border-amber-100 rounded-2xl py-3 px-4 text-sm outline-none" onKeyDown={(e) => e.key === 'Enter' && handleAddComment()} />
              <button onClick={handleAddComment} className="bg-amber-500 text-white rounded-xl py-2 text-xs font-black uppercase tracking-widest">Post Note</button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                {['Vivid', 'Concise', 'Professional', 'Expand'].map(label => (
                  <button key={label} onClick={() => handleRewrite(label)} className="text-[9px] font-black uppercase tracking-widest bg-gray-50 p-2 rounded-xl hover:bg-blue-600 hover:text-white transition-all border border-gray-100">{label}</button>
                ))}
              </div>
              <div className="relative">
                <input value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Custom instructions..." className="w-full bg-white border border-gray-100 rounded-2xl py-3 px-4 text-sm outline-none pr-10" onKeyDown={(e) => e.key === 'Enter' && handleRewrite()} />
                <button onClick={() => handleRewrite()} className="absolute right-2 top-1/2 -translate-y-1/2 text-blue-600"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M13 7l5 5m0 0l-5 5m5-5H6"></path></svg></button>
              </div>
              <button onClick={() => setIsCommenting(true)} className="text-[9px] font-black uppercase text-amber-600 text-center">Add Comment Instead</button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default Editor;
