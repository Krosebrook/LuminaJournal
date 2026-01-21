
import React, { useRef, useEffect, useCallback, useMemo, useReducer, useState } from 'react';
import { rewriteSelectionStream, getProactiveSuggestions, generateSceneImage, generateSpeech, predictNextSentence, getSensorySynonyms, generateDraftStream, generateDocumentSummary } from '../services/geminiService';
import { Suggestion, WritingTone, Comment, FileAttachment } from '../types';
import { arrayBufferToBase64 } from '../services/audioUtils';

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
  zenMode: boolean;
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
  ghostwriterText: string;
  showGhostwriter: boolean;
  ghostwriterRect: DOMRect | null;
  // Magic Writer State
  showWriter: boolean;
  writerPrompt: string;
  writerFiles: File[];
  writerUseSearch: boolean;
  isWriting: boolean;
  // Summary State
  summary: string;
  showSummary: boolean;
  isGeneratingSummary: boolean;
}

type EditorAction =
  | { type: 'SET_SELECTION'; payload: { text: string; range: Range | null; rect: DOMRect | null } }
  | { type: 'SET_FEEDBACK'; payload: string }
  | { type: 'SET_STREAMING'; payload: boolean }
  | { type: 'SET_SPELL_ERRORS'; payload: SpellError[] }
  | { type: 'SET_SPELLCHECK_ENABLED'; payload: boolean }
  | { type: 'SET_FLASHING'; payload: boolean }
  | { type: 'SET_COMMENTING'; payload: boolean }
  | { type: 'SET_COMMENT_TEXT'; payload: string }
  | { type: 'SET_HOVER_SUGGESTION'; payload: { s: Suggestion, rect: DOMRect } | null }
  | { type: 'SET_HOVER_COMMENT'; payload: { c: Comment, rect: DOMRect } | null }
  | { type: 'SET_HOVER_COMMENT_ID'; payload: string | null }
  | { type: 'SET_INSPECTED_ERROR'; payload: { err: SpellError, rect: DOMRect } | null }
  | { type: 'SET_GENERATED_IMAGE'; payload: string | null }
  | { type: 'SET_PLAYING_AUDIO'; payload: boolean }
  | { type: 'SET_GHOSTWRITER'; payload: { text: string; show: boolean; rect: DOMRect | null } }
  | { type: 'RESET_SELECTION' }
  | { type: 'TOGGLE_WRITER'; payload: boolean }
  | { type: 'SET_WRITER_PROMPT'; payload: string }
  | { type: 'SET_WRITER_FILES'; payload: File[] }
  | { type: 'SET_WRITER_USE_SEARCH'; payload: boolean }
  | { type: 'SET_IS_WRITING'; payload: boolean }
  | { type: 'SET_SUMMARY'; payload: string }
  | { type: 'TOGGLE_SUMMARY'; payload: boolean }
  | { type: 'SET_GENERATING_SUMMARY'; payload: boolean };

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
  ghostwriterText: '',
  showGhostwriter: false,
  ghostwriterRect: null,
  showWriter: false,
  writerPrompt: '',
  writerFiles: [],
  writerUseSearch: false,
  isWriting: false,
  summary: '',
  showSummary: false,
  isGeneratingSummary: false,
};

