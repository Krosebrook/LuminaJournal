
import React, { useState, useEffect } from 'react';
import { db } from '../lib/db';
import { Draft } from '../types';
import { semanticSearch } from '../services/vectorService';

interface ArchiveProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectDraft: (draft: Draft) => void;
  currentDraftId?: number;
}

const Archive: React.FC<ArchiveProps> = ({ isOpen, onClose, onSelectDraft, currentDraftId }) => {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [search, setSearch] = useState('');
  const [useSemantic, setUseSemantic] = useState(false);
  const [isDeleting, setIsDeleting] = useState<number | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadDrafts();
    }
  }, [isOpen]);

  const loadDrafts = async () => {
    const all = await db.drafts.orderBy('updatedAt').reverse().toArray();
    setDrafts(all);
  };

  const handleSearch = async () => {
    if (!search.trim()) {
      loadDrafts();
      return;
    }

    if (useSemantic) {
      setIsSearching(true);
      try {
        const ids = await semanticSearch(search);
        // Dexie doesn't support bulkGet easily with types, manual map
        const results = await Promise.all(ids.map(id => db.drafts.get(id)));
        setDrafts(results.filter(Boolean) as Draft[]);
      } catch (e) {
        console.error(e);
      } finally {
        setIsSearching(false);
      }
    } else {
      // Client-side filter
      const all = await db.drafts.orderBy('updatedAt').reverse().toArray();
      const filtered = all.filter(d => 
        d.title.toLowerCase().includes(search.toLowerCase()) || 
        d.content.slice(0, 500).toLowerCase().includes(search.toLowerCase())
      );
      setDrafts(filtered);
    }
  };

  useEffect(() => {
    // Debounce search if strictly text, instant if semantic (triggered by Enter or button)
    if (!useSemantic) {
      handleSearch();
    }
  }, [search, useSemantic]);

  const handleCreateNew = async () => {
    const newDraft: Draft = {
      title: 'Untitled Chapter',
      content: '',
      tone: 'memoir',
      wordCount: 0,
      updatedAt: Date.now()
    };
    const id = await db.drafts.add(newDraft);
    onSelectDraft({ ...newDraft, id: Number(id) });
    onClose();
  };

  const handleDelete = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to burn this manuscript? This action cannot be undone.')) {
      setIsDeleting(id);
      await db.drafts.delete(id);
      await loadDrafts();
      setIsDeleting(null);
    }
  };

  return (
    <div className={`fixed inset-0 z-[60] transition-all duration-500 ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-[#0f172a]/80 backdrop-blur-xl" onClick={onClose}></div>

      {/* Content Container */}
      <div className={`absolute inset-x-0 bottom-0 top-24 md:top-32 md:inset-x-24 md:bottom-12 glass rounded-t-[2.5rem] md:rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] ${isOpen ? 'translate-y-0' : 'translate-y-full'}`}>
        
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-6 border-b border-white/40 bg-white/40 backdrop-blur-md z-10">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-gray-900 rounded-xl flex items-center justify-center text-white">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
            </div>
            <div>
              <h2 className="text-xl font-serif font-bold text-gray-900">The Archive</h2>
              <p className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">{drafts.length} Manuscripts stored</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 bg-white/50 border border-white/50 rounded-xl p-1 pr-3">
              <div className="relative">
                 <svg className={`w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 ${isSearching ? 'text-blue-500 animate-spin' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={isSearching ? "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" : "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"}></path></svg>
                 <input 
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && useSemantic && handleSearch()}
                  placeholder={useSemantic ? "Search by concept (e.g. 'loneliness')..." : "Filter by title..."}
                  className="bg-transparent py-1.5 pl-9 pr-2 text-xs font-medium outline-none w-64"
                />
              </div>
              <button 
                onClick={() => setUseSemantic(!useSemantic)}
                className={`text-[9px] font-black uppercase px-2 py-1 rounded-lg transition-all ${useSemantic ? 'bg-indigo-600 text-white shadow-lg' : 'bg-gray-200 text-gray-500 hover:bg-gray-300'}`}
                title="Semantic Vector Search"
              >
                AI Search
              </button>
            </div>

            <button 
              onClick={handleCreateNew}
              className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-blue-500/30 transition-all flex items-center gap-2 hover:scale-105 active:scale-95"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>
              New Chapter
            </button>
            <button onClick={onClose} className="p-2 hover:bg-white/50 rounded-full transition-colors">
              <svg className="w-6 h-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-white/30">
          {drafts.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400 opacity-60">
              <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path></svg>
              <p className="text-sm font-serif italic">Your library is empty. Start a new chapter.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {drafts.map((draft) => (
                <div 
                  key={draft.id}
                  onClick={() => onSelectDraft(draft)}
                  className={`group relative bg-white border border-white/60 p-6 rounded-[2rem] shadow-sm hover:shadow-xl transition-all cursor-pointer hover:-translate-y-1 ${currentDraftId === draft.id ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-[#fafafa]' : ''}`}
                >
                  <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                      onClick={(e) => handleDelete(e, draft.id!)}
                      className="p-1.5 hover:bg-red-50 text-gray-300 hover:text-red-500 rounded-full transition-colors"
                      title="Delete Draft"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                  </div>

                  <div className="mb-4">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-50 to-indigo-50 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform duration-500">
                      <span className="text-lg">
                        {draft.tone === 'memoir' ? '🕯️' : draft.tone === 'creative' ? '🎨' : '📝'}
                      </span>
                    </div>
                    <h3 className="font-serif text-lg font-bold text-gray-900 leading-snug line-clamp-2 min-h-[3rem]">
                      {draft.title || 'Untitled Chapter'}
                    </h3>
                  </div>

                  <div className="space-y-2">
                     <p className="text-[11px] text-gray-500 line-clamp-3 leading-relaxed opacity-80 min-h-[42px]">
                       {draft.content.slice(0, 150) || "Empty manuscript..."}
                     </p>
                  </div>

                  <div className="mt-6 pt-4 border-t border-gray-100 flex items-center justify-between">
                    <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">
                      {new Date(draft.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                    <span className="text-[9px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                      {draft.wordCount} words
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Archive;
