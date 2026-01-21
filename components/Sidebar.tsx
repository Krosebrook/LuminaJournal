
import React, { useState } from 'react';
import { FileAttachment, WritingTone, Suggestion, UserProfile } from '../types';
import Terminal from './Terminal';
import ProfileManager from './sidebar/ProfileManager';
import ChatInterface from './sidebar/ChatInterface';
import LatticeView from './sidebar/LatticeView';
import MediaStudio from './sidebar/MediaStudio';
import AnalyticsView from './sidebar/AnalyticsView';
import JSZip from 'jszip';
import { arrayBufferToBase64 } from '../services/audioUtils';

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
  onStartInterview: (instruction: string) => void;
  onStartEcho: () => void;
  currentDraftId?: number;
}

const Sidebar: React.FC<SidebarProps> = ({ 
  tone, 
  setTone, 
  onDraftGenerated, 
  isProcessing, 
  setIsProcessing, 
  content,
  onStartInterview,
  onStartEcho,
  currentDraftId
}) => {
  const [prompt, setPrompt] = useState('');
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'config' | 'chat' | 'media' | 'lattice' | 'analytics' | 'terminal'>('config');
  const [activeProfile, setActiveProfile] = useState<UserProfile | null>(null);

  const handleProfileSelect = (p: UserProfile) => {
    setActiveProfile(p);
    setTone(p.tone);
  };

  const processFile = async (file: File): Promise<FileAttachment | null> => {
    // Text Files
    if (file.type.startsWith('text/') || file.name.match(/\.(md|json|csv|xml|js|ts|tsx|txt)$/i)) {
       const text = await file.text();
       return { name: file.name, type: 'text/plain', data: text };
    }
    // Supported Binary Files
    const supportedBinary = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
    if (supportedBinary.includes(file.type) || file.name.endsWith('.pdf')) {
       const buffer = await file.arrayBuffer();
       const base64 = arrayBufferToBase64(buffer);
       return { name: file.name, type: file.type || 'application/pdf', data: base64 };
    }
    return null;
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    
    setIsProcessing(true); // Indicate loading state for large zips
    const newAttachments: FileAttachment[] = [];

    // Fix: Use index loop to ensure type safety for FileList access
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.name.endsWith('.zip')) {
        try {
          const zip = new JSZip();
          const loadedZip = await zip.loadAsync(file);
          
          // Iterate over all files in zip
          const entries = Object.entries(loadedZip.files);
          for (const [relativePath, zipEntry] of entries) {
             // Cast to any to handle potential type issues with JSZip types
             const entry = zipEntry as any;
             if (entry.dir || relativePath.startsWith('__MACOSX') || relativePath.includes('.DS_Store')) continue;
             
             // Extract based on type
             const fileName = entry.name.split('/').pop() || entry.name;
             
             // Check if it looks like an image or text
             if (fileName.match(/\.(png|jpg|jpeg|webp|pdf)$/i)) {
                 const base64 = await entry.async('base64');
                 // Determine mime type roughly
                 const ext = fileName.split('.').pop()?.toLowerCase();
                 let mime = 'application/octet-stream';
                 if (ext === 'pdf') mime = 'application/pdf';
                 else if (ext === 'png') mime = 'image/png';
                 else if (ext === 'jpg' || ext === 'jpeg') mime = 'image/jpeg';
                 else if (ext === 'webp') mime = 'image/webp';

                 newAttachments.push({ name: fileName, type: mime, data: base64 });
             } else if (fileName.match(/\.(txt|md|json|csv|js|ts)$/i)) {
                 const text = await entry.async('string');
                 newAttachments.push({ name: fileName, type: 'text/plain', data: text });
             }
          }
        } catch (err) {
          console.error("Error unzipping", err);
          alert(`Failed to extract ${file.name}`);
        }
      } else {
        const attachment = await processFile(file);
        if (attachment) newAttachments.push(attachment);
      }
    }
    
    setAttachments(prev => [...prev, ...newAttachments]);
    setIsProcessing(false);
  };

  return (
    <>
      <div className="fixed left-8 top-8 z-40 flex flex-col gap-4">
        <button onClick={() => { setIsOpen(true); setActiveTab('config'); }} className="p-5 glass rounded-full shadow-xl hover:scale-110 text-gray-900 border border-white group relative">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"></path></svg>
          {activeProfile && <span className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full border-2 border-white animate-pulse"></span>}
        </button>
        <button onClick={() => { setIsOpen(true); setActiveTab('chat'); }} className="p-5 glass rounded-full shadow-xl hover:scale-110 text-blue-600 border border-white">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg>
        </button>
        <button onClick={() => { setIsOpen(true); setActiveTab('analytics'); }} className="p-5 glass rounded-full shadow-xl hover:scale-110 text-red-600 border border-white">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
        </button>
        <button onClick={() => { setIsOpen(true); setActiveTab('media'); }} className="p-5 glass rounded-full shadow-xl hover:scale-110 text-pink-600 border border-white">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
        </button>
        <button onClick={() => { setIsOpen(true); setActiveTab('lattice'); }} className="p-5 glass rounded-full shadow-xl hover:scale-110 text-purple-600 border border-white">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"></path></svg>
        </button>
        <button onClick={() => { setIsOpen(true); setActiveTab('terminal'); }} className="p-5 glass rounded-full shadow-xl hover:scale-110 text-emerald-600 border border-white">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
        </button>
      </div>

      <div className={`fixed inset-y-0 left-0 z-50 w-full sm:w-[480px] glass shadow-2xl transform transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] border-r border-white/40 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-10 flex flex-col h-full overflow-hidden">
          <div className="flex items-center justify-between mb-8">
            <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-none">
              {['config', 'chat', 'analytics', 'media', 'lattice', 'terminal'].map((t) => (
                <button 
                  key={t}
                  onClick={() => setActiveTab(t as any)}
                  className={`text-[10px] font-black uppercase tracking-widest pb-1 border-b-2 transition-all shrink-0 ${activeTab === t ? 'border-blue-600 text-gray-900' : 'border-transparent text-gray-400'}`}
                >
                  {t}
                </button>
              ))}
            </div>
            <button onClick={() => setIsOpen(false)} className="p-2 hover:bg-gray-100 rounded-full"><svg className="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
          </div>

          <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
            {activeTab === 'config' && (
              <>
                 {/* Echo Mode Trigger */}
                 <div onClick={onStartEcho} className="mb-8 cursor-pointer group bg-gradient-to-br from-gray-900 to-black p-6 rounded-[2rem] shadow-2xl text-white relative overflow-hidden hover:scale-[1.02] transition-transform">
                   <div className="absolute top-0 right-0 w-32 h-32 bg-blue-600 rounded-full blur-[60px] opacity-40 group-hover:opacity-60 transition-opacity"></div>
                   <div className="relative z-10 flex items-center justify-between">
                     <div>
                       <div className="flex items-center gap-2 mb-2">
                         <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></span>
                         <span className="text-[10px] font-black uppercase tracking-widest text-blue-400">Echo Mode</span>
                       </div>
                       <h3 className="font-serif text-xl font-bold">Walk & Talk</h3>
                       <p className="text-[11px] text-gray-400 mt-1 max-w-[180px]">Convert ramblings into memoir prose automatically.</p>
                     </div>
                     <div className="w-12 h-12 bg-white/10 rounded-full flex items-center justify-center border border-white/10 group-hover:bg-blue-600 group-hover:border-blue-500 transition-colors">
                       <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path></svg>
                     </div>
                   </div>
                 </div>

                 <ProfileManager
                  activeProfile={activeProfile}
                  onProfileSelect={handleProfileSelect}
                  tone={tone}
                  setTone={setTone}
                  prompt={prompt}
                  setPrompt={setPrompt}
                  handleFileChange={handleFileChange}
                  attachments={attachments}
                  isProcessing={isProcessing}
                  handleDraft={async (useThinking) => {
                    if (!prompt.trim()) return;
                    setIsProcessing(true);
                    setIsOpen(false);
                    try {
                      const { generateDraftStream } = await import('../services/geminiService');
                      await generateDraftStream(
                        prompt, 
                        attachments, 
                        tone, 
                        onDraftGenerated, 
                        activeProfile?.systemInstruction,
                        useThinking
                      );
                      setPrompt('');
                      setAttachments([]);
                    } catch (error) { console.error(error); }
                    finally { setIsProcessing(false); }
                  }}
                />
              </>
            )}

            {activeTab === 'chat' && (
              <ChatInterface
                content={content}
                activeProfile={activeProfile}
                setIsProcessing={setIsProcessing}
                isProcessing={isProcessing}
                onStartInterview={onStartInterview}
                attachments={attachments} 
              />
            )}

            {activeTab === 'analytics' && <AnalyticsView content={content} />}

            {activeTab === 'media' && <MediaStudio />}

            {activeTab === 'lattice' && (
              <LatticeView 
                content={content}
                currentDraftId={currentDraftId}
              />
            )}

            {activeTab === 'terminal' && <Terminal />}
          </div>
        </div>
      </div>
    </>
  );
};

export default Sidebar;
