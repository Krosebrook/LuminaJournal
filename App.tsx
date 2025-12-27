
import React, { useState, useEffect, useCallback, useRef } from 'react';
import Editor from './components/Editor';
import Sidebar from './components/Sidebar';
import { WritingTone, Suggestion, Comment } from './types';
import { jsPDF } from "jspdf";
import { Document, Packer, Paragraph, TextRun } from "docx";

interface HistoryState {
  content: string;
  suggestions: Suggestion[];
  comments: Comment[];
}

const App: React.FC = () => {
  const [content, setContent] = useState(() => localStorage.getItem('lumina-content') || '');
  const [tone, setTone] = useState<WritingTone>(() => (localStorage.getItem('lumina-tone') as WritingTone) || 'creative');
  const [isProcessing, setIsProcessing] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [comments, setComments] = useState<Comment[]>(() => {
    const saved = localStorage.getItem('lumina-comments');
    return saved ? JSON.parse(saved) : [];
  });
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // History State
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const isInternalChange = useRef(false);

  useEffect(() => {
    localStorage.setItem('lumina-content', content);
  }, [content]);

  useEffect(() => {
    localStorage.setItem('lumina-tone', tone);
  }, [tone]);

  useEffect(() => {
    localStorage.setItem('lumina-comments', JSON.stringify(comments));
  }, [comments]);

  // Initial history state
  useEffect(() => {
    if (history.length === 0 && (content || suggestions.length > 0 || comments.length > 0)) {
      const initial = { content, suggestions: [...suggestions], comments: [...comments] };
      setHistory([initial]);
      setHistoryIndex(0);
    }
  }, []);

  const pushToHistory = useCallback((newContent: string, newSuggestions: Suggestion[], newComments: Comment[] = comments) => {
    if (isInternalChange.current) return;

    setHistory(prev => {
      const sliced = prev.slice(0, historyIndex + 1);
      const next = [...sliced, { content: newContent, suggestions: [...newSuggestions], comments: [...newComments] }];
      if (next.length > 100) next.shift();
      return next;
    });
    setHistoryIndex(prev => {
      const next = prev + 1;
      return next > 99 ? 99 : next;
    });
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

  const handleContentChange = useCallback((newContent: string) => {
    setContent(newContent);
    pushToHistory(newContent, suggestions, comments);
  }, [suggestions, comments, pushToHistory]);

  const applyAllSuggestions = useCallback(() => {
    if (suggestions.length === 0) return;
    
    let newContent = content;
    suggestions.forEach(s => {
      if (newContent.includes(s.originalText)) {
        newContent = newContent.replace(s.originalText, s.suggestedText);
      }
    });
    
    const finalSuggestions: Suggestion[] = [];
    setContent(newContent);
    setSuggestions(finalSuggestions);
    pushToHistory(newContent, finalSuggestions, comments);
  }, [content, suggestions, comments, pushToHistory]);

  // Handle click outside to close export menu
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleExport = async (format: 'txt' | 'docx' | 'pdf' | 'md' | 'copy') => {
    const filename = `lumina-draft-${new Date().toISOString().slice(0, 10)}`;
    setShowExportMenu(false);

    if (format === 'copy') {
      try {
        await navigator.clipboard.writeText(content);
        alert('Copied to clipboard!');
      } catch (err) {
        console.error('Failed to copy: ', err);
      }
      return;
    }

    if (format === 'txt') {
      const blob = new Blob([content], { type: 'text/plain' });
      downloadBlob(blob, `${filename}.txt`);
    } else if (format === 'md') {
      const blob = new Blob([content], { type: 'text/markdown' });
      downloadBlob(blob, `${filename}.md`);
    } else if (format === 'docx') {
      const doc = new Document({
        sections: [{
          properties: {},
          children: content.split('\n').map(line => new Paragraph({
            children: [new TextRun(line)],
          })),
        }],
      });
      const blob = await Packer.toBlob(doc);
      downloadBlob(blob, `${filename}.docx`);
    } else if (format === 'pdf') {
      const doc = new jsPDF();
      const margin = 20;
      const pageWidth = doc.internal.pageSize.getWidth();
      doc.setFontSize(22);
      doc.setFont("helvetica", "bold");
      doc.text("Lumina Artifact", margin, 20);
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(150);
      doc.text(`Generated on ${new Date().toLocaleDateString()}`, margin, 28);
      
      doc.setTextColor(40);
      doc.setFontSize(12);
      const splitContent = doc.splitTextToSize(content, pageWidth - margin * 2);
      doc.text(splitContent, margin, 45);
      doc.save(`${filename}.pdf`);
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

  return (
    <div className="min-h-screen bg-[#fafafa]">
      <nav className="fixed top-0 inset-x-0 h-24 flex items-center justify-between px-16 z-30 pointer-events-none">
        <div className="flex items-center gap-4 pointer-events-auto">
          <div className="w-12 h-12 bg-gray-900 rounded-[1.5rem] flex items-center justify-center shadow-2xl transition-transform hover:scale-110 active:scale-95 cursor-pointer">
             <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-black tracking-widest text-gray-900 uppercase">Lumina</span>
            <span className="text-[9px] font-bold text-blue-600 uppercase tracking-widest opacity-80">Beta 2.0</span>
          </div>
        </div>
        
        <div className="flex items-center gap-8 pointer-events-auto relative" ref={exportMenuRef}>
          <div className="flex flex-col items-end">
            <span className="text-[9px] font-black text-gray-300 uppercase tracking-widest mb-0.5">Session Pulse</span>
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-gray-900">{content.split(/\s+/).filter(Boolean).length}</span>
              <span className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter">Words Crafted</span>
            </div>
          </div>
          
          <div className="relative">
            <button 
              onClick={() => setShowExportMenu(!showExportMenu)}
              className={`flex items-center gap-3 px-8 py-3.5 bg-white border border-gray-100 rounded-[1.25rem] shadow-sm hover:shadow-xl hover:-translate-y-0.5 transition-all text-[10px] font-black text-gray-800 uppercase tracking-[0.2em] ${showExportMenu ? 'ring-2 ring-blue-500/10' : ''}`}
            >
              Export Artifact
              <svg className={`w-3 h-3 text-gray-400 transition-transform duration-300 ${showExportMenu ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M19 9l-7 7-7-7"></path>
              </svg>
            </button>

            {showExportMenu && (
              <div className="absolute top-full right-0 mt-3 w-72 glass rounded-[1.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.1)] border border-white/50 py-3 animate-in fade-in slide-in-from-top-4 duration-300 z-50 overflow-hidden">
                {[
                  { id: 'pdf', label: 'Portable Document', ext: '.pdf', icon: '📄', desc: 'Standard reading format' },
                  { id: 'docx', label: 'Word Document', ext: '.docx', icon: '📝', desc: 'Editable office artifact' },
                  { id: 'md', label: 'Markdown File', ext: '.md', icon: '🔽', desc: 'Developer friendly structure' },
                  { id: 'txt', label: 'Plain Text', ext: '.txt', icon: '🔤', desc: 'Pure content structure' },
                  { id: 'copy', label: 'Copy to Clipboard', ext: '', icon: '📋', desc: 'Swift content capture' },
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={() => handleExport(item.id as any)}
                    className="w-full flex items-center gap-4 px-6 py-3 hover:bg-blue-600 hover:text-white transition-all group"
                  >
                    <span className="text-xl group-hover:scale-110 transition-transform">{item.icon}</span>
                    <div className="flex flex-col items-start">
                      <span className="text-[10px] font-black uppercase tracking-widest">{item.label}</span>
                      <span className="text-[9px] font-medium opacity-50 group-hover:opacity-100">{item.desc}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </nav>

      <Sidebar 
        tone={tone}
        setTone={setTone}
        onDraftGenerated={(c) => {
          setContent(c);
          pushToHistory(c, suggestions, comments);
        }} 
        isProcessing={isProcessing} 
        setIsProcessing={setIsProcessing} 
        content={content}
        suggestions={suggestions}
        setSuggestions={setSuggestions}
        onApplyAll={applyAllSuggestions}
      />

      <main className="transition-all duration-1000">
        <Editor 
          content={content} 
          tone={tone}
          onChange={handleContentChange} 
          isProcessing={isProcessing} 
          setIsProcessing={setIsProcessing} 
          suggestions={suggestions}
          setSuggestions={setSuggestions}
          comments={comments}
          setComments={setComments}
          onApplyAll={applyAllSuggestions}
          undo={undo}
          redo={redo}
          canUndo={historyIndex > 0}
          canRedo={historyIndex < history.length - 1}
          pushToHistory={pushToHistory}
        />
      </main>

      <div className="fixed bottom-12 left-16 flex items-center gap-10 z-30">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full transition-colors duration-500 ${isProcessing ? 'bg-blue-600 animate-ping' : 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.4)]'}`}></div>
          <span className="text-[9px] font-black text-gray-400 uppercase tracking-[0.2em]">{isProcessing ? 'Gemini Synchronizing' : 'Core Ready'}</span>
        </div>
        
        <div className="flex items-center gap-2 border-l border-gray-200 pl-10">
          <button 
            onClick={undo} 
            disabled={historyIndex <= 0}
            className={`p-2 rounded-lg hover:bg-gray-100 transition-all ${historyIndex <= 0 ? 'opacity-20 cursor-not-allowed' : 'opacity-100 text-gray-900'}`}
            title="Undo (Cmd+Z)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"></path></svg>
          </button>
          <button 
            onClick={redo} 
            disabled={historyIndex >= history.length - 1}
            className={`p-2 rounded-lg hover:bg-gray-100 transition-all ${historyIndex >= history.length - 1 ? 'opacity-20 cursor-not-allowed' : 'opacity-100 text-gray-900'}`}
            title="Redo (Cmd+Shift+Z)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 10h-10a8 8 0 00-8 8v2m18-8l-6 6m6-6l-6-6"></path></svg>
          </button>
        </div>

        <div className="text-[9px] font-black text-gray-300 uppercase tracking-[0.2em] hidden sm:block">
          Intelligence: Gemini 3 Flash / Pro Hybrid
        </div>
      </div>

      <div className="fixed inset-0 pointer-events-none opacity-[0.03] bg-[radial-gradient(#000_1px,transparent_1px)] [background-size:32px_32px]"></div>
    </div>
  );
};

export default App;
