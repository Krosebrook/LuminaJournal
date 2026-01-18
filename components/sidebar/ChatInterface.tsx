
import React, { useState } from 'react';
import { ChatMessage, UserProfile } from '../../types';
import { chatWithContext } from '../../services/geminiService';

interface ChatInterfaceProps {
  content: string;
  activeProfile: UserProfile | null;
  setIsProcessing: (v: boolean) => void;
  isProcessing: boolean;
  onStartInterview: (instruction: string) => void;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({
  content,
  activeProfile,
  setIsProcessing,
  isProcessing,
  onStartInterview
}) => {
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [useSearch, setUseSearch] = useState(false);

  const handleChat = async () => {
    if (!chatInput.trim()) return;
    const userMsg: ChatMessage = { role: 'user', text: chatInput };
    setChatHistory(prev => [...prev, userMsg]);
    setChatInput('');
    setIsProcessing(true);
    try {
      let modelResponse = "";
      const res = await chatWithContext(
        content, 
        chatHistory, 
        chatInput, 
        (chunk) => { modelResponse = chunk; },
        activeProfile?.systemInstruction,
        useSearch
      );
      
      setChatHistory(prev => [...prev, { 
        role: 'model', 
        text: res.text, 
        sources: res.sources 
      }]);
    } catch (e) { console.error(e); }
    finally { setIsProcessing(false); }
  };

  return (
    <div className="flex flex-col h-full space-y-4">
      <div className="flex-1 space-y-4 overflow-y-auto pr-2 custom-scrollbar">
        {/* Interview Trigger Button */}
        <div className="bg-gradient-to-r from-indigo-500 to-blue-600 rounded-3xl p-6 text-white shadow-lg mx-2 mb-4 relative overflow-hidden group cursor-pointer" onClick={() => onStartInterview(activeProfile?.systemInstruction || "")}>
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2 group-hover:scale-110 transition-transform"></div>
          <div className="relative z-10">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path></svg>
                </div>
                <h3 className="font-bold text-sm">Memory Interview</h3>
              </div>
              <p className="text-[11px] text-blue-100 leading-relaxed mb-3">
                Step into the studio. Have a voice conversation with {activeProfile?.name || "The Biographer"} to unearth details.
              </p>
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-white/80 group-hover:text-white transition-colors">
                <span>Start Session</span>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8l4 4m0 0l-4 4m4-4H3"></path></svg>
              </div>
          </div>
        </div>

        {chatHistory.map((msg, i) => (
          <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div className={`max-w-[85%] p-4 rounded-3xl text-sm ${msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-white border border-gray-100'}`}>
              {msg.text}
            </div>
            {msg.sources && msg.sources.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1 max-w-[85%] px-2">
                  {msg.sources.map((s, idx) => (
                    <a key={idx} href={s.web?.uri} target="_blank" rel="noreferrer" className="text-[8px] font-bold text-blue-500 bg-blue-50 px-2 py-0.5 rounded-full hover:bg-blue-100 transition-colors truncate max-w-[120px]">
                      {s.web?.title || 'Source'}
                    </a>
                  ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="space-y-3 pt-4">
          <div className="flex items-center gap-2 px-1">
            <button 
              onClick={() => setUseSearch(!useSearch)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest transition-all ${useSearch ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400 hover:text-gray-600'}`}
            >
              <div className={`w-1 h-1 rounded-full ${useSearch ? 'bg-blue-600 animate-pulse' : 'bg-gray-400'}`}></div>
              Search Web Context
            </button>
          </div>
          <div className="relative">
            <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleChat()} placeholder="Ask for counsel or research prompts..." className="w-full bg-white border border-gray-200 rounded-2xl py-4 px-6 text-sm outline-none pr-14 shadow-sm focus:ring-2 ring-blue-50 transition-all" />
            <button onClick={handleChat} disabled={isProcessing || !chatInput.trim()} className="absolute right-3 top-1/2 -translate-y-1/2 p-2 bg-blue-600 text-white rounded-xl shadow-lg disabled:opacity-30 hover:scale-105 active:scale-95 transition-all"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M14 5l7 7-7 7M3 12h18"></path></svg></button>
          </div>
      </div>
    </div>
  );
};

export default ChatInterface;