function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'SET_SELECTION': return { ...state, selection: action.payload };
    case 'SET_FEEDBACK': return { ...state, feedback: action.payload };
    case 'SET_STREAMING': return { ...state, isStreaming: action.payload };
    case 'SET_SPELL_ERRORS': return { ...state, spellErrors: action.payload };
    case 'SET_SPELLCHECK_ENABLED': return { ...state, isSpellcheckEnabled: action.payload };
    case 'SET_FLASHING': return { ...state, isFlashing: action.payload };
    case 'SET_COMMENTING': return { ...state, isCommenting: action.payload };
    case 'SET_COMMENT_TEXT': return { ...state, commentText: action.payload };
    case 'SET_HOVER_SUGGESTION': return { ...state, hoveredSuggestion: action.payload };
    case 'SET_HOVER_COMMENT': return { ...state, hoveredComment: action.payload };
    case 'SET_HOVER_COMMENT_ID': return { ...state, hoveredCommentId: action.payload };
    case 'SET_INSPECTED_ERROR': return { ...state, inspectedSpellError: action.payload };
    case 'SET_GENERATED_IMAGE': return { ...state, generatedImage: action.payload };
    case 'SET_PLAYING_AUDIO': return { ...state, isPlayingAudio: action.payload };
    case 'SET_GHOSTWRITER': return { ...state, ghostwriterText: action.payload.text, showGhostwriter: action.payload.show, ghostwriterRect: action.payload.rect };
    case 'RESET_SELECTION': return { 
      ...state, 
      selection: { text: '', range: null, rect: null }, 
      isCommenting: false, 
      commentText: '',
      inspectedSpellError: null 
    };
    case 'TOGGLE_WRITER': return { ...state, showWriter: action.payload };
    case 'SET_WRITER_PROMPT': return { ...state, writerPrompt: action.payload };
    case 'SET_WRITER_FILES': return { ...state, writerFiles: action.payload };
    case 'SET_WRITER_USE_SEARCH': return { ...state, writerUseSearch: action.payload };
    case 'SET_IS_WRITING': return { ...state, isWriting: action.payload };
    case 'SET_SUMMARY': return { ...state, summary: action.payload };
    case 'TOGGLE_SUMMARY': return { ...state, showSummary: action.payload };
    case 'SET_GENERATING_SUMMARY': return { ...state, isGeneratingSummary: action.payload };
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
  pushToHistory,
  zenMode
}) => {
  const [state, dispatch] = useReducer(editorReducer, initialState);
  const editorRef = useRef<HTMLDivElement>(null);
  const isInternalUpdate = useRef(false);
  const hoverTimeoutRef = useRef<any>(null);
  const idleTimerRef = useRef<any>(null);
  const historyTimeoutRef = useRef<any>(null);

  // Synchronize internal state with DOM
  const highlightedContent = useMemo(() => {
    if (!content) return '';
    let html = content;

    // 1. Apply AI Suggestions Highlighting (Phrases/Sentences - Longest first)
    const sortedSuggestions = [...suggestions].sort((a, b) => b.originalText.length - a.originalText.length);
    sortedSuggestions.forEach((s) => {
      const escaped = s.originalText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      
      let highlightClass = "border-indigo-300/50 bg-indigo-50/30 hover:bg-indigo-100";
      if (s.type === 'grammar') highlightClass = "border-emerald-300/50 bg-emerald-50/30 hover:bg-emerald-100";
      if (s.type === 'critique') highlightClass = "border-amber-300/50 bg-amber-50/30 hover:bg-amber-100";
      if (s.type === 'expansion') highlightClass = "border-purple-300/50 bg-purple-50/30 hover:bg-purple-100";

      const replacement = `
        <span class="ai-suggestion group/suggestion relative border-b-2 transition-colors cursor-pointer rounded-sm px-0.5 ${highlightClass}" data-suggestion-id="${s.id}">
          ${s.originalText}
          <span class="quick-accept-trigger absolute -top-3 -right-2 hidden md:flex items-center justify-center w-5 h-5 bg-gray-900 text-white rounded-full shadow-md transform scale-0 group-hover/suggestion:scale-100 transition-all duration-200 z-10 hover:scale-110" data-quick-accept="${s.id}" contenteditable="false" title="Quick Accept">
            <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
          </span>
        </span>`.trim();
      html = html.replace(new RegExp(escaped, 'g'), replacement);
    });

    // 2. Apply Comments Highlighting
    comments.forEach((c) => {
      const escaped = c.originalText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const isHovered = state.hoveredCommentId === c.id;
      const replacement = `<span class="user-comment group/comment ${isHovered ? 'ring-2 ring-amber-400/50 bg-amber-100/50' : ''}" data-comment-id="${c.id}">${c.originalText}</span>`;
      html = html.replace(new RegExp(escaped, 'g'), replacement);
    });

    // 3. Apply Spellcheck Highlighting
    if (state.isSpellcheckEnabled) {
      state.spellErrors.forEach((err) => {
        const escaped = err.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        html = html.replace(new RegExp(`\\b${escaped}\\b`, 'g'), `<span class="spell-error" data-error-id="${err.id}">${err.word}</span>`);
      });
    }

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
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (historyTimeoutRef.current) clearTimeout(historyTimeoutRef.current);
    };
  }, []);

  // --- LOGIC ---
  const runProactiveScan = useCallback(async () => {
    if (isProcessing || content.length < 50) return;
    setIsProcessing(true);
    dispatch({ type: 'SET_FLASHING', payload: true });
    try {
      const results = await getProactiveSuggestions(content, tone);
      setSuggestions(prev => {
        const existingIds = new Set(prev.map(s => s.originalText));
        const newSuggestions = results
          .filter(r => !existingIds.has(r.originalText) && content.includes(r.originalText))
          .map((r, i) => ({ ...r, id: `s-${Date.now()}-${i}` }));
        return [...prev, ...newSuggestions];
      });
    } catch (e) {
      console.error("Proactive scan failed", e);
    } finally {
      setIsProcessing(false);
      setTimeout(() => dispatch({ type: 'SET_FLASHING', payload: false }), 1000);
    }
  }, [content, tone, isProcessing, setSuggestions, setIsProcessing]);

  const handleGenerateSummary = async () => {
    if (!content.trim()) return;
    dispatch({ type: 'SET_GENERATING_SUMMARY', payload: true });
    dispatch({ type: 'TOGGLE_SUMMARY', payload: true });
    try {
        const summary = await generateDocumentSummary(content);
        dispatch({ type: 'SET_SUMMARY', payload: summary });
    } catch (e) {
        console.error(e);
    } finally {
        dispatch({ type: 'SET_GENERATING_SUMMARY', payload: false });
    }
  };

  // Timer-based proactive scan (less frequent)
  useEffect(() => {
    if (isProcessing || content.length < 50) return;
    const timer = setTimeout(runProactiveScan, 30000); // 30s debounce
    return () => clearTimeout(timer);
  }, [content, runProactiveScan, isProcessing]);


  // --- GHOSTWRITER LOGIC ---
  const triggerGhostwriter = useCallback(async () => {
    if (content.length < 50 || isProcessing || state.showGhostwriter) return;
    
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    
    if (rect.top === 0 && rect.left === 0) return;

    try {
      dispatch({ type: 'SET_GHOSTWRITER', payload: { text: '...', show: true, rect } });
      const completion = await predictNextSentence(content, tone);
      if (completion) {
        dispatch({ type: 'SET_GHOSTWRITER', payload: { text: completion, show: true, rect } });
      } else {
        dispatch({ type: 'SET_GHOSTWRITER', payload: { text: '', show: false, rect: null } });
      }
    } catch (e) {
      dispatch({ type: 'SET_GHOSTWRITER', payload: { text: '', show: false, rect: null } });
    }
  }, [content, tone, isProcessing, state.showGhostwriter]);

  const handleInput = (e: React.FormEvent<HTMLDivElement>) => {
    const newText = e.currentTarget.innerText;
    isInternalUpdate.current = true;
    onChange(newText);
    
    // Debounce history push to group typing events
    if (historyTimeoutRef.current) clearTimeout(historyTimeoutRef.current);
    historyTimeoutRef.current = setTimeout(() => {
        pushToHistory(newText, suggestions, comments);
    }, 1000);
    
    dispatch({ type: 'SET_GHOSTWRITER', payload: { text: '', show: false, rect: null } });
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    
    idleTimerRef.current = setTimeout(triggerGhostwriter, 3500);
  };

  const acceptGhostwriter = useCallback(() => {
    if (!state.ghostwriterText || state.ghostwriterText === '...') return;
    const newContent = content + " " + state.ghostwriterText;
    onChange(newContent);
    pushToHistory(newContent, suggestions, comments);
    dispatch({ type: 'SET_GHOSTWRITER', payload: { text: '', show: false, rect: null } });
  }, [content, state.ghostwriterText, onChange, pushToHistory, suggestions, comments]);

  const handleMagicApplyAll = useCallback(() => {
    if (suggestions.length === 0) return;
    dispatch({ type: 'SET_FLASHING', payload: true });
    
    let newContent = content;
    suggestions.forEach(s => {
      newContent = newContent.replace(s.originalText, s.suggestedText);
    });
    
    onChange(newContent);
    setSuggestions([]);
    pushToHistory(newContent, [], comments);
    onApplyAll(); 

    setTimeout(() => dispatch({ type: 'SET_FLASHING', payload: false }), 1200);
  }, [suggestions, content, onChange, setSuggestions, pushToHistory, onApplyAll, comments]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const cmdKey = navigator.platform.toUpperCase().includes('MAC') ? e.metaKey : e.ctrlKey;
      
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
      
      if (e.key === 'Tab' && state.showGhostwriter) {
        e.preventDefault();
        acceptGhostwriter();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleMagicApplyAll, suggestions.length, undo, redo, state.showGhostwriter, acceptGhostwriter]);

  // --- MAGIC WRITER ---
  const handleWriterSubmit = async () => {
    if (!state.writerPrompt.trim()) return;
    dispatch({ type: 'SET_IS_WRITING', payload: true });
    setIsProcessing(true);

    try {
        const processedAttachments: FileAttachment[] = [];
        for (const file of state.writerFiles) {
            let data = "";
            let type = file.type;
            if (file.type.startsWith('text/') || file.name.match(/\.(md|json|csv|xml|js|ts|tsx|txt)$/i)) {
               data = await file.text();
               type = 'text/plain'; // Treat code/text as text
            } else {
               const buffer = await file.arrayBuffer();
               data = arrayBufferToBase64(buffer);
            }
            processedAttachments.push({ name: file.name, type, data });
        }

        let generatedText = "";
        await generateDraftStream(
            state.writerPrompt,
            processedAttachments,
            tone,
            (chunk) => { generatedText = chunk; },
            undefined,
            false,
            state.writerUseSearch // Pass search preference
        );

        // Append to editor
        const newContent = content + (content.length > 0 ? "\n\n" : "") + generatedText;
        onChange(newContent);
        // Immediate history push for AI actions
        pushToHistory(newContent, suggestions, comments);
        
        // Reset Writer
        dispatch({ type: 'SET_WRITER_PROMPT', payload: '' });
        dispatch({ type: 'SET_WRITER_FILES', payload: [] });
        dispatch({ type: 'TOGGLE_WRITER', payload: false });

    } catch (e) {
        console.error("Writer failed", e);
        alert("Magic Write failed. Please try again.");
    } finally {
        dispatch({ type: 'SET_IS_WRITING', payload: false });
        setIsProcessing(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
          dispatch({ type: 'SET_WRITER_FILES', payload: Array.from(e.target.files) });
      }
  };

  const applySuggestion = useCallback((s: Suggestion) => {
    if (content.includes(s.originalText)) {
      const newContent = content.replace(s.originalText, s.suggestedText);
      const newSuggestions = suggestions.filter(x => x.id !== s.id);
      onChange(newContent);
      setSuggestions(newSuggestions);
      dispatch({ type: 'SET_HOVER_SUGGESTION', payload: null });
      // Immediate history push for suggestions
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
    
    if (state.showGhostwriter) {
       dispatch({ type: 'SET_GHOSTWRITER', payload: { text: '', show: false, rect: null } });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const isOverTooltip = target.closest('.suggestion-tooltip');
    const isOverSuggestion = target.closest('.ai-suggestion');
    const isOverComment = target.closest('.user-comment');

    if (isOverTooltip) {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
      return;
    }

    if (isOverSuggestion) {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
      
      const id = (isOverSuggestion as HTMLElement).getAttribute('data-suggestion-id');
      if (state.hoveredSuggestion?.s.id !== id) {
         const suggestion = suggestions.find(s => s.id === id);
         if (suggestion) {
           hoverTimeoutRef.current = setTimeout(() => {
              dispatch({ type: 'SET_HOVER_SUGGESTION', payload: { s: suggestion, rect: (isOverSuggestion as HTMLElement).getBoundingClientRect() } });
           }, 100);
         }
      }
      dispatch({ type: 'SET_HOVER_COMMENT_ID', payload: null });
      dispatch({ type: 'SET_HOVER_COMMENT', payload: null });
      return; 
    }

    if (state.hoveredSuggestion && !isOverSuggestion && !isOverTooltip) {
       if (!hoverTimeoutRef.current) {
         hoverTimeoutRef.current = setTimeout(() => {
           dispatch({ type: 'SET_HOVER_SUGGESTION', payload: null });
           hoverTimeoutRef.current = null;
         }, 350); 
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

  const handleDeepExpand = async () => {
    if (!state.selection.text) return;
    await handleRewrite("Expand this text significantly. Add sensory details, internal monologue, and atmospheric descriptions. Make it longer and more immersive.");
  };

  const handleSensoryRewrite = async (sense: 'sight' | 'sound' | 'smell' | 'touch' | 'taste') => {
    if (!state.selection.text) return;
    setIsProcessing(true);
    try {
      const replacements = await getSensorySynonyms(state.selection.text, sense);
      if (replacements.length > 0) {
        const newText = replacements[0];
        const newContent = content.replace(state.selection.text, newText);
        onChange(newContent);
        pushToHistory(newContent, suggestions, comments);
        dispatch({ type: 'RESET_SELECTION' });
      }
    } catch (e) { console.error(e); }
    finally { setIsProcessing(false); }
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
    if (type === 'grammar') return <svg className={`${size} text-emerald-500`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>;
    if (type === 'expansion') return <svg className={`${size} text-purple-500`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"></path></svg>;
    return <svg className={`${size} text-blue-500`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>;
  };

  return (
    <div className={`relative flex gap-12 max-w-[1400px] mx-auto py-32 px-12 min-h-screen transition-all duration-700 ${state.isFlashing ? 'bg-blue-50/50 ring-8 ring-blue-500/10' : ''} ${zenMode ? 'bg-[#fdfbf7]' : ''}`} onMouseMove={handleMouseMove}>
      
      <style>{`
        /* Enhanced Spellcheck Visuals with Pulsing Animation */
        @keyframes spell-pulse {
          0% { background-color: rgba(239, 68, 68, 0); }
          50% { background-color: rgba(239, 68, 68, 0.1); }
          100% { background-color: rgba(239, 68, 68, 0); }
        }
        @keyframes spell-wave {
          0% { text-decoration-color: rgba(239, 68, 68, 0.6); }
          50% { text-decoration-color: rgba(239, 68, 68, 1); }
          100% { text-decoration-color: rgba(239, 68, 68, 0.6); }
        }
        .spell-error {
          text-decoration: underline;
          text-decoration-style: wavy;
          text-decoration-color: #ef4444; /* red-500 */
          text-decoration-thickness: 4px; /* More pronounced */
          text-underline-offset: 4px;
          cursor: context-menu;
          border-radius: 4px;
          transition: all 0.2s ease;
          animation: spell-wave 2s infinite linear, spell-pulse 2s infinite ease-in-out;
          display: inline;
        }
        .spell-error:hover {
          background-color: rgba(254, 226, 226, 0.4);
          text-decoration-color: #dc2626; /* red-600 */
        }
      `}</style>

      {/* PERSISTENT HEADER TOOLBAR */}
      {!zenMode && (
        <div className="absolute top-0 right-0 p-6 flex gap-2 z-20 pointer-events-none">
           <div className="pointer-events-auto bg-white/80 backdrop-blur-sm p-1.5 rounded-full border border-gray-100 shadow-sm flex gap-2 transition-all hover:bg-white hover:shadow-md">
             <button 
                onClick={handleGenerateSummary}
                disabled={state.isGeneratingSummary}
                className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-colors hover:bg-purple-50 text-purple-600`}
                title="Generate Document Summary"
             >
                {state.isGeneratingSummary ? '...' : '📝 Summary'}
             </button>
             <div className="w-px h-6 bg-gray-200 my-auto"></div>
             <button 
                onClick={runProactiveScan}
                disabled={isProcessing}
                className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-colors hover:bg-blue-50 text-blue-600`}
                title="Scan for Improvements"
             >
                ✨ Scan
             </button>
             <button 
                onClick={() => dispatch({ type: 'TOGGLE_WRITER', payload: true })}
                className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-colors hover:bg-indigo-50 text-indigo-600`}
                title="AI Magic Writer"
             >
                ✍️ Write
             </button>
             <div className="w-px h-6 bg-gray-200 my-auto"></div>
             <button 
                onClick={() => dispatch({ type: 'SET_SPELLCHECK_ENABLED', payload: !state.isSpellcheckEnabled })}
                className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-colors ${state.isSpellcheckEnabled ? 'bg-emerald-50 text-emerald-600 ring-2 ring-emerald-100' : 'bg-transparent text-gray-400 hover:text-gray-600 hover:bg-gray-50'}`}
                title="Toggle Live Spellcheck"
             >
                <div className={`w-2 h-2 rounded-full transition-colors ${state.isSpellcheckEnabled ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300'}`}></div>
                Check
             </button>
             <div className="w-px h-6 bg-gray-200 my-auto"></div>
             <div className="px-3 py-1.5 text-[10px] font-bold text-gray-400 flex items-center gap-2">
                <span>{content.trim().split(/\s+/).length} words</span>
             </div>
           </div>
        </div>
      )}

      {/* SUMMARY PANEL (COLLAPSIBLE) */}
      {state.showSummary && !zenMode && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 w-full max-w-3xl z-40 animate-in fade-in slide-in-from-top-4">
           <div className="bg-white/90 backdrop-blur-md border border-purple-100 shadow-xl rounded-2xl overflow-hidden ring-1 ring-purple-50">
              <div className="flex items-center justify-between px-4 py-2 bg-purple-50/50 border-b border-purple-100">
                 <div className="flex items-center gap-2">
                    <span className="text-lg">📝</span>
                    <span className="text-[10px] font-black uppercase tracking-widest text-purple-600">Document Summary</span>
                 </div>
                 <button onClick={() => dispatch({ type: 'TOGGLE_SUMMARY', payload: false })} className="text-gray-400 hover:text-gray-600 transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                 </button>
              </div>
              <div className="p-5 text-sm text-gray-700 leading-relaxed font-serif">
                 {state.isGeneratingSummary ? (
                    <div className="flex items-center gap-2 text-gray-400 italic">
                       <div className="w-4 h-4 border-2 border-purple-200 border-t-purple-600 rounded-full animate-spin"></div>
                       Distilling core themes...
                    </div>
                 ) : (
                    state.summary || <span className="text-gray-400 italic">No summary generated yet.</span>
                 )}
              </div>
           </div>
        </div>
      )}

      {/* MAGIC WRITER MODAL */}
      {state.showWriter && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in">
           <div className="bg-white rounded-[2rem] shadow-2xl p-8 w-full max-w-lg border border-indigo-100 relative">
              <button onClick={() => dispatch({ type: 'TOGGLE_WRITER', payload: false })} className="absolute top-6 right-6 text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
              <div className="flex items-center gap-3 mb-6">
                 <div className="w-10 h-10 bg-indigo-600 rounded-full flex items-center justify-center text-white shadow-lg">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                 </div>
                 <h3 className="text-xl font-serif font-bold text-gray-900">Magic Writer</h3>
              </div>
              
              <div className="space-y-4">
                 <textarea 
                   value={state.writerPrompt}
                   onChange={(e) => dispatch({ type: 'SET_WRITER_PROMPT', payload: e.target.value })}
                   placeholder="What should I write? (e.g., 'Describe the marketplace at dawn with sensory overload')"
                   className="w-full h-32 bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm outline-none focus:ring-2 ring-indigo-200 resize-none"
                 />
                 
                 <div className="flex gap-2">
                    <div className="relative flex-1">
                        <input 
                          type="file" 
                          multiple 
                          onChange={handleFileChange} 
                          className="absolute inset-0 opacity-0 cursor-pointer"
                        />
                        <div className="flex items-center justify-between px-4 py-3 bg-white border border-dashed border-gray-300 rounded-xl hover:bg-gray-50 transition-colors">
                          <span className="text-xs text-gray-500 truncate">
                            {state.writerFiles.length > 0 ? `${state.writerFiles.length} files attached` : "Attach inspiration..."}
                          </span>
                          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"></path></svg>
                        </div>
                    </div>
                    
                    <button 
                      onClick={() => dispatch({ type: 'SET_WRITER_USE_SEARCH', payload: !state.writerUseSearch })}
                      className={`flex items-center gap-2 px-4 py-3 rounded-xl border transition-all ${state.writerUseSearch ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-white border-gray-200 text-gray-400 hover:border-gray-300'}`}
                      title="Use Google Search Grounding"
                    >
                      <div className={`w-3 h-3 rounded-full border ${state.writerUseSearch ? 'bg-blue-600 border-blue-600' : 'bg-transparent border-gray-400'}`}></div>
                      <span className="text-[10px] font-black uppercase tracking-widest whitespace-nowrap">Grounding</span>
                    </button>
                 </div>

                 <button 
                   onClick={handleWriterSubmit}
                   disabled={state.isWriting || !state.writerPrompt.trim()}
                   className="w-full py-4 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                 >
                   {state.isWriting ? (
                     <>
                        <span className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></span>
                        Writing...
                     </>
                   ) : 'Generate & Insert'}
                 </button>
              </div>
           </div>
        </div>
      )}

      {/* Ghostwriter Overlay */}
      {state.showGhostwriter && state.ghostwriterRect && (
        <div 
          className="fixed z-50 animate-in fade-in zoom-in-95 duration-300 pointer-events-none"
          style={{ 
            top: state.ghostwriterRect.bottom + window.scrollY + 10,
            left: state.ghostwriterRect.left + 20,
          }}
        >
          <div className="bg-indigo-600/90 backdrop-blur-md text-white rounded-full px-4 py-2 shadow-2xl flex items-center gap-3 border border-indigo-400/30 max-w-md">
             {state.ghostwriterText === '...' ? (
               <div className="flex gap-1">
                 <div className="w-1.5 h-1.5 bg-white rounded-full animate-bounce delay-0"></div>
                 <div className="w-1.5 h-1.5 bg-white rounded-full animate-bounce delay-150"></div>
                 <div className="w-1.5 h-1.5 bg-white rounded-full animate-bounce delay-300"></div>
               </div>
             ) : (
               <>
                 <span className="text-xs font-serif italic pr-2 border-r border-white/20">"{state.ghostwriterText}"</span>
                 <span className="text-[9px] font-black uppercase tracking-widest opacity-70 whitespace-nowrap">Tab to Accept</span>
               </>
             )}
          </div>
        </div>
      )}

      {/* Accept All Button */}
      {suggestions.length > 0 && !zenMode && (
        <button
          onClick={handleMagicApplyAll}
          className="fixed bottom-12 right-12 z-50 bg-emerald-600 hover:bg-emerald-500 text-white shadow-xl hover:shadow-2xl hover:scale-105 active:scale-95 transition-all rounded-full px-6 py-4 flex items-center gap-3 animate-in slide-in-from-bottom-6 duration-300"
          title="Accept All (Cmd+Shift+A)"
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

      {/* SUGGESTION TOOLTIP - VISUALLY REFINED */}
      {state.hoveredSuggestion && (
        <div 
          className="suggestion-tooltip fixed z-[100] bg-white/90 backdrop-blur-xl rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-white/50 animate-in fade-in zoom-in-95 slide-in-from-bottom-1 duration-200 pointer-events-auto flex flex-col w-[300px] overflow-hidden font-sans ring-1 ring-black/5"
          style={{ 
            top: state.hoveredSuggestion.rect.bottom + 8, 
            left: Math.min(window.innerWidth - 320, Math.max(20, state.hoveredSuggestion.rect.left + (state.hoveredSuggestion.rect.width / 2) - 150))
          }}
        >
          {/* Header */}
          <div className={`px-4 py-2.5 flex items-center justify-between border-b border-gray-100/50 ${
             state.hoveredSuggestion.s.type === 'improvement' ? 'bg-blue-50/50' :
             state.hoveredSuggestion.s.type === 'grammar' ? 'bg-emerald-50/50' :
             state.hoveredSuggestion.s.type === 'expansion' ? 'bg-purple-50/50' :
             'bg-amber-50/50'
          }`}>
             <div className="flex items-center gap-2">
               {/* Icon */}
               <div className={`p-1 rounded-md ${
                   state.hoveredSuggestion.s.type === 'improvement' ? 'bg-blue-100 text-blue-600' :
                   state.hoveredSuggestion.s.type === 'grammar' ? 'bg-emerald-100 text-emerald-600' :
                   state.hoveredSuggestion.s.type === 'expansion' ? 'bg-purple-100 text-purple-600' :
                   'bg-amber-100 text-amber-600'
               }`}>
                 {renderTypeIcon(state.hoveredSuggestion.s.type, "w-3 h-3")}
               </div>
               <span className={`text-[10px] font-bold uppercase tracking-widest ${
                   state.hoveredSuggestion.s.type === 'improvement' ? 'text-blue-600' :
                   state.hoveredSuggestion.s.type === 'grammar' ? 'text-emerald-600' :
                   state.hoveredSuggestion.s.type === 'expansion' ? 'text-purple-600' :
                   'text-amber-600'
               }`}>{state.hoveredSuggestion.s.type}</span>
             </div>
             <button onClick={() => dispatch({ type: 'SET_HOVER_SUGGESTION', payload: null })} className="text-gray-400 hover:text-gray-600 p-1 hover:bg-black/5 rounded-full transition-colors" title="Close">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
             </button>
          </div>

          <div className="p-4 space-y-3">
             <div className="text-xs text-gray-600 leading-relaxed">
               {state.hoveredSuggestion.s.explanation}
             </div>
             
             {/* Diff-style change */}
             <div className="bg-gray-50/80 rounded-lg p-3 border border-gray-100 relative group/diff hover:bg-white transition-colors">
               <div className="absolute top-2 right-2 text-[9px] font-bold text-gray-300 uppercase tracking-widest">Suggestion</div>
               <div className="text-sm font-medium text-gray-900 pr-4">
                 {state.hoveredSuggestion.s.suggestedText}
               </div>
             </div>

             <div className="flex items-center gap-2 pt-1">
                <button 
                  onClick={() => applySuggestion(state.hoveredSuggestion!.s)}
                  className="flex-1 bg-gray-900 hover:bg-black text-white text-[10px] font-bold uppercase tracking-widest py-2.5 rounded-lg transition-all shadow-md active:scale-95 flex items-center justify-center gap-2"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path d="M5 13l4 4L19 7"/></svg>
                  Accept
                </button>
                <button 
                  onClick={() => rejectSuggestion(state.hoveredSuggestion!.s)}
                  className="px-3 bg-white border border-gray-200 hover:bg-gray-50 text-gray-400 hover:text-gray-600 text-[10px] font-bold uppercase tracking-widest py-2.5 rounded-lg transition-all active:scale-95"
                  title="Dismiss"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
             </div>
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
        <div id="spellcheck-box" className="fixed z-[60] glass rounded-[1.5rem] shadow-2xl p-0 min-w-[220px] animate-in fade-in zoom-in duration-200 border border-red-100/50 overflow-hidden ring-4 ring-red-50/20 backdrop-blur-xl"
          style={{ top: state.inspectedSpellError.rect.bottom + window.scrollY + 12, left: state.inspectedSpellError.rect.left + (state.inspectedSpellError.rect.width / 2) - 110 }}>
          <div className="px-4 py-3 bg-red-50/80 border-b border-red-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
                 <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
                 <span className="text-[10px] font-black uppercase tracking-widest text-red-600/80">Spelling Check</span>
            </div>
            <button onClick={() => dispatch({ type: 'SET_INSPECTED_ERROR', payload: null })} className="text-red-300 hover:text-red-500 transition-colors bg-white/50 hover:bg-white rounded-full p-1"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"></path></svg></button>
          </div>
          <div className="p-2 flex flex-col gap-1 bg-white/80">
             {state.inspectedSpellError.err.corrections.length > 0 ? (
                state.inspectedSpellError.err.corrections.map(c => (
                    <button 
                      key={c} 
                      onClick={() => applyCorrection(state.inspectedSpellError!.err.id, c)}
                      className="w-full text-left px-4 py-2.5 rounded-xl hover:bg-red-50 text-sm font-bold text-gray-800 transition-all flex items-center justify-between group border border-transparent hover:border-red-100"
                    >
                      {c}
                      <span className="opacity-0 group-hover:opacity-100 text-[9px] font-black text-red-500 uppercase tracking-wider bg-white px-2 py-0.5 rounded-full shadow-sm">Fix</span>
                    </button>
                ))
             ) : (
                <div className="px-3 py-4 text-center text-xs text-gray-400 italic">No suggestions found</div>
             )}
             
             <div className="h-px bg-gray-100 my-2 mx-2"></div>
             
             <button 
                onClick={() => dispatch({ type: 'SET_INSPECTED_ERROR', payload: null })}
                className="w-full text-left px-4 py-2 rounded-xl hover:bg-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-widest transition-colors flex items-center gap-2"
             >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"></path></svg>
                Ignore Error
             </button>
          </div>
        </div>
      )}

      {/* EDITOR MAIN AREA */}
      <div className={`flex-1 relative group transition-colors duration-700`}>
        <div
          ref={editorRef}
          contentEditable
          spellCheck={false}
          onMouseUp={handleMouseUp}
          onClick={handleEditorClick}
          onContextMenu={handleContextMenu}
          onInput={handleInput}
          className={`w-full min-h-[80vh] text-xl md:text-2xl leading-[2.1] text-gray-900 font-serif whitespace-pre-wrap outline-none transition-opacity duration-700 ${state.isStreaming ? 'opacity-80' : 'opacity-100'} ${zenMode ? 'text-[#3d3d3d]' : ''}`}
          dangerouslySetInnerHTML={{ __html: highlightedContent }}
        />
        {!content && !isProcessing && (
          <div className="absolute top-0 pointer-events-none text-gray-300 text-xl md:text-2xl font-serif leading-[2.1]">Start writing or use the Collaborator to generate a draft...</div>
        )}
      </div>

      {/* DEDICATED SIDEBAR PANEL FOR COMMENTS */}
      {comments.length > 0 && state.showMarginNotes && !zenMode && (
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

              {/* Deep Expand Feature */}
              <button 
                onClick={handleDeepExpand}
                className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-50 to-blue-50 hover:from-indigo-100 hover:to-blue-100 text-indigo-700 border border-indigo-100 py-2.5 rounded-xl transition-all group"
              >
                  <span className="text-lg">✨</span>
                  <span className="text-[9px] font-black uppercase tracking-widest">Deep Expand Paragraph</span>
              </button>

              {/* Sensory Thesaurus Grid */}
              <div>
                  <label className="text-[9px] font-bold text-gray-300 uppercase tracking-widest mb-1.5 block ml-1">Sensory Expansion</label>
                  <div className="flex gap-1.5">
                      {[{l:'sight', i:'👁️'}, {l:'sound', i:'👂'}, {l:'smell', i:'👃'}, {l:'touch', i:'✋'}, {l:'taste', i:'👅'}].map(s => (
                        <button key={s.l} onClick={() => handleSensoryRewrite(s.l as any)} className="flex-1 flex justify-center py-2 rounded-lg border border-gray-100 hover:border-pink-300 hover:bg-pink-50 transition-all text-sm" title={`Enhance ${s.l}`}>
                            {s.i}
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
