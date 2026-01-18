
import React, { useRef, useEffect, useCallback, useMemo, useReducer } from 'react';
import { rewriteSelectionStream, getProactiveSuggestions, generateSceneImage, generateSpeech } from '../services/geminiService';
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

// --- REDUCER STATE MANAGEMENT ---

interface EditorState {
  selection: { text: string; range: Range | null; rect: DOMRect | null };
  feedback: string;
  isStreaming: boolean;
  spellErrors: SpellError[];
  isSpellcheckEnabled: boolean;
  isFlashing: boolean;
  isCommenting: boolean;
  commentText: string;
  hoveredSuggestion: { s: Suggestion, rect: DOMRect } | null;
  hoveredComment: { c: Comment, rect: DOMRect } | null;
  hoveredCommentId: string | null;
  inspectedSpellError: { err: SpellError, rect: DOMRect } | null;
  showMarginNotes: boolean;
  generatedImage: string | null;
  isPlayingAudio: boolean;
}

type EditorAction =
  | { type: 'SET_SELECTION'; payload: { text: string; range: Range | null; rect: DOMRect | null } }
  | { type: 'SET_FEEDBACK'; payload: string }
  | { type: 'SET_STREAMING'; payload: boolean }
  | { type: 'SET_SPELL_ERRORS'; payload: SpellError[] }
  | { type: 'SET_FLASHING'; payload: boolean }
  | { type: 'SET_COMMENTING'; payload: boolean }
  | { type: 'SET_COMMENT_TEXT'; payload: string }
  | { type: 'SET_HOVER_SUGGESTION'; payload: { s: Suggestion, rect: DOMRect } | null }
  | { type: 'SET_HOVER_COMMENT'; payload: { c: Comment, rect: DOMRect } | null }
  | { type: 'SET_HOVER_COMMENT_ID'; payload: string | null }
  | { type: 'SET_INSPECTED_ERROR'; payload: { err: SpellError, rect: DOMRect } | null }
  | { type: 'SET_GENERATED_IMAGE'; payload: string | null }
  | { type: 'SET_PLAYING_AUDIO'; payload: boolean }
  | { type: 'RESET_SELECTION' };

const initialState: EditorState = {
  selection: { text: '', range: null, rect: null },
  feedback: '',
  isStreaming: false,
  spellErrors: [
    { id: 'se-1', word: 'biographry', corrections: ['biography', 'biographies'] },
    { id: 'se-2', word: 'memoire', corrections: ['memoir', 'memoirs'] },
    { id: 'se-3', word: 'autobiograpy', corrections: ['autobiography'] }
  ],
  isSpellcheckEnabled: true,
  isFlashing: false,
  isCommenting: false,
  commentText: '',
  hoveredSuggestion: null,
  hoveredComment: null,
  hoveredCommentId: null,
  inspectedSpellError: null,
  showMarginNotes: true,
  generatedImage: null,
  isPlayingAudio: false,
};

