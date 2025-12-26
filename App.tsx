
import React, { useState, useEffect } from 'react';
import Editor from './components/Editor';
import Sidebar from './components/Sidebar';
import { WritingTone } from './types';

const App: React.FC = () => {
  const [content, setContent] = useState(() => localStorage.getItem('lumina-content') || '');
  const [tone, setTone] = useState<WritingTone>(() => (localStorage.getItem('lumina-tone') as WritingTone) || 'creative');
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    localStorage.setItem('lumina-content', content);
  }, [content]);

  useEffect(() => {
    localStorage.setItem('lumina-tone', tone);
  }, [tone]);

  return (
    <div className="min-h-screen bg-[#fafafa]">
      {/* Dynamic Header */}
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
        
        <div className="flex items-center gap-8 pointer-events-auto">
          <div className="flex flex-col items-end">
            <span className="text-[9px] font-black text-gray-300 uppercase tracking-widest mb-0.5">Session Pulse</span>
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-gray-900">{content.split(/\s+/).filter(Boolean).length}</span>
              <span className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter">Words Crafted</span>
            </div>
          </div>
          <button 
            onClick={() => {
              const blob = new Blob([content], { type: 'text/plain' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `lumina-draft-${new Date().toISOString().slice(0,10)}.txt`;
              a.click();
            }}
            className="px-8 py-3.5 bg-white border border-gray-100 rounded-[1.25rem] shadow-sm hover:shadow-xl hover:-translate-y-0.5 transition-all text-[10px] font-black text-gray-800 uppercase tracking-[0.2em]"
          >
            Export Artifact
          </button>
        </div>
      </nav>

      {/* Unified Control Plane */}
      <Sidebar 
        tone={tone}
        setTone={setTone}
        onDraftGenerated={setContent} 
        isProcessing={isProcessing} 
        setIsProcessing={setIsProcessing} 
        content={content}
      />

      <main className="transition-all duration-1000">
        <Editor 
          content={content} 
          tone={tone}
          onChange={setContent} 
          isProcessing={isProcessing} 
          setIsProcessing={setIsProcessing} 
        />
      </main>

      {/* Status Footer */}
      <div className="fixed bottom-12 left-16 flex items-center gap-10">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full transition-colors duration-500 ${isProcessing ? 'bg-blue-600 animate-ping' : 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.4)]'}`}></div>
          <span className="text-[9px] font-black text-gray-400 uppercase tracking-[0.2em]">{isProcessing ? 'Gemini Synchronizing' : 'Core Ready'}</span>
        </div>
        <div className="text-[9px] font-black text-gray-300 uppercase tracking-[0.2em] hidden sm:block">
          Intelligence: Gemini 3 Flash / Pro Hybrid
        </div>
      </div>

      {/* Ambient Visuals */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.03] bg-[radial-gradient(#000_1px,transparent_1px)] [background-size:32px_32px]"></div>
    </div>
  );
};

export default App;
