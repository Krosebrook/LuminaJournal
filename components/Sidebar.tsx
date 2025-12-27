
import React, { useState } from 'react';
import { generateDraftStream, chatWithContext } from '../services/geminiService';
import { FileAttachment, WritingTone, ChatMessage, Suggestion } from '../types';

interface SidebarProps {
  tone: WritingTone;
  setTone: (t: WritingTone) => void;
  onDraftGenerated: (content: string) => void;
  isProcessing: boolean;
  setIsProcessing: (v: boolean) => void;
  content: string;
  suggestions: Suggestion[];
  setSuggestions: React.Dispatch<React.SetStateAction<Suggestion[]>>;
  onApplyAll: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ 
  tone, 
  setTone, 
  onDraftGenerated, 
  isProcessing, 
  setIsProcessing, 
  content,
  suggestions,
  setSuggestions,
  onApplyAll
}) => {
  const [prompt, setPrompt] = useState('');
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'config' | 'chat'>('config');
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);

  const tones: { id: WritingTone; label: string; icon: string }[] = [
    { id: 'creative', label: 'Artistic', icon: '🎨' },
    { id: 'professional', label: 'Executive', icon: '💼' },
    { id: 'punchy', label: 'Direct', icon: '💥' },
    { id: 'academic', label: 'Learned', icon: '📜' },
    { id: 'casual', label: 'Human', icon: '👋' }
  ];

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file: File) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        setAttachments(prev => [...prev, {
          name: file.name,
          type: file.type,
          data: event.target?.result as string
        }]);
      };
      reader.readAsDataURL(file);
    });
  };

  const handleDraft = async () => {
    if (!prompt.trim()) return;
    setIsProcessing(true);
    setIsOpen(false);
    try {
      await generateDraftStream(prompt, attachments, tone, (fullText) => {
        onDraftGenerated(fullText);
      });
      setPrompt('');
      setAttachments([]);
    } catch (error) {
      console.error(error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleChat = async () => {
    if (!chatInput.trim()) return;
    const userMsg: ChatMessage = { role: 'user', text: chatInput };
    setChatHistory(prev => [...prev, userMsg]);
    setChatInput('');
    setIsProcessing(true);
    
    try {
      let modelResponse = "";
      await chatWithContext(content, chatHistory, chatInput, (chunk) => {
        modelResponse = chunk;
      });
      setChatHistory(prev => [...prev, { role: 'model', text: modelResponse }]);
    } catch (e) {
      console.error(e);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <>
      <div className="fixed left-8 top-8 z-40 flex flex-col gap-4">
        <button 
          onClick={() => { setIsOpen(true); setActiveTab('config'); }}
          className="p-5 glass rounded-full shadow-xl hover:scale-110 hover:shadow-2xl transition-all text-gray-900 border border-white group"
        >
          <svg className="w-6 h-6 group-hover:rotate-45 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"></path></svg>
        </button>
        <button 
          onClick={() => { setIsOpen(true); setActiveTab('chat'); }}
          className="p-5 glass rounded-full shadow-xl hover:scale-110 hover:shadow-2xl transition-all text-blue-600 border border-white group"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg>
        </button>
      </div>

      <div className={`fixed inset-y-0 left-0 z-50 w-full sm:w-[450px] glass shadow-2xl transform transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] border-r border-white/40 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-10 flex flex-col h-full overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex gap-4">
              <button 
                onClick={() => setActiveTab('config')}
                className={`text-[10px] font-black uppercase tracking-widest pb-1 border-b-2 transition-all ${activeTab === 'config' ? 'border-blue-600 text-gray-900' : 'border-transparent text-gray-400'}`}
              >
                Collaborator
              </button>
              <button 
                onClick={() => setActiveTab('chat')}
                className={`text-[10px] font-black uppercase tracking-widest pb-1 border-b-2 transition-all ${activeTab === 'chat' ? 'border-blue-600 text-gray-900' : 'border-transparent text-gray-400'}`}
              >
                Counsel
              </button>
            </div>
            <button onClick={() => setIsOpen(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
              <svg className="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto pr-2 space-y-10">
            {activeTab === 'config' ? (
              <>
                {/* BATCH ACTION IN SIDEBAR */}
                {suggestions.length > 0 && (
                  <section className="animate-in slide-in-from-top-4 duration-500">
                    <button 
                      onClick={onApplyAll}
                      className="w-full flex items-center justify-center gap-3 px-6 py-5 bg-blue-600 text-white rounded-[1.5rem] shadow-xl shadow-blue-500/20 hover:bg-blue-700 transition-all group active:scale-[0.98]"
                    >
                      <svg className="w-4 h-4 text-blue-200 group-hover:rotate-12 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                      <span className="text-[10px] font-black uppercase tracking-[0.2em]">Accept All Refinements</span>
                    </button>
                  </section>
                )}

                <section>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-[0.3em] mb-4">Sonic Profile</label>
                  <div className="grid grid-cols-2 gap-3">
                    {tones.map(t => (
                      <button
                        key={t.id}
                        onClick={() => setTone(t.id)}
                        className={`flex items-center gap-3 p-4 rounded-3xl border transition-all ${tone === t.id ? 'bg-blue-600 border-blue-600 text-white shadow-xl shadow-blue-500/30' : 'bg-white/40 border-gray-100 text-gray-600 hover:border-blue-200'}`}
                      >
                        <span className="text-xl">{t.icon}</span>
                        <span className="text-xs font-bold uppercase tracking-tight">{t.label}</span>
                      </button>
                    ))}
                  </div>
                </section>

                <section>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-[0.3em] mb-4">The Objective</label>
                  <textarea 
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Brief your partner on the scope, narrative goal, or specific constraints..."
                    className="w-full h-48 bg-white/50 border border-gray-100 rounded-[2rem] p-6 text-sm focus:ring-4 focus:ring-blue-500/10 focus:border-blue-400 transition-all outline-none resize-none shadow-inner"
                  />
                </section>

                <section>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-[0.3em] mb-4">Knowledge Base</label>
                  <div className="grid grid-cols-1 gap-2">
                    {attachments.map((file, i) => (
                      <div key={i} className="flex items-center justify-between bg-blue-50/50 p-4 rounded-2xl border border-blue-100">
                        <div className="flex items-center gap-3 overflow-hidden">
                          <div className="p-2 bg-blue-100 rounded-lg text-blue-600">
                             <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                          </div>
                          <span className="text-xs font-bold text-blue-800 truncate">{file.name}</span>
                        </div>
                        <button onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))} className="text-blue-300 hover:text-red-500 transition-colors">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                        </button>
                      </div>
                    ))}
                    <label className="flex flex-col items-center justify-center gap-3 w-full p-10 border-2 border-dashed border-gray-200 rounded-[2.5rem] cursor-pointer hover:border-blue-400 hover:bg-blue-50/20 transition-all group">
                      <input type="file" className="hidden" multiple onChange={handleFileChange} />
                      <div className="p-4 bg-gray-50 rounded-full group-hover:bg-blue-100 transition-colors">
                        <svg className="w-6 h-6 text-gray-400 group-hover:text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg>
                      </div>
                      <span className="text-xs font-black text-gray-400 uppercase tracking-widest group-hover:text-blue-600">Upload Reference</span>
                    </label>
                  </div>
                </section>
              </>
            ) : (
              <div className="flex flex-col h-full">
                <div className="flex-1 space-y-4 mb-4">
                  {chatHistory.length === 0 && (
                    <div className="text-center py-20 opacity-40">
                       <p className="text-sm italic">"Does this transition feel natural?"</p>
                       <p className="text-sm italic mt-2">"Can you research more about X?"</p>
                    </div>
                  )}
                  {chatHistory.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] p-4 rounded-3xl text-sm ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-br-none' : 'bg-white border border-gray-100 text-gray-800 rounded-bl-none shadow-sm'}`}>
                        {msg.text}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="relative pb-4">
                   <input 
                     value={chatInput}
                     onChange={(e) => setChatInput(e.target.value)}
                     onKeyDown={(e) => e.key === 'Enter' && handleChat()}
                     placeholder="Ask about your draft..."
                     className="w-full bg-white border border-gray-200 rounded-2xl py-4 px-6 text-sm focus:ring-4 focus:ring-blue-500/10 focus:border-blue-400 outline-none pr-14 transition-all"
                   />
                   <button 
                     onClick={handleChat}
                     disabled={isProcessing || !chatInput.trim()}
                     className="absolute right-3 top-1/2 -translate-y-1/2 p-2 bg-blue-600 text-white rounded-xl shadow-lg disabled:opacity-30"
                   >
                     <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M14 5l7 7-7 7M3 12h18"></path></svg>
                   </button>
                </div>
              </div>
            )}
          </div>

          {activeTab === 'config' && (
            <div className="mt-8">
              <button 
                disabled={isProcessing || !prompt.trim()}
                onClick={handleDraft}
                className="w-full py-6 bg-gray-900 text-white rounded-[2rem] font-black text-[10px] uppercase tracking-[0.3em] hover:bg-black hover:shadow-2xl transition-all disabled:opacity-50 shadow-xl"
              >
                Summon Initial Flow
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default Sidebar;
