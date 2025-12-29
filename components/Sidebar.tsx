
import React, { useState } from 'react';
import { generateDraftStream, chatWithContext } from '../services/geminiService';
import { FileAttachment, WritingTone, ChatMessage, Suggestion } from '../types';
import Terminal from './Terminal';

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
  const [activeTab, setActiveTab] = useState<'config' | 'chat' | 'terminal'>('config');
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
      const supported = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
      if (!supported.includes(file.type)) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        setAttachments(prev => [...prev, { name: file.name, type: file.type, data: event.target?.result as string }]);
      };
      reader.readAsDataURL(file);
    });
  };

  const handleDraft = async () => {
    if (!prompt.trim()) return;
    setIsProcessing(true);
    setIsOpen(false);
    try {
      await generateDraftStream(prompt, attachments, tone, onDraftGenerated);
      setPrompt('');
      setAttachments([]);
    } catch (error) { console.error(error); }
    finally { setIsProcessing(false); }
  };

  const handleChat = async () => {
    if (!chatInput.trim()) return;
    const userMsg: ChatMessage = { role: 'user', text: chatInput };
    setChatHistory(prev => [...prev, userMsg]);
    setChatInput('');
    setIsProcessing(true);
    try {
      let modelResponse = "";
      await chatWithContext(content, chatHistory, chatInput, (chunk) => { modelResponse = chunk; });
      setChatHistory(prev => [...prev, { role: 'model', text: modelResponse }]);
    } catch (e) { console.error(e); }
    finally { setIsProcessing(false); }
  };

  return (
    <>
      <div className="fixed left-8 top-8 z-40 flex flex-col gap-4">
        <button onClick={() => { setIsOpen(true); setActiveTab('config'); }} className="p-5 glass rounded-full shadow-xl hover:scale-110 text-gray-900 border border-white group">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"></path></svg>
        </button>
        <button onClick={() => { setIsOpen(true); setActiveTab('chat'); }} className="p-5 glass rounded-full shadow-xl hover:scale-110 text-blue-600 border border-white">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg>
        </button>
        <button onClick={() => { setIsOpen(true); setActiveTab('terminal'); }} className="p-5 glass rounded-full shadow-xl hover:scale-110 text-emerald-600 border border-white">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
        </button>
      </div>

      <div className={`fixed inset-y-0 left-0 z-50 w-full sm:w-[480px] glass shadow-2xl transform transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] border-r border-white/40 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-10 flex flex-col h-full overflow-hidden">
          <div className="flex items-center justify-between mb-8">
            <div className="flex gap-4">
              {['config', 'chat', 'terminal'].map((t) => (
                <button 
                  key={t}
                  onClick={() => setActiveTab(t as any)}
                  className={`text-[10px] font-black uppercase tracking-widest pb-1 border-b-2 transition-all ${activeTab === t ? 'border-blue-600 text-gray-900' : 'border-transparent text-gray-400'}`}
                >
                  {t}
                </button>
              ))}
            </div>
            <button onClick={() => setIsOpen(false)} className="p-2 hover:bg-gray-100 rounded-full"><svg className="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
          </div>

          <div className="flex-1 overflow-y-auto pr-2">
            {activeTab === 'config' && (
              <div className="space-y-10">
                 {suggestions.length > 0 && (
                   <button onClick={onApplyAll} className="w-full py-5 bg-blue-600 text-white rounded-[1.5rem] shadow-xl text-[10px] font-black uppercase tracking-[0.2em]">Accept All Refinements</button>
                 )}
                 <section>
                   <label className="block text-[10px] font-black text-gray-400 uppercase tracking-[0.3em] mb-4">Sonic Profile</label>
                   <div className="grid grid-cols-2 gap-3">
                     {tones.map(t => (
                       <button key={t.id} onClick={() => setTone(t.id)} className={`flex items-center gap-3 p-4 rounded-3xl border transition-all ${tone === t.id ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white/40 border-gray-100'}`}><span className="text-xl">{t.icon}</span><span className="text-xs font-bold">{t.label}</span></button>
                     ))}
                   </div>
                 </section>
                 <section>
                   <label className="block text-[10px] font-black text-gray-400 uppercase tracking-[0.3em] mb-4">The Objective</label>
                   <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Draft instructions..." className="w-full h-48 bg-white/50 border border-gray-100 rounded-[2rem] p-6 text-sm outline-none resize-none shadow-inner" />
                 </section>
                 <section>
                    <label className="flex flex-col items-center justify-center gap-3 w-full p-10 border-2 border-dashed border-gray-200 rounded-[2.5rem] cursor-pointer hover:border-blue-400 transition-all">
                      <input type="file" className="hidden" multiple accept=".pdf,image/*" onChange={handleFileChange} />
                      <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Add Knowledge</span>
                    </label>
                 </section>
                 <button disabled={isProcessing || !prompt.trim()} onClick={handleDraft} className="w-full py-6 bg-gray-900 text-white rounded-[2rem] font-black text-[10px] uppercase tracking-[0.3em] shadow-xl">Summon Flow</button>
              </div>
            )}

            {activeTab === 'chat' && (
              <div className="flex flex-col h-full space-y-4">
                <div className="flex-1 space-y-4 overflow-y-auto pr-2">
                  {chatHistory.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] p-4 rounded-3xl text-sm ${msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-white border border-gray-100'}`}>{msg.text}</div>
                    </div>
                  ))}
                </div>
                <div className="relative pt-4">
                   <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleChat()} placeholder="Ask counsel..." className="w-full bg-white border border-gray-200 rounded-2xl py-4 px-6 text-sm outline-none pr-14" />
                   <button onClick={handleChat} disabled={isProcessing || !chatInput.trim()} className="absolute right-3 top-1/2 -translate-y-1/2 p-2 bg-blue-600 text-white rounded-xl shadow-lg disabled:opacity-30"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M14 5l7 7-7 7M3 12h18"></path></svg></button>
                </div>
              </div>
            )}

            {activeTab === 'terminal' && <Terminal />}
          </div>
        </div>
      </div>
    </>
  );
};

export default Sidebar;
