
import React, { useState, useEffect } from 'react';
import { generateDraftStream, chatWithContext } from '../services/geminiService';
import { FileAttachment, WritingTone, ChatMessage, Suggestion, UserProfile } from '../types';
import Terminal from './Terminal';
import { db } from '../lib/db';

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
  onStartInterview: (instruction: string) => void; // New Prop
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
  onApplyAll,
  onStartInterview
}) => {
  const [prompt, setPrompt] = useState('');
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'config' | 'chat' | 'terminal'>('config');
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [useSearch, setUseSearch] = useState(false);

  // Profile Management State
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [activeProfile, setActiveProfile] = useState<UserProfile | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false); // Unified state for Create/Edit visibility
  const [isEditing, setIsEditing] = useState(false);
  const [profileForm, setProfileForm] = useState<Partial<UserProfile>>({ name: '', tone: 'memoir', systemInstruction: '' });

  useEffect(() => {
    loadProfiles();
  }, []);

  const loadProfiles = async () => {
    const allProfiles = await db.profiles.toArray();
    if (allProfiles.length === 0) {
      // Create initial default profile focused on autobiography
      const defaultProfile: UserProfile = {
        name: 'The Biographer',
        tone: 'memoir',
        systemInstruction: 'Act as a professional biographer. Help me dig deeper into my memories. Ask about the smells, the sounds, and how I felt in the moment. Help me find the universal truth in my personal stories.',
        isDefault: true
      };
      const id = await db.profiles.add(defaultProfile);
      const created = { ...defaultProfile, id: Number(id) };
      setProfiles([created]);
      setActiveProfile(created);
      setTone(created.tone);
    } else {
      setProfiles(allProfiles);
      const defaultOne = allProfiles.find(p => p.isDefault) || allProfiles[0];
      setActiveProfile(defaultOne);
      setTone(defaultOne.tone);
    }
  };

  const handleSaveProfile = async () => {
    if (!profileForm.name) return;

    if (isEditing && profileForm.id) {
      // UPDATE
      await db.profiles.update(profileForm.id, {
        name: profileForm.name,
        tone: profileForm.tone,
        systemInstruction: profileForm.systemInstruction
      });

      const updatedProfiles = profiles.map(p => 
        p.id === profileForm.id ? { ...p, ...profileForm } as UserProfile : p
      );
      setProfiles(updatedProfiles);
      
      // Update active profile if we just edited it
      if (activeProfile?.id === profileForm.id) {
        const updated = { ...activeProfile, ...profileForm } as UserProfile;
        setActiveProfile(updated);
        if (updated.tone) setTone(updated.tone);
      }
    } else {
      // CREATE
      const profile: UserProfile = {
        name: profileForm.name,
        tone: profileForm.tone || 'memoir',
        systemInstruction: profileForm.systemInstruction || '',
        isDefault: false
      };
      const id = await db.profiles.add(profile);
      setProfiles([...profiles, { ...profile, id: Number(id) }]);
    }

    resetForm();
  };

  const startCreating = () => {
    setProfileForm({ name: '', tone: 'memoir', systemInstruction: '' });
    setIsEditing(false);
    setIsFormOpen(true);
  };

  const startEditing = (p: UserProfile, e: React.MouseEvent) => {
    e.stopPropagation();
    setProfileForm({ ...p });
    setIsEditing(true);
    setIsFormOpen(true);
  };

  const resetForm = () => {
    setProfileForm({ name: '', tone: 'memoir', systemInstruction: '' });
    setIsEditing(false);
    setIsFormOpen(false);
  };

  const deleteProfile = async (id: number) => {
    if (profiles.length <= 1) {
      alert("You must have at least one companion profile.");
      return; 
    }
    if (confirm("Are you sure you want to delete this companion?")) {
      await db.profiles.delete(id);
      const updated = profiles.filter(p => p.id !== id);
      setProfiles(updated);
      if (activeProfile?.id === id) {
        setActiveProfile(updated[0]);
        setTone(updated[0].tone);
      }
    }
  };

  const selectProfile = (p: UserProfile) => {
    setActiveProfile(p);
    setTone(p.tone);
  };

  const tones: { id: WritingTone; label: string; icon: string }[] = [
    { id: 'memoir', label: 'Memoir', icon: '🕯️' },
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
      await generateDraftStream(
        prompt, 
        attachments, 
        tone, 
        onDraftGenerated, 
        activeProfile?.systemInstruction
      );
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
      let modelSources: any[] | undefined;
      
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
    <>
      <div className="fixed left-8 top-8 z-40 flex flex-col gap-4">
        <button onClick={() => { setIsOpen(true); setActiveTab('config'); }} className="p-5 glass rounded-full shadow-xl hover:scale-110 text-gray-900 border border-white group relative">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"></path></svg>
          {activeProfile && <span className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full border-2 border-white animate-pulse"></span>}
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

          <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
            {activeTab === 'config' && (
              <div className="space-y-10">
                 {/* Profile Section */}
                 <section>
                    <div className="flex items-center justify-between mb-4">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em]">Story Companion</label>
                      <button onClick={() => isFormOpen ? resetForm() : startCreating()} className="text-xs font-bold text-blue-600">
                        {isFormOpen ? 'Cancel' : '+ New'}
                      </button>
                    </div>

                    {isFormOpen ? (
                      <div className="space-y-4 p-6 bg-white/50 rounded-3xl border border-blue-100 animate-in fade-in slide-in-from-top-4">
                        <div className="flex justify-between items-center mb-2">
                           <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">{isEditing ? 'Edit Persona' : 'New Persona'}</span>
                        </div>
                        <input 
                          value={profileForm.name} 
                          onChange={e => setProfileForm({...profileForm, name: e.target.value})} 
                          placeholder="Companion Name (e.g. Life Historian)" 
                          className="w-full bg-white border border-gray-100 rounded-2xl p-3 text-xs outline-none" 
                        />
                        <div className="flex gap-2">
                          {tones.slice(0, 3).map(t => (
                            <button 
                              key={t.id} 
                              onClick={() => setProfileForm({...profileForm, tone: t.id})} 
                              className={`flex-1 p-2 rounded-xl text-[10px] border transition-all ${profileForm.tone === t.id ? 'bg-blue-600 text-white' : 'bg-white text-gray-400'}`}
                            >
                              {t.label}
                            </button>
                          ))}
                        </div>
                        <textarea 
                          value={profileForm.systemInstruction} 
                          onChange={e => setProfileForm({...profileForm, systemInstruction: e.target.value})} 
                          placeholder="How should this companion help you remember?" 
                          className="w-full h-24 bg-white border border-gray-100 rounded-2xl p-3 text-xs outline-none resize-none" 
                        />
                        <button onClick={handleSaveProfile} className="w-full py-3 bg-blue-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 transition-colors">
                          {isEditing ? 'Save Changes' : 'Incept Companion'}
                        </button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-2">
                        {profiles.map(p => (
                          <div 
                            key={p.id} 
                            className={`group relative flex items-center justify-between p-4 rounded-3xl border transition-all cursor-pointer ${activeProfile?.id === p.id ? 'bg-emerald-50 border-emerald-200 ring-2 ring-emerald-100' : 'bg-white/40 border-gray-100 hover:border-blue-200'}`}
                            onClick={() => selectProfile(p)}
                          >
                            <div className="flex items-center gap-3">
                              <span className="text-lg">{tones.find(t => t.id === p.tone)?.icon}</span>
                              <div className="flex flex-col">
                                <span className="text-xs font-bold text-gray-900">{p.name}</span>
                                <span className="text-[9px] text-gray-400 uppercase tracking-tighter">{p.tone}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button 
                                onClick={(e) => startEditing(p, e)}
                                className="p-2 text-gray-300 hover:text-blue-500 transition-all"
                                title="Edit Profile"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                              </button>
                              <button 
                                onClick={(e) => { e.stopPropagation(); p.id && deleteProfile(p.id); }} 
                                className="p-2 text-gray-300 hover:text-red-400 transition-all"
                                title="Delete Profile"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                 </section>

                 <section>
                   <label className="block text-[10px] font-black text-gray-400 uppercase tracking-[0.3em] mb-4">Voice Texture</label>
                   <div className="grid grid-cols-2 gap-3">
                     {tones.map(t => (
                       <button key={t.id} onClick={() => setTone(t.id)} className={`flex items-center gap-3 p-4 rounded-3xl border transition-all ${tone === t.id ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white/40 border-gray-100'}`}><span className="text-xl">{t.icon}</span><span className="text-xs font-bold">{t.label}</span></button>
                     ))}
                   </div>
                 </section>
                 <section>
                   <label className="block text-[10px] font-black text-gray-400 uppercase tracking-[0.3em] mb-4">Memory Seed</label>
                   <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe a memory in its rawest form..." className="w-full h-48 bg-white/50 border border-gray-100 rounded-[2rem] p-6 text-sm outline-none resize-none shadow-inner" />
                 </section>
                 <section>
                    <label className="flex flex-col items-center justify-center gap-3 w-full p-10 border-2 border-dashed border-gray-200 rounded-[2.5rem] cursor-pointer hover:border-blue-400 transition-all">
                      <input type="file" className="hidden" multiple accept=".pdf,image/*" onChange={handleFileChange} />
                      <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Attach Reference Photos</span>
                    </label>
                 </section>
                 <button disabled={isProcessing || !prompt.trim()} onClick={handleDraft} className="w-full py-6 bg-gray-900 text-white rounded-[2rem] font-black text-[10px] uppercase tracking-[0.3em] shadow-xl">Synthesize Scene</button>
              </div>
            )}

            {activeTab === 'chat' && (
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
            )}

            {activeTab === 'terminal' && <Terminal />}
          </div>
        </div>
      </div>
    </>
  );
};

export default Sidebar;
