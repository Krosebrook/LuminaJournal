
import React, { useState, useEffect } from 'react';
import { UserProfile, WritingTone } from '../../types';
import { db, PromptTemplate } from '../../lib/db';

interface ProfileManagerProps {
  activeProfile: UserProfile | null;
  onProfileSelect: (p: UserProfile) => void;
  tone: WritingTone;
  setTone: (t: WritingTone) => void;
  setPrompt: (p: string) => void;
  prompt: string;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  isProcessing: boolean;
  handleDraft: (useThinking: boolean) => void;
}

const ProfileManager: React.FC<ProfileManagerProps> = ({
  activeProfile,
  onProfileSelect,
  tone,
  setTone,
  setPrompt,
  prompt,
  handleFileChange,
  isProcessing,
  handleDraft
}) => {
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [profileForm, setProfileForm] = useState<Partial<UserProfile>>({ name: '', tone: 'memoir', systemInstruction: '' });
  const [useThinking, setUseThinking] = useState(false);

  // Prompt Templates State
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);

  useEffect(() => {
    loadProfiles();
    loadTemplates();
  }, []);

  const loadProfiles = async () => {
    const allProfiles = await db.profiles.toArray();
    setProfiles(allProfiles);
    if (!activeProfile && allProfiles.length > 0) {
        const defaultP = allProfiles.find(p => p.isDefault) || allProfiles[0];
        onProfileSelect(defaultP);
    }
  };

  const loadTemplates = async () => {
    const all = await db.promptTemplates.orderBy('created').reverse().toArray();
    setTemplates(all);
  };

  const saveTemplate = async () => {
    if (!prompt.trim()) return;
    const name = prompt.split(' ').slice(0, 4).join(' ') + '...';
    await db.promptTemplates.add({
      name: name,
      content: prompt,
      created: Date.now()
    });
    loadTemplates();
  };

  const deleteTemplate = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    await db.promptTemplates.delete(id);
    loadTemplates();
  };

  const handleSaveProfile = async () => {
    if (!profileForm.name) return;

    if (isEditing && profileForm.id) {
      await db.profiles.update(profileForm.id, {
        name: profileForm.name,
        tone: profileForm.tone,
        systemInstruction: profileForm.systemInstruction
      });

      const updatedProfiles = profiles.map(p => 
        p.id === profileForm.id ? { ...p, ...profileForm } as UserProfile : p
      );
      setProfiles(updatedProfiles);
      
      if (activeProfile?.id === profileForm.id) {
        onProfileSelect({ ...activeProfile, ...profileForm } as UserProfile);
      }
    } else {
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
        onProfileSelect(updated[0]);
      }
    }
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

  const tones: { id: WritingTone; label: string; icon: string }[] = [
    { id: 'memoir', label: 'Memoir', icon: '🕯️' },
    { id: 'creative', label: 'Artistic', icon: '🎨' },
    { id: 'professional', label: 'Executive', icon: '💼' },
    { id: 'punchy', label: 'Direct', icon: '💥' },
    { id: 'academic', label: 'Learned', icon: '📜' },
    { id: 'casual', label: 'Human', icon: '👋' }
  ];

  return (
    <div className="space-y-10">
      <section>
        <div className="flex items-center justify-between mb-4">
          <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em]">Story Companion</label>
          <button onClick={() => isFormOpen ? resetForm() : setIsFormOpen(true)} className="text-xs font-bold text-blue-600">
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
              placeholder="Companion Name" 
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
              placeholder="How should this companion help you?" 
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
                onClick={() => onProfileSelect(p)}
              >
                <div className="flex items-center gap-3">
                  <span className="text-lg">{tones.find(t => t.id === p.tone)?.icon}</span>
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-gray-900">{p.name}</span>
                    <span className="text-[9px] text-gray-400 uppercase tracking-tighter">{p.tone}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={(e) => startEditing(p, e)} className="p-2 text-gray-300 hover:text-blue-500 transition-all">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); p.id && deleteProfile(p.id); }} className="p-2 text-gray-300 hover:text-red-400 transition-all">
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
        <div className="flex items-center justify-between mb-4">
          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-[0.3em]">Memory Seed</label>
          <div className="flex gap-2">
            <button onClick={saveTemplate} disabled={!prompt.trim()} className="text-[10px] font-bold text-blue-600 hover:text-blue-700 disabled:opacity-50">Save</button>
            <button onClick={() => setShowTemplates(!showTemplates)} className="text-[10px] font-bold text-gray-400 hover:text-gray-600">
               {showTemplates ? 'Hide' : 'Load'}
            </button>
          </div>
        </div>
        
        {showTemplates && (
          <div className="mb-4 bg-white/60 border border-gray-100 rounded-2xl p-2 max-h-40 overflow-y-auto custom-scrollbar animate-in fade-in slide-in-from-top-2">
             {templates.length === 0 && <p className="text-center text-xs text-gray-400 py-2 italic">No saved prompt templates.</p>}
             {templates.map(t => (
               <div key={t.id} onClick={() => { setPrompt(t.content); setShowTemplates(false); }} className="p-2 hover:bg-white rounded-xl cursor-pointer flex justify-between group">
                 <span className="text-xs text-gray-700 truncate max-w-[180px]">{t.name}</span>
                 <button onClick={(e) => deleteTemplate(t.id!, e)} className="text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100">
                   <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                 </button>
               </div>
             ))}
          </div>
        )}

        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe a memory in its rawest form..." className="w-full h-48 bg-white/50 border border-gray-100 rounded-[2rem] p-6 text-sm outline-none resize-none shadow-inner" />
      </section>

      <section>
        <label className="flex items-center gap-3 p-4 bg-white/40 rounded-2xl border border-gray-100 cursor-pointer hover:bg-white/60 transition-colors">
          <div className={`w-10 h-6 rounded-full p-1 transition-colors ${useThinking ? 'bg-indigo-600' : 'bg-gray-200'}`} onClick={() => setUseThinking(!useThinking)}>
            <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${useThinking ? 'translate-x-4' : ''}`}></div>
          </div>
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-gray-700">Deep Thinking Mode</div>
            <div className="text-[9px] text-gray-400">Use extended reasoning for complex plots.</div>
          </div>
        </label>
      </section>

      <section>
        <label className="flex flex-col items-center justify-center gap-3 w-full p-10 border-2 border-dashed border-gray-200 rounded-[2.5rem] cursor-pointer hover:border-blue-400 transition-all">
          <input type="file" className="hidden" multiple accept=".pdf,image/*" onChange={handleFileChange} />
          <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Attach Reference Photos</span>
        </label>
      </section>

      <button disabled={isProcessing || !prompt.trim()} onClick={() => handleDraft(useThinking)} className="w-full py-6 bg-gray-900 text-white rounded-[2rem] font-black text-[10px] uppercase tracking-[0.3em] shadow-xl hover:scale-[1.02] active:scale-95 transition-all">Synthesize Scene</button>
    </div>
  );
};

export default ProfileManager;
