
import React, { useState, useEffect, useCallback, useRef } from 'react';
import Editor from './components/Editor';
import Sidebar from './components/Sidebar';
import Archive from './components/Archive';
import InterviewRoom from './components/InterviewRoom';
import EchoSession from './components/EchoSession';
import { WritingTone, Suggestion, Comment, Draft } from './types';
import { jsPDF } from "jspdf";
import { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel, Footer, PageBreak } from "docx";
import JSZip from 'jszip';
import { db } from './lib/db';
import { indexDraft } from './services/vectorService';
import { generateSceneImage } from './services/geminiService';

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
  const [isExporting, setIsExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState('');
  const [zenMode, setZenMode] = useState(false);
  
  // Live State
  const [showInterview, setShowInterview] = useState(false);
  const [showEcho, setShowEcho] = useState(false);
  const [interviewInstruction, setInterviewInstruction] = useState('');

  // Editor Metadata
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  
  // History State
  const [history, setHistory] = useState<{content: string, suggestions: Suggestion[], comments: Comment[]}[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const isInternalChange = useRef(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Auto-save logic & Vector Indexing
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

        // Background Vector Indexing for Search
        await indexDraft(currentDraftId, content);

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

  const handleExport = async (format: 'txt' | 'docx' | 'pdf' | 'md' | 'copy' | 'epub') => {
    const filename = `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'lumina-draft'}`;
    setShowExportMenu(false);
    
    if (format === 'copy') {
      await navigator.clipboard.writeText(content);
      alert('Draft copied to clipboard');
      return;
    }

    try {
      if (format === 'epub') {
        setIsExporting(true);
        setExportStatus('Building eBook...');
        const zip = new JSZip();
        zip.file('mimetype', 'application/epub+zip');
        zip.folder('META-INF')!.file('container.xml', `<?xml version="1.0"?>
          <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
            <rootfiles>
              <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
            </rootfiles>
          </container>`);
          
        const oebps = zip.folder('OEBPS');
        oebps!.file('content.opf', `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
        <package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="2.0">
          <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
            <dc:title>${title}</dc:title>
            <dc:language>en</dc:language>
          </metadata>
          <manifest>
            <item href="toc.ncx" id="ncx" media-type="application/x-dtbncx+xml"/>
            <item href="chapter1.xhtml" id="chapter1" media-type="application/xhtml+xml"/>
          </manifest>
          <spine toc="ncx">
            <itemref idref="chapter1"/>
          </spine>
        </package>`);

        oebps!.file('toc.ncx', `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
        <ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
          <head><meta content="urn:uuid:12345" name="dtb:uid"/></head>
          <docTitle><text>${title}</text></docTitle>
          <navMap>
            <navPoint id="navPoint-1" playOrder="1">
              <navLabel><text>Start</text></navLabel>
              <content src="chapter1.xhtml"/>
            </navPoint>
          </navMap>
        </ncx>`);

        oebps!.file('chapter1.xhtml', `<?xml version="1.0" encoding="utf-8"?>
        <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
        <html xmlns="http://www.w3.org/1999/xhtml">
        <head><title>${title}</title></head>
        <body>
          <h1>${title}</h1>
          ${content.split('\n').map(p => `<p>${p}</p>`).join('')}
        </body>
        </html>`);

        const blob = await zip.generateAsync({type: "blob"});
        downloadBlob(blob, `${filename}.epub`);

      } else if (format === 'pdf') {
        setIsExporting(true);
        setExportStatus('Designing Cover...');
        const doc = new jsPDF();
        
        // AI Generated Cover
        try {
          const coverPrompt = `A minimal, artistic book cover for a memoir chapter titled "${title}". B&W, woodcut style, highly detailed.`;
          const base64Cover = await generateSceneImage(coverPrompt);
          if (base64Cover) {
            doc.addImage(`data:image/png;base64,${base64Cover}`, 'PNG', 0, 0, 210, 297, undefined, 'FAST');
            
            // Add Title on Cover
            doc.setFont("times", "bold");
            doc.setFontSize(32);
            doc.setTextColor(255, 255, 255);
            // Simple shadow/outline hack for readability
            doc.text(title, 105, 100, { align: 'center' });
            
            doc.setTextColor(0, 0, 0); // Reset
            doc.addPage();
          }
        } catch (e) { console.error("Cover Gen Failed", e); }

        setExportStatus('Typesetting...');
        doc.setFont("times", "normal");
        doc.setFontSize(12);
        
        const lines = doc.splitTextToSize(content, 170);
        let cursorY = 30;
        let pageNum = 1;

        // Title on first text page
        doc.setFont("times", "bold");
        doc.setFontSize(18);
        doc.text(title, 105, 20, { align: 'center' });
        doc.setFont("times", "normal");
        doc.setFontSize(12);
        
        lines.forEach((line: string) => {
          if (cursorY > 270) {
            doc.setFontSize(10);
            doc.text(`${pageNum}`, 105, 290, { align: 'center' });
            doc.setFontSize(12);
            doc.addPage();
            cursorY = 20;
            pageNum++;
          }
          doc.text(line, 20, cursorY);
          cursorY += 7;
        });

        // Add Comments if any
        if (comments.length > 0) {
            doc.addPage();
            doc.setFont("times", "bold");
            doc.setFontSize(16);
            doc.text("Margin Notes", 20, 20);
            doc.setFont("times", "normal");
            doc.setFontSize(10);
            cursorY = 35;
            comments.forEach(c => {
                if (cursorY > 270) {
                    doc.addPage();
                    cursorY = 20;
                }
                const note = `[${new Date(c.timestamp).toLocaleTimeString()}] Ref: "${c.originalText.substring(0, 30)}..."\nNote: ${c.text}`;
                const splitNote = doc.splitTextToSize(note, 170);
                doc.text(splitNote, 20, cursorY);
                cursorY += (splitNote.length * 5) + 10;
            });
        }
        
        // Page number for last page
        doc.setFontSize(10);
        doc.text(`${pageNum}`, 105, 290, { align: 'center' });

        doc.save(`${filename}.pdf`);
      } else if (format === 'docx') {
        setIsExporting(true);
        setExportStatus('Packaging Doc...');
        
        const children = [
            new Paragraph({
                text: title,
                heading: HeadingLevel.TITLE,
                alignment: AlignmentType.CENTER,
                spacing: { after: 400 }
            }),
            ...content.split('\n').map(l => new Paragraph({ 
                children: [new TextRun({ text: l, size: 24, font: "Times New Roman" })], // 24 = 12pt
                spacing: { after: 200 }
            }))
        ];

        if (comments.length > 0) {
            children.push(new Paragraph({ 
                text: "Margin Notes", 
                heading: HeadingLevel.HEADING_1,
                pageBreakBefore: true
            }));
            comments.forEach(c => {
                children.push(new Paragraph({
                    children: [
                        new TextRun({ text: `[${new Date(c.timestamp).toLocaleTimeString()}] `, bold: true }),
                        new TextRun({ text: `"${c.originalText}"`, italics: true }),
                        new TextRun({ text: ` - ${c.text}` })
                    ],
                    spacing: { after: 120 }
                }));
            });
        }

        const doc = new Document({ 
          sections: [{ 
            properties: {
              page: {
                margin: {
                  top: 1440, // 1 inch
                  right: 1440,
                  bottom: 1440,
                  left: 1440,
                },
              },
            },
            footers: {
              default: new Footer({
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                      new TextRun({ text: `Created with Lumina AI • ${new Date().getFullYear()}`, size: 16, color: "888888" })
                    ],
                  }),
                ],
              }),
            },
            children: children
          }] 
        });
        const blob = await Packer.toBlob(doc);
        downloadBlob(blob, `${filename}.docx`);
      } else if (format === 'md') {
        let mdContent = `# ${title}\n\n${content}`;
        if (comments.length > 0) {
            mdContent += `\n\n## Margin Notes\n\n${comments.map(c => `- **${c.originalText}**: ${c.text}`).join('\n')}`;
        }
        const blob = new Blob([mdContent], { type: 'text/markdown' });
        downloadBlob(blob, `${filename}.md`);
      } else {
        let txtContent = content;
        if (comments.length > 0) {
            txtContent += `\n\n--- MARGIN NOTES ---\n${comments.map(c => `[${new Date(c.timestamp).toLocaleTimeString()}] "${c.originalText}": ${c.text}`).join('\n')}`;
        }
        const blob = new Blob([txtContent], { type: 'text/plain' });
        downloadBlob(blob, `${filename}.txt`);
      }
    } catch (e) {
      console.error("Export failed", e);
      alert("Export failed. Please try again.");
    } finally {
      setIsExporting(false);
      setExportStatus('');
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target?.result as string;
      
      const newDraft: Draft = {
        title: file.name.replace(/\.(txt|md)$/i, ''),
        content: text,
        tone: 'memoir',
        wordCount: text.trim().split(/\s+/).length,
        updatedAt: Date.now()
      };
      
      const id = await db.drafts.add(newDraft);
      loadDraft({ ...newDraft, id: Number(id) });
      
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsText(file);
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

  // Echo Mode Handling
  const handleEchoEnd = (prose: string) => {
    setShowEcho(false);
    if (prose.trim()) {
      const newContent = content + "\n\n" + prose;
      setContent(newContent);
      pushToHistory(newContent, suggestions, comments);
    }
  };

  const EXPORT_OPTIONS = [
    { 
      id: 'pdf', 
      label: 'Publisher PDF', 
      sub: 'With AI Cover Art',
      icon: <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg> 
    },
    { 
      id: 'epub', 
      label: 'eBook EPUB', 
      sub: 'For Kindle/Apple',
      icon: <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path></svg>
    },
    { 
      id: 'docx', 
      label: 'Word Document', 
      sub: '.docx format',
      icon: <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
    },
    { 
      id: 'md', 
      label: 'Markdown', 
      sub: 'For editors',
      icon: <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path></svg>
    },
    { 
      id: 'txt', 
      label: 'Plain Text', 
      sub: 'Universal',
      icon: <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h7"></path></svg>
    },
    { 
      id: 'copy', 
      label: 'Clipboard', 
      sub: 'Copy text',
      icon: <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>
    }
  ];

  return (
    <div className="min-h-screen bg-[#fafafa]">
      <nav className={`fixed top-0 inset-x-0 h-24 flex items-center justify-between px-6 md:px-16 z-30 pointer-events-none transition-all duration-700 ${zenMode ? 'opacity-0 -translate-y-20' : 'opacity-100 translate-y-0'}`}>
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
        
        <div className="flex items-center gap-3 md:gap-4 pointer-events-auto">
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileImport} 
            accept=".txt,.md" 
            className="hidden" 
          />
          <button 
            onClick={handleImportClick}
            className="group flex items-center gap-2 px-4 py-3 bg-white border border-gray-100 rounded-[1.25rem] shadow-sm text-[10px] font-black uppercase tracking-[0.2em] hover:shadow-md transition-all active:scale-95 text-gray-500 hover:text-blue-600"
            title="Import Document"
          >
             <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg>
             <span className="hidden md:inline">Import</span>
          </button>

          <div className="relative" ref={exportMenuRef}>
            <button 
              onClick={() => setShowExportMenu(!showExportMenu)} 
              disabled={isExporting}
              className="group flex items-center gap-2 md:gap-3 px-6 py-3 bg-white border border-gray-100 rounded-[1.25rem] shadow-sm text-[10px] font-black uppercase tracking-[0.2em] hover:shadow-md transition-all active:scale-95 disabled:opacity-50 min-w-[140px] justify-center"
            >
              <span className="hidden md:inline">{isExporting ? (exportStatus || 'Generating...') : 'Export Artifact'}</span>
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
                    className="w-full text-left px-6 py-4 hover:bg-gray-50 hover:text-blue-600 transition-colors flex items-center gap-4 group border-b border-gray-50 last:border-0"
                  >
                    <div className="w-8 h-8 rounded-full bg-white border border-gray-100 flex items-center justify-center group-hover:scale-110 transition-transform shadow-sm">
                      {opt.icon}
                    </div>
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-widest text-gray-900 group-hover:text-blue-600">{opt.label}</div>
                      <div className="text-[9px] text-gray-400 font-medium">{opt.sub}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* Archive / Project Manager */}
      <Archive 
        isOpen={showArchive} 
        onClose={() => setShowArchive(false)} 
        onSelectDraft={handleSelectDraft}
        currentDraftId={currentDraftId}
      />

      <div className={`transition-all duration-700 ${zenMode ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        <Sidebar 
          tone={tone} setTone={setTone}
          onDraftGenerated={(c) => { setContent(c); pushToHistory(c, suggestions, comments); }} 
          isProcessing={isProcessing} setIsProcessing={setIsProcessing} 
          content={content} suggestions={suggestions} setSuggestions={setSuggestions}
          onApplyAll={() => {}}
          onStartInterview={handleStartInterview}
          onStartEcho={() => setShowEcho(true)}
          currentDraftId={currentDraftId}
        />
      </div>

      {/* Live Interview Room Overlay */}
      <InterviewRoom 
        isOpen={showInterview} 
        onClose={handleInterviewEnd}
        systemInstruction={interviewInstruction}
      />

      {/* Echo Mode Overlay */}
      <EchoSession
        isOpen={showEcho}
        onClose={handleEchoEnd}
        tone={tone}
      />

      <main className={`transition-all duration-500 ${showArchive || showInterview || showEcho ? 'scale-95 blur-sm' : 'scale-100 blur-0'}`}>
        <Editor 
          content={content} tone={tone} 
          onChange={setContent}
          isProcessing={isProcessing} setIsProcessing={setIsProcessing} 
          suggestions={suggestions} setSuggestions={setSuggestions}
          comments={comments} setComments={setComments}
          onApplyAll={() => {}} undo={undo} redo={redo}
          canUndo={historyIndex > 0} canRedo={historyIndex < history.length - 1}
          pushToHistory={pushToHistory}
          zenMode={zenMode}
        />
      </main>

      {/* Zen Mode Toggle & Status Footer */}
      <div className={`fixed bottom-12 left-6 md:left-16 flex items-center gap-6 md:gap-10 z-30 transition-all duration-700 ${zenMode ? 'opacity-20 hover:opacity-100' : 'opacity-100'}`}>
        <button 
          onClick={() => setZenMode(!zenMode)} 
          className="flex items-center gap-2 group" 
          title={zenMode ? "Exit Zen Mode" : "Enter Zen Mode"}
        >
           <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${zenMode ? 'bg-[#3d3d3d] text-[#fdfbf7]' : 'bg-gray-200 text-gray-500 hover:bg-gray-300'}`}>
             {zenMode ? (
               <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
             ) : (
               <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"></path></svg>
             )}
           </div>
           {!zenMode && <span className="text-[9px] font-black uppercase tracking-widest text-gray-400 group-hover:text-gray-600 transition-colors">Zen Mode</span>}
        </button>

        {!zenMode && (
          <>
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
          </>
        )}
      </div>
    </div>
  );
};

export default App;