function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'SET_SELECTION': return { ...state, selection: action.payload };
    case 'SET_FEEDBACK': return { ...state, feedback: action.payload };
    case 'SET_STREAMING': return { ...state, isStreaming: action.payload };
    case 'SET_SPELL_ERRORS': return { ...state, spellErrors: action.payload };
    case 'SET_FLASHING': return { ...state, isFlashing: action.payload };
    case 'SET_COMMENTING': return { ...state, isCommenting: action.payload };
    case 'SET_COMMENT_TEXT': return { ...state, commentText: action.payload };
    case 'SET_HOVER_SUGGESTION': return { ...state, hoveredSuggestion: action.payload };
    case 'SET_HOVER_COMMENT': return { ...state, hoveredComment: action.payload };
    case 'SET_HOVER_COMMENT_ID': return { ...state, hoveredCommentId: action.payload };
    case 'SET_INSPECTED_ERROR': return { ...state, inspectedSpellError: action.payload };
    case 'SET_GENERATED_IMAGE': return { ...state, generatedImage: action.payload };
    case 'SET_PLAYING_AUDIO': return { ...state, isPlayingAudio: action.payload };
    case 'RESET_SELECTION': return { 
      ...state, 
      selection: { text: '', range: null, rect: null }, 
      isCommenting: false, 
      commentText: '',
      inspectedSpellError: null 
    };
    default: return state;
  }
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
  const [state, dispatch] = useReducer(editorReducer, initialState);
  const editorRef = useRef<HTMLDivElement>(null);
  const isInternalUpdate = useRef(false);
  const hoverTimeoutRef = useRef<any>(null);

  // Synchronize internal state with DOM
  const highlightedContent = useMemo(() => {
    if (!content) return '';
    let html = content;

    if (state.isSpellcheckEnabled) {
      state.spellErrors.forEach((err) => {
        const escaped = err.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        html = html.replace(new RegExp(`\\b${escaped}\\b`, 'g'), `<span class="spell-error" data-error-id="${err.id}">${err.word}</span>`);
      });
    }

    suggestions.forEach((s) => {
      const escaped = s.originalText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Refined Quick Accept: Uses Tailwind for transitions and proper sizing
      const replacement = `
        <span class="ai-suggestion group/suggestion" data-suggestion-id="${s.id}">
          ${s.originalText}<span class="quick-accept-trigger hidden md:inline-flex items-center justify-center w-5 h-5 ml-1 -mt-1 bg-emerald-500 text-white rounded-full shadow-sm transform scale-0 opacity-0 group-hover/suggestion:scale-100 group-hover/suggestion:opacity-100 transition-all duration-300 cursor-pointer hover:bg-emerald-600 hover:shadow-md hover:scale-110 z-10" data-quick-accept="${s.id}" contenteditable="false" title="Quick Accept">
            <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
          </span>
        </span>`.trim();
      html = html.replace(new RegExp(escaped, 'g'), replacement);
    });

    comments.forEach((c) => {
      const escaped = c.originalText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const isHovered = state.hoveredCommentId === c.id;
      const replacement = `<span class="user-comment ${isHovered ? 'ring-2 ring-amber-400/50 bg-amber-100/50' : ''}" data-comment-id="${c.id}">${c.originalText}</span>`;
      html = html.replace(new RegExp(escaped, 'g'), replacement);
    });

    return html;
  }, [content, suggestions, state.spellErrors, state.isSpellcheckEnabled, comments, state.hoveredCommentId]);

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
    dispatch({ type: 'SET_FLASHING', payload: true });
    
    // Apply all suggestions locally
    let newContent = content;
    suggestions.forEach(s => {
      newContent = newContent.replace(s.originalText, s.suggestedText);
    });
    
    onChange(newContent);
    setSuggestions([]);
    pushToHistory(newContent, [], comments);
    onApplyAll(); // Notify parent if needed

    setTimeout(() => dispatch({ type: 'SET_FLASHING', payload: false }), 1200);
  }, [suggestions, content, onChange, setSuggestions, pushToHistory, onApplyAll, comments]);

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
      dispatch({ type: 'SET_HOVER_SUGGESTION', payload: null });
      pushToHistory(newContent, newSuggestions, comments);
    }
  }, [content, suggestions, comments, onChange, setSuggestions, pushToHistory]);

  const rejectSuggestion = useCallback((s: Suggestion) => {
    const newSuggestions = suggestions.filter(x => x.id !== s.id);
    setSuggestions(newSuggestions);
    dispatch({ type: 'SET_HOVER_SUGGESTION', payload: null });
    pushToHistory(content, newSuggestions, comments);
  }, [suggestions, setSuggestions, content, comments, pushToHistory]);

  const applyCorrection = (errorId: string, correction: string) => {
    const err = state.spellErrors.find(e => e.id === errorId);
    if (!err) return;
    const newContent = content.replace(new RegExp(`\\b${err.word}\\b`, 'g'), correction);
    const newErrors = state.spellErrors.filter(e => e.id !== errorId);
    onChange(newContent);
    dispatch({ type: 'SET_SPELL_ERRORS', payload: newErrors });
    dispatch({ type: 'SET_INSPECTED_ERROR', payload: null });
    pushToHistory(newContent, suggestions, comments);
  };

  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 0) {
      const range = sel.getRangeAt(0);
      dispatch({
        type: 'SET_SELECTION',
        payload: {
          text: sel.toString(),
          range: range.cloneRange(),
          rect: range.getBoundingClientRect()
        }
      });
      dispatch({ type: 'SET_COMMENTING', payload: false });
      dispatch({ type: 'SET_INSPECTED_ERROR', payload: null });
    } else {
      if (!document.activeElement?.closest('#iteration-box') && !document.activeElement?.closest('#spellcheck-box')) {
        dispatch({ type: 'RESET_SELECTION' });
      }
    }
  }, []);

  const handleContextMenu = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const spellErrorSpan = target.closest('.spell-error') as HTMLElement;
    
    if (spellErrorSpan) {
      e.preventDefault();
      const id = spellErrorSpan.getAttribute('data-error-id');
      const err = state.spellErrors.find(e => e.id === id);
      if (err) {
        dispatch({ type: 'SET_INSPECTED_ERROR', payload: { err, rect: spellErrorSpan.getBoundingClientRect() } });
        dispatch({ type: 'RESET_SELECTION' });
      }
    }
  };

  const handleEditorClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    
    // Quick Accept Trigger logic remains on left click
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
        dispatch({ type: 'SET_HOVER_SUGGESTION', payload: { s: suggestion, rect: suggestionSpan.getBoundingClientRect() } });
      }
      return;
    }

    dispatch({ type: 'SET_INSPECTED_ERROR', payload: null });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const isOverTooltip = target.closest('.suggestion-tooltip');
    const isOverSuggestion = target.closest('.ai-suggestion');
    const isOverComment = target.closest('.user-comment');

    if (isOverTooltip || isOverSuggestion) {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = null;
      }
    }

    if (isOverSuggestion) {
      const id = (isOverSuggestion as HTMLElement).getAttribute('data-suggestion-id');
      if (state.hoveredSuggestion?.s.id !== id) {
         const suggestion = suggestions.find(s => s.id === id);
         if (suggestion) {
           dispatch({ type: 'SET_HOVER_SUGGESTION', payload: { s: suggestion, rect: (isOverSuggestion as HTMLElement).getBoundingClientRect() } });
         }
      }
      dispatch({ type: 'SET_HOVER_COMMENT_ID', payload: null });
      dispatch({ type: 'SET_HOVER_COMMENT', payload: null });
      return; 
    }

    if (isOverTooltip) {
      dispatch({ type: 'SET_HOVER_COMMENT_ID', payload: null });
      dispatch({ type: 'SET_HOVER_COMMENT', payload: null });
      return;
    }

    if (state.hoveredSuggestion) {
       if (!hoverTimeoutRef.current) {
         hoverTimeoutRef.current = setTimeout(() => {
           dispatch({ type: 'SET_HOVER_SUGGESTION', payload: null });
           hoverTimeoutRef.current = null;
         }, 300); 
       }
    }

    if (isOverComment) {
       const id = (isOverComment as HTMLElement).getAttribute('data-comment-id');
       const comment = comments.find(c => c.id === id);
       if (comment) {
         dispatch({ type: 'SET_HOVER_COMMENT', payload: { c: comment, rect: (isOverComment as HTMLElement).getBoundingClientRect() } });
         dispatch({ type: 'SET_HOVER_COMMENT_ID', payload: id });
       }
    } else {
       dispatch({ type: 'SET_HOVER_COMMENT_ID', payload: null });
       dispatch({ type: 'SET_HOVER_COMMENT', payload: null });
    }
  };

  const handleRewrite = async (quickFeedback?: string) => {
    const targetFeedback = quickFeedback || state.feedback;
    if (!state.selection.text || !targetFeedback) return;

    setIsProcessing(true);
    dispatch({ type: 'SET_STREAMING', payload: true });
    
    let finalContent = content;

    try {
      await rewriteSelectionStream(content, state.selection.text, targetFeedback, tone, (chunk) => {
        const updatedContent = content.replace(state.selection.text, chunk);
        onChange(updatedContent);
        finalContent = updatedContent;
      });
      dispatch({ type: 'RESET_SELECTION' });
      dispatch({ type: 'SET_FEEDBACK', payload: '' });
      pushToHistory(finalContent, suggestions, comments);
    } catch (e) { console.error("Rewrite failed", e); }
    finally { setIsProcessing(false); dispatch({ type: 'SET_STREAMING', payload: false }); }
  };

  const handleAddComment = () => {
    if (!state.commentText.trim() || !state.selection.text) return;
    const newComment: Comment = { id: `c-${Date.now()}`, text: state.commentText, originalText: state.selection.text, timestamp: Date.now() };
    const newComments = [...comments, newComment];
    setComments(newComments);
    pushToHistory(content, suggestions, newComments);
    dispatch({ type: 'RESET_SELECTION' });
  };

  const deleteComment = (id: string) => {
    const newComments = comments.filter(c => c.id !== id);
    setComments(newComments);
    pushToHistory(content, suggestions, newComments);
  };

  const scrollToComment = (id: string) => {
    const el = editorRef.current?.querySelector(`span[data-comment-id="${id}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      dispatch({ type: 'SET_HOVER_COMMENT_ID', payload: id });
    }
  };

  // --- NEW FEATURES ---

  const handleVisualize = async () => {
    if (!state.selection.text) return;
    setIsProcessing(true);
    // Use default Pro Image Gen settings: 16:9, 1K for quick inline
    const base64Image = await generateSceneImage(state.selection.text, "16:9", "1K");
    setIsProcessing(false);
    if (base64Image) {
      dispatch({ type: 'SET_GENERATED_IMAGE', payload: `data:image/png;base64,${base64Image}` });
    }
  };

  const handleReadAloud = async () => {
    if (!state.selection.text) return;
    dispatch({ type: 'SET_PLAYING_AUDIO', payload: true });
    const audioBuffer = await generateSpeech(state.selection.text);
    if (audioBuffer) {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioCtx.createBufferSource();
      const decoded = await audioCtx.decodeAudioData(audioBuffer);
      source.buffer = decoded;
      source.connect(audioCtx.destination);
      source.onended = () => dispatch({ type: 'SET_PLAYING_AUDIO', payload: false });
      source.start(0);
    } else {
      dispatch({ type: 'SET_PLAYING_AUDIO', payload: false });
    }
  };

  const renderTypeIcon = (type: string, size: string = "w-5 h-5") => {
    if (type === 'critique') return <svg className={`${size} text-amber-500`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>;
    if (type === 'grammar') return <svg className={`${size} text-emerald-500`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>;
    return <svg className={`${size} text-blue-500`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>;
  };

  return (
    <div className={`relative flex gap-12 max-w-[1400px] mx-auto py-32 px-12 min-h-screen transition-all duration-700 ${state.isFlashing ? 'bg-blue-50/50 ring-8 ring-blue-500/10' : ''}`} onMouseMove={handleMouseMove}>
      
      {/* Accept All Button - Visible when suggestions exist */}
      {suggestions.length > 0 && (
        <button
          onClick={handleMagicApplyAll}
          className="fixed bottom-12 right-12 z-50 bg-emerald-600 hover:bg-emerald-500 text-white shadow-xl hover:shadow-2xl hover:scale-105 active:scale-95 transition-all rounded-full px-6 py-4 flex items-center gap-3 animate-in slide-in-from-bottom-6 duration-300"
        >
          <div className="bg-white/20 p-1.5 rounded-full">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7"></path></svg>
          </div>
          <div className="text-left">
            <div className="text-[10px] uppercase font-black tracking-widest opacity-80">One-Click</div>
            <div className="text-sm font-bold">Accept {suggestions.length} Suggestions</div>
          </div>
        </button>
      )}

      {/* GENERATED IMAGE MODAL */}
      {state.generatedImage && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md animate-in fade-in" onClick={() => dispatch({ type: 'SET_GENERATED_IMAGE', payload: null })}>
          <div className="relative max-w-4xl max-h-[90vh] p-2 bg-white rounded-xl shadow-2xl" onClick={e => e.stopPropagation()}>
            <img src={state.generatedImage} alt="Visualized Scene" className="rounded-lg max-h-[85vh] object-contain" />
            <button onClick={() => dispatch({ type: 'SET_GENERATED_IMAGE', payload: null })} className="absolute top-4 right-4 bg-white/20 hover:bg-white/40 rounded-full p-2 text-white"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
            <div className="absolute bottom-4 left-4 right-4 text-center">
              <a href={state.generatedImage} download="lumina-scene.png" className="inline-block bg-white text-black px-6 py-2 rounded-full text-xs font-bold uppercase tracking-widest shadow-lg hover:scale-105 transition-transform">Save Image</a>
            </div>
          </div>
        </div>
      )}

      {/* SUGGESTION TOOLTIP */}
      {state.hoveredSuggestion && (
        <div 
          className="suggestion-tooltip fixed z-[60] glass px-6 py-5 rounded-[1.5rem] shadow-2xl border border-white/60 animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-300 pointer-events-auto flex flex-col gap-4 ring-1 ring-blue-900/5 backdrop-blur-xl"
          style={{ 
            top: state.hoveredSuggestion.rect.bottom + window.scrollY + 8, // Position below
            left: state.hoveredSuggestion.rect.left + (state.hoveredSuggestion.rect.width / 2) - 140, 
            width: '280px' 
          }}
        >
          <div className="flex items-center justify-between border-b border-gray-100 pb-3">
             <div className="flex items-center gap-2.5">
               <div className="w-6 h-6 rounded-full bg-blue-50 flex items-center justify-center text-blue-600">
                 {renderTypeIcon(state.hoveredSuggestion.s.type, "w-3.5 h-3.5")}
               </div>
               <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Lumina Suggestion</span>
             </div>
             <button onClick={() => dispatch({ type: 'SET_HOVER_SUGGESTION', payload: null })} className="text-gray-300 hover:text-gray-500 transition-colors p-1 hover:bg-gray-100 rounded-lg">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>
             </button>
          </div>

          <div className="space-y-3">
             <p className="text-sm text-gray-600 leading-relaxed font-medium">
               {state.hoveredSuggestion.s.explanation}
             </p>
             
             <div className="bg-emerald-50/50 rounded-xl p-3 border border-emerald-100/50">
               <div className="flex items-center gap-2 mb-1">
                 <span className="text-[9px] font-black uppercase tracking-widest text-emerald-600/70">Change To:</span>
               </div>
               <p className="text-sm font-semibold text-gray-900">{state.hoveredSuggestion.s.suggestedText}</p>
             </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button 
              onClick={() => applySuggestion(state.hoveredSuggestion!.s)}
              className="flex-1 bg-black text-white hover:bg-gray-800 text-[10px] font-black uppercase tracking-widest py-2.5 rounded-xl transition-all shadow-lg shadow-black/10 active:scale-95 flex items-center justify-center gap-2"
            >
              <span>Accept Change</span>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>
            </button>
            <button 
              onClick={() => rejectSuggestion(state.hoveredSuggestion!.s)}
              className="px-4 bg-white border border-gray-200 hover:bg-gray-50 text-gray-400 hover:text-red-500 text-[10px] font-black uppercase tracking-widest py-2.5 rounded-xl transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* COMMENT TOOLTIP */}
      {state.hoveredComment && (
        <div className="fixed z-[60] glass px-5 py-3.5 rounded-2xl shadow-xl border border-amber-200 pointer-events-none animate-in fade-in zoom-in duration-200"
          style={{ top: state.hoveredComment.rect.top + window.scrollY - 80, left: state.hoveredComment.rect.left + (state.hoveredComment.rect.width / 2) - 120, maxWidth: '240px' }}>
          <div className="flex items-center gap-2 mb-1.5">
            <svg className="w-3.5 h-3.5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"></path></svg>
            <span className="text-[9px] font-black uppercase tracking-widest text-amber-600/80">Margin Note</span>
          </div>
          <p className="text-[11px] text-gray-700 font-medium">{state.hoveredComment.c.text}</p>
        </div>
      )}

      {/* SPELLCHECK POPOVER */}
      {state.inspectedSpellError && (
        <div id="spellcheck-box" className="fixed z-[60] glass rounded-[1.5rem] shadow-2xl p-0 min-w-[200px] animate-in fade-in zoom-in duration-200 border border-red-100/50 overflow-hidden ring-4 ring-red-50/50"
          style={{ top: state.inspectedSpellError.rect.bottom + window.scrollY + 8, left: state.inspectedSpellError.rect.left + (state.inspectedSpellError.rect.width / 2) - 100 }}>
          <div className="px-4 py-2.5 bg-red-50/50 border-b border-red-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
                 <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></div>
                 <span className="text-[9px] font-black uppercase tracking-widest text-red-600/80">Spelling</span>
            </div>
            <button onClick={() => dispatch({ type: 'SET_INSPECTED_ERROR', payload: null })} className="text-red-300 hover:text-red-500 transition-colors"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"></path></svg></button>
          </div>
          <div className="p-2 flex flex-col gap-1">
             {/* Suggestions List */}
             {state.inspectedSpellError.err.corrections.length > 0 ? (
                state.inspectedSpellError.err.corrections.map(c => (
                    <button 
                      key={c} 
                      onClick={() => applyCorrection(state.inspectedSpellError!.err.id, c)}
                      className="w-full text-left px-3 py-2 rounded-xl hover:bg-red-50 text-sm font-semibold text-gray-800 transition-all flex items-center justify-between group"
                    >
                      {c}
                      <span className="opacity-0 group-hover:opacity-100 text-[9px] font-black text-red-400 uppercase tracking-wider">Fix</span>
                    </button>
                ))
             ) : (
                <div className="px-3 py-4 text-center text-xs text-gray-400 italic">No suggestions found</div>
             )}
             
             <div className="h-px bg-gray-100 my-1 mx-2"></div>
             
             <button 
                onClick={() => dispatch({ type: 'SET_INSPECTED_ERROR', payload: null })}
                className="w-full text-left px-3 py-2 rounded-xl hover:bg-gray-50 text-[10px] font-bold text-gray-400 uppercase tracking-widest transition-colors flex items-center gap-2"
             >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"></path></svg>
                Ignore
             </button>
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
          onContextMenu={handleContextMenu}
          onInput={handleInput}
          className={`w-full min-h-[80vh] text-xl md:text-2xl leading-[2.1] text-gray-900 font-serif whitespace-pre-wrap outline-none transition-opacity duration-700 ${state.isStreaming ? 'opacity-80' : 'opacity-100'}`}
          dangerouslySetInnerHTML={{ __html: highlightedContent }}
        />
        {!content && !isProcessing && (
          <div className="absolute top-0 pointer-events-none text-gray-300 text-xl md:text-2xl font-serif leading-[2.1]">Start writing or use the Collaborator to generate a draft...</div>
        )}
      </div>

      {/* DEDICATED SIDEBAR PANEL FOR COMMENTS */}
      {comments.length > 0 && state.showMarginNotes && (
        <aside className="hidden lg:block w-80 h-fit sticky top-32 transition-all shrink-0 ml-4 animate-in fade-in slide-in-from-right-8 duration-500">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-400">Margin Notes</h3>
            <span className="bg-amber-100 text-amber-700 text-[9px] font-bold px-2 py-0.5 rounded-full">{comments.length}</span>
          </div>
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2 custom-scrollbar">
            {comments.map(c => (
              <div 
                key={c.id} 
                onClick={() => scrollToComment(c.id)}
                className={`glass p-5 rounded-3xl border transition-all relative group/item cursor-pointer ${state.hoveredCommentId === c.id ? 'border-amber-300 shadow-xl bg-amber-50/40 scale-[1.02]' : 'border-gray-100 hover:border-amber-200'}`}
                onMouseEnter={() => dispatch({ type: 'SET_HOVER_COMMENT_ID', payload: c.id })}
                onMouseLeave={() => dispatch({ type: 'SET_HOVER_COMMENT_ID', payload: null })}
              >
                <div className="flex justify-between items-start mb-2">
                  <p className="text-sm font-semibold text-gray-800 leading-snug">{c.text}</p>
                  <button 
                    onClick={(e) => { e.stopPropagation(); deleteComment(c.id); }}
                    className="opacity-0 group-hover/item:opacity-100 text-gray-300 hover:text-emerald-500 transition-all p-1"
                    title="Resolve Note"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7"></path></svg>
                  </button>
                </div>
                <p className="text-[10px] text-gray-400 mt-2 italic border-l-2 border-gray-100 pl-2 line-clamp-2">"{c.originalText}"</p>
                <div className="mt-3 text-[8px] font-black text-gray-300 uppercase tracking-widest">{new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
              </div>
            ))}
          </div>
        </aside>
      )}

      {/* SELECTION POPUP MENU */}
      {state.selection.rect && (
        <div id="iteration-box" className="fixed z-50 glass rounded-[2rem] shadow-2xl p-5 flex flex-col gap-3 animate-in fade-in zoom-in-95 border border-white/60 backdrop-blur-xl ring-1 ring-gray-900/5"
          style={{ 
            top: state.selection.rect.top + window.scrollY - (state.isCommenting ? 220 : 280),
            left: Math.max(20, Math.min(window.innerWidth - 340, state.selection.rect.left + (state.selection.rect.width / 2) - 160)), 
            width: '320px',
            transformOrigin: 'bottom center'
          }}>
          {state.isCommenting ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-amber-100 pb-2">
                <div className="flex items-center gap-2">
                    <div className="w-5 h-5 bg-amber-100 rounded-full flex items-center justify-center">
                        <svg className="w-3 h-3 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path></svg>
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-amber-600/70">Margin Note</span>
                </div>
                <button onClick={() => dispatch({ type: 'SET_COMMENTING', payload: false })} className="text-gray-300 hover:text-gray-500"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
              </div>
              <textarea autoFocus value={state.commentText} onChange={(e) => dispatch({ type: 'SET_COMMENT_TEXT', payload: e.target.value })} placeholder="What are your thoughts on this section?" className="w-full h-24 bg-amber-50/50 border border-amber-100 rounded-xl p-3 text-sm outline-none focus:ring-2 ring-amber-200 transition-all resize-none placeholder:text-amber-800/30 text-gray-800" onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleAddComment())} />
              <div className="flex justify-end gap-2">
                <button onClick={() => dispatch({ type: 'SET_COMMENTING', payload: false })} className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-600 transition-all hover:bg-gray-50 rounded-lg">Cancel</button>
                <button onClick={handleAddComment} disabled={!state.commentText.trim()} className="bg-amber-500 hover:bg-amber-600 text-white rounded-xl px-5 py-2 text-[10px] font-black uppercase tracking-widest shadow-lg shadow-amber-500/20 active:scale-95 transition-all disabled:opacity-50">Post Note</button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                  <div className="flex items-center gap-2">
                      <div className="w-5 h-5 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center shadow-lg">
                          <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24"><path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
                      </div>
                      <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Lumina Actions</span>
                  </div>
                  <button onClick={() => dispatch({ type: 'RESET_SELECTION' })} className="text-gray-300 hover:text-gray-500"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
              </div>

              {/* Rewrite Grid */}
              <div>
                  <label className="text-[9px] font-bold text-gray-300 uppercase tracking-widest mb-1.5 block ml-1">Refine Style</label>
                  <div className="grid grid-cols-4 gap-1.5">
                      {['Vivid', 'Concise', 'Professional', 'Expand'].map(label => (
                        <button key={label} onClick={() => handleRewrite(label)} className="text-[9px] font-bold bg-white hover:bg-blue-50 text-gray-600 hover:text-blue-600 border border-gray-200 hover:border-blue-200 py-2 rounded-lg transition-all shadow-sm">
                            {label}
                        </button>
                      ))}
                  </div>
              </div>
              
              {/* Multimodal & Tools */}
              <div className="flex gap-2">
                  <button onClick={handleVisualize} disabled={isProcessing} className="flex-1 flex items-center justify-center gap-2 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-100 py-2 rounded-xl transition-all group">
                      <svg className="w-4 h-4 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                      <span className="text-[9px] font-black uppercase tracking-widest">Visualize</span>
                  </button>
                  <button onClick={handleReadAloud} disabled={state.isPlayingAudio} className={`flex-1 flex items-center justify-center gap-2 border py-2 rounded-xl transition-all group ${state.isPlayingAudio ? 'bg-green-100 text-green-700 border-green-200 animate-pulse' : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-100'}`}>
                      <svg className="w-4 h-4 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"></path></svg>
                      <span className="text-[9px] font-black uppercase tracking-widest">{state.isPlayingAudio ? 'Playing...' : 'Read Aloud'}</span>
                  </button>
              </div>

              {/* Custom Input */}
              <div className="relative group/input">
                  <input value={state.feedback} onChange={(e) => dispatch({ type: 'SET_FEEDBACK', payload: e.target.value })} placeholder="Custom instructions..." className="w-full bg-white border border-gray-200 rounded-xl py-2.5 px-3 text-xs outline-none pr-9 focus:ring-2 ring-blue-100 transition-all shadow-inner" onKeyDown={(e) => e.key === 'Enter' && handleRewrite()} />
                  <button onClick={() => handleRewrite()} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 bg-blue-600 text-white rounded-lg opacity-0 group-focus-within/input:opacity-100 transition-all hover:scale-105">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 7l5 5m0 0l-5 5m5-5H6"></path></svg>
                  </button>
              </div>

              {/* Footer Actions */}
              <div className="pt-1 flex justify-end">
                   <button onClick={() => dispatch({ type: 'SET_COMMENTING', payload: true })} className="flex items-center gap-1.5 text-[9px] font-bold text-gray-400 hover:text-amber-500 transition-colors uppercase tracking-widest px-2 py-1 hover:bg-amber-50 rounded-lg">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"></path></svg>
                      Add Note
                  </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Editor;
