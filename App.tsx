
import React, { useState, useEffect, useCallback, useRef } from 'react';
import Editor from './components/Editor';
import Sidebar from './components/Sidebar';
import Archive from './components/Archive';
import InterviewRoom from './components/InterviewRoom';
import { WritingTone, Suggestion, Comment, Draft } from './types';
import { jsPDF } from "jspdf";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { db } from './lib/db';

const App: React.FC = () => {
  // Document State
  const [currentDraftId, setCurrentDraftId] = useState<number | undefined>(undefined);
  const [title, setTitle] = useState('Untitled');
  const [content, setContent] = useState('');
  const [tone, setTone] = useState<WritingTone>('memoir');
  
  // App UI State
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  
  // Live Interview State
  const [showInterview, setShowInterview] = useState(false);
  const [interviewInstruction, setInterviewInstruction] = useState('');

  // Editor Metadata
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  
  // History State
  const [history, setHistory] = useState<{content: string, suggestions: Suggestion[], comments: Comment[]}[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const isInternalChange = useRef(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // Initial Load: Fetch most recent draft or create default
  useEffect(() => {
    const init = async () => {
      // Find the most recently updated draft
      const mostRecent = await db.drafts.orderBy('updatedAt').reverse().first();
      
      if (mostRecent) {
        loadDraft(mostRecent);
      } else {
        // Create default if DB is empty
        const defaultDraft: Draft = {
          title: 'My First Memoir',
          content: 'I was born in a small town...',
          tone: 'memoir',
          wordCount: 6,
          updatedAt: Date.now()
        };
        const id = await db.drafts.add(defaultDraft);
        loadDraft({ ...defaultDraft, id: Number(id) });
      }
    };
    init();
  }, []);

  const loadDraft = (draft: Draft) => {
    setCurrentDraftId(draft.id);
    setTitle(draft.title);
    setContent(draft.content);
    setTone(draft.tone);
    // Reset history for new document
    setHistory([{ content: draft.content, suggestions: [], comments: [] }]);
    setHistoryIndex(0);
    // Hide Archive if open
    setShowArchive(false);
  };

  const handleSelectDraft = (draft: Draft) => {
    loadDraft(draft);
  };

  // Auto-save logic
  useEffect(() => {
    if (currentDraftId === undefined) return;

    const saveTimeout = setTimeout(async () => {
      setIsSaving(true);
      try {
        const wordCount = content.trim().split(/\s+/).length;
        // Generate a simple title if it's untitled and has content
        let dynamicTitle = title;
        if ((title === 'Untitled Chapter' || !title) && content.length > 20) {
           dynamicTitle = content.slice(0, 30).split(' ').slice(0, -1).join(' ') + '...';
           setTitle(dynamicTitle);
        }

        await db.drafts.update(currentDraftId, {
          title: dynamicTitle,
          content,
          tone,
          wordCount: content ? wordCount : 0,
          updatedAt: Date.now()
        });
      } catch (error) {
        console.error("Auto-save failed:", error);
      } finally {
        setTimeout(() => setIsSaving(false), 500);
      }
    }, 1500);

    return () => clearTimeout(saveTimeout);
  }, [content, tone, title, currentDraftId]);

  // Click outside listener for export menu
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const pushToHistory = useCallback((newContent: string, newSuggestions: Suggestion[], newComments: Comment[] = comments) => {
    if (isInternalChange.current) return;
    setHistory(prev => {
      const next = [...prev.slice(0, historyIndex + 1), { content: newContent, suggestions: [...newSuggestions], comments: [...newComments] }];
      return next.slice(-50);
    });
    setHistoryIndex(prev => Math.min(prev + 1, 49));
  }, [historyIndex, comments]);

  const undo = useCallback(() => {
    if (historyIndex > 0) {
      isInternalChange.current = true;
      const prevState = history[historyIndex - 1];
      setContent(prevState.content);
      setSuggestions(prevState.suggestions);
      setComments(prevState.comments);
      setHistoryIndex(historyIndex - 1);
      setTimeout(() => { isInternalChange.current = false; }, 50);
    }
  }, [historyIndex, history]);

  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      isInternalChange.current = true;
      const nextState = history[historyIndex + 1];
      setContent(nextState.content);
      setSuggestions(nextState.suggestions);
      setComments(nextState.comments);
      setHistoryIndex(historyIndex + 1);
      setTimeout(() => { isInternalChange.current = false; }, 50);
    }
  }, [historyIndex, history]);

  const handleExport = async (format: 'txt' | 'docx' | 'pdf' | 'md' | 'copy') => {
    const filename = `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'lumina-draft'}`;
    setShowExportMenu(false);

    if (format === 'copy') {
      try {
        await navigator.clipboard.writeText(content);
      } catch (err) {
        console.error('Failed to copy text: ', err);
      }
      return;
    }

    if (format === 'pdf') {
      const doc = new jsPDF();
      doc.setFontSize(14).text(content, 10, 10);
      doc.save(`${filename}.pdf`);
    } else if (format === 'docx') {
      const doc = new Document({ 
        sections: [{ 
          children: content.split('\n').map(l => new Paragraph({ 
            children: [new TextRun(l)] 
          })) 
        }] 
      });
      const blob = await Packer.toBlob(doc);
      downloadBlob(blob, `${filename}.docx`);
    } else if (format === 'md') {
      const blob = new Blob([content], { type: 'text/markdown' });
      downloadBlob(blob, `${filename}.md`);
    } else {
      const blob = new Blob([content], { type: 'text/plain' });
      downloadBlob(blob, `${filename}.txt`);
    }
  };

  const downloadBlob = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; 
    a.download = name; 
    a.click();
    URL.revokeObjectURL(url);
  };

  // Live Interview Handling
  const handleStartInterview = (instruction: string) => {
    setInterviewInstruction(instruction);
    setShowInterview(true);
  };

  const handleInterviewEnd = (transcript: string) => {
    setShowInterview(false);
    if (transcript.trim()) {
      const interviewBlock = `\n\n--- INTERVIEW SESSION ---\n${transcript.trim()}\n-------------------------\n`;
      const newContent = content + interviewBlock;
      setContent(newContent);
      pushToHistory(newContent, suggestions, comments);
    }
  };

  const EXPORT_OPTIONS = [
    { id: 'pdf', label: 'Portable Document (.pdf)' },
    { id: 'docx', label: 'Word Document (.docx)' },
    { id: 'md', label: 'Markdown Format (.md)' },
    { id: 'txt', label: 'Plain Text (.txt)' },
    { id: 'copy', label: 'Copy to Clipboard' },
  ];

  return (
    <div className="min-h-screen bg-[#fafafa]">
      <nav className="fixed top-0 inset-x-0 h-24 flex items-center justify-between px-6 md:px-16 z-30 pointer-events-none transition-all duration-300">
        <div className="flex items-center gap-4 pointer-events-auto">
          <button onClick={() => setShowArchive(true)} className="group flex items-center gap-3 pr-4 transition-all hover:scale-105">
            <div className="w-12 h-12 bg-gray-900 rounded-[1.5rem] flex items-center justify-center shadow-2xl group-hover:bg-blue-600 transition-colors">
               <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
            </div>
            <div className="flex flex-col items-start">
               <span className="text-xs font-black text-gray-900 uppercase group-hover:text-blue-600 transition-colors">Lumina</span>
               <div className="flex items-center gap-1.5">
                 <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider truncate max-w-[120px]">{title}</span>
                 <svg className="w-3 h-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
               </div>
            </div>
          </button>
        </div>
        
        <div className="flex items-center gap-4 md:gap-8 pointer-events-auto relative" ref={exportMenuRef}>
          <button 
            onClick={() => setShowExportMenu(!showExportMenu)} 
            className="group flex items-center gap-2 md:gap-3 px-6 py-3 bg-white border border-gray-100 rounded-[1.25rem] shadow-sm text-[10px] font-black uppercase tracking-[0.2em] hover:shadow-md transition-all active:scale-95"
          >
            <span className="hidden md:inline">Export Artifact</span>
            <span className="md:hidden">Export</span>
            <svg className={`w-3 h-3 transition-transform duration-300 ${showExportMenu ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M19 9l-7 7-7-7"></path>
            </svg>
          </button>
          
          {showExportMenu && (
            <div className="absolute top-full right-0 mt-3 w-72 glass rounded-[1.5rem] shadow-2xl py-2 z-50 overflow-hidden border border-white/40 animate-in fade-in slide-in-from-top-2">
              {EXPORT_OPTIONS.map(opt => (
                <button 
                  key={opt.id} 
                  onClick={() => handleExport(opt.id as any)} 
                  className="w-full text-left px-6 py-3.5 hover:bg-gray-900 hover:text-white text-[10px] font-black uppercase tracking-widest transition-colors flex items-center justify-between group"
                >
                  {opt.label}
                  <svg className="w-3 h-3 opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M9 5l7 7-7 7"></path>
                  </svg>
                </button>
              ))}
            </div>
          )}
        </div>
      </nav>

      {/* Archive / Project Manager */}
      <Archive 
        isOpen={showArchive} 
        onClose={() => setShowArchive(false)} 
        onSelectDraft={handleSelectDraft}
        currentDraftId={currentDraftId}
      />

      <Sidebar 
        tone={tone} setTone={setTone}
        onDraftGenerated={(c) => { setContent(c); pushToHistory(c, suggestions, comments); }} 
        isProcessing={isProcessing} setIsProcessing={setIsProcessing} 
        content={content} suggestions={suggestions} setSuggestions={setSuggestions}
        onApplyAll={() => {}}
        onStartInterview={handleStartInterview}
      />

      {/* Live Interview Room Overlay */}
      <InterviewRoom 
        isOpen={showInterview} 
        onClose={handleInterviewEnd}
        systemInstruction={interviewInstruction}
      />

      <main className={`transition-all duration-500 ${showArchive || showInterview ? 'scale-95 blur-sm' : 'scale-100 blur-0'}`}>
        <Editor 
          content={content} tone={tone} 
          onChange={setContent}
          isProcessing={isProcessing} setIsProcessing={setIsProcessing} 
          suggestions={suggestions} setSuggestions={setSuggestions}
          comments={comments} setComments={setComments}
          onApplyAll={() => {}} undo={undo} redo={redo}
          canUndo={historyIndex > 0} canRedo={historyIndex < history.length - 1}
          pushToHistory={pushToHistory}
        />
      </main>

      <div className="fixed bottom-12 left-6 md:left-16 flex items-center gap-6 md:gap-10 z-30 transition-all duration-300">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${isProcessing ? 'bg-blue-600 animate-ping' : isSaving ? 'bg-amber-500 animate-pulse' : 'bg-green-500'}`}></div>
          <span className="text-[9px] font-black text-gray-400 uppercase tracking-[0.2em] hidden md:inline">
            {isProcessing ? 'Gemini Active' : isSaving ? 'Saving Draft...' : 'Offline Persist Ready'}
          </span>
        </div>
        <div className="flex items-center gap-2 border-l border-gray-200 pl-6 md:pl-10">
          <button onClick={undo} disabled={historyIndex <= 0} className="p-2 opacity-100 disabled:opacity-20 hover:scale-110 active:scale-90 transition-all"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"></path></svg></button>
          <button onClick={redo} disabled={historyIndex >= history.length - 1} className="p-2 opacity-100 disabled:opacity-20 hover:scale-110 active:scale-90 transition-all"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 10h-10a8 8 0 00-8 8v2m18-8l-6 6m6-6l-6-6"></path></svg></button>
        </div>
      </div>
    </div>
  );
};

export default App;
