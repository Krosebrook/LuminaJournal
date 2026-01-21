
import React, { useEffect, useRef, useState } from 'react';
import { db, Entity } from '../../lib/db';
import { extractEntities, expandEntityLore } from '../../services/geminiService';

interface LatticeViewProps {
  content: string;
  currentDraftId?: number;
}

const LatticeView: React.FC<LatticeViewProps> = ({ content, currentDraftId }) => {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [filter, setFilter] = useState<'All' | 'Person' | 'Location' | 'Theme'>('All');
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);
  const [expandedLore, setExpandedLore] = useState<string>('');
  const [isExpanding, setIsExpanding] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    loadEntities();
  }, [filter]);

  const loadEntities = async () => {
    let collection = db.entities.orderBy('name');
    if (filter !== 'All') {
      // Dexie filtering
      const all = await collection.toArray();
      setEntities(all.filter(e => e.type === filter));
    } else {
      setEntities(await collection.toArray());
    }
  };

  const handleAnalyze = async () => {
    if (!content || !currentDraftId) return;
    setIsAnalyzing(true);
    try {
      const extracted = await extractEntities(content);
      // Upsert entities
      for (const item of extracted) {
        const existing = await db.entities.where('name').equals(item.name).first();
        if (existing) {
          if (!existing.draftIds.includes(currentDraftId)) {
            existing.draftIds.push(currentDraftId);
          }
          await db.entities.update(existing.id!, { 
            draftIds: existing.draftIds,
            lastSeen: Date.now(),
            description: item.description // Update description to latest context
          });
        } else {
          await db.entities.add({
            name: item.name,
            type: item.type,
            description: item.description,
            draftIds: [currentDraftId],
            lastSeen: Date.now()
          });
        }
      }
      loadEntities();
    } catch (e) {
      console.error(e);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleExpandLore = async (entity: Entity) => {
    setSelectedEntity(entity);
    setIsExpanding(true);
    setExpandedLore('');
    
    try {
      const lore = await expandEntityLore(entity.name, entity.type, content);
      setExpandedLore(lore);
    } catch (e) {
      console.error(e);
      setExpandedLore("Could not expand lore at this time.");
    } finally {
      setIsExpanding(false);
    }
  };

  // Simple Force-Directed Visualization logic (simulated for UI)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    const nodes = entities.map(e => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5,
      radius: e.type === 'Theme' ? 6 : e.type === 'Person' ? 5 : 4,
      color: e.type === 'Person' ? '#3b82f6' : e.type === 'Location' ? '#10b981' : e.type === 'Theme' ? '#8b5cf6' : '#f59e0b',
      entity: e
    }));

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Draw Connections (Simulated based on shared drafts would be better, but random for visual flair now)
      ctx.lineWidth = 0.5;
      ctx.strokeStyle = 'rgba(200, 200, 200, 0.2)';
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 100) {
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.stroke();
          }
        }
      }

      // Draw Nodes
      nodes.forEach(node => {
        node.x += node.vx;
        node.y += node.vy;

        // Bounce
        if (node.x < 0 || node.x > canvas.width) node.vx *= -1;
        if (node.y < 0 || node.y > canvas.height) node.vy *= -1;

        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fillStyle = node.color;
        ctx.fill();
        
        ctx.fillStyle = '#666';
        ctx.font = '8px Inter';
        ctx.fillText(node.entity.name, node.x + 8, node.y + 3);
      });

      animationId = requestAnimationFrame(animate);
    };

    animate();
    return () => cancelAnimationFrame(animationId);
  }, [entities]);

  return (
    <div className="flex flex-col h-full relative">
      <div className="flex items-center justify-between mb-4">
         <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Memory Lattice</h3>
         <button 
           onClick={handleAnalyze} 
           disabled={isAnalyzing}
           className={`text-[9px] font-bold px-3 py-1 rounded-full transition-all ${isAnalyzing ? 'bg-gray-100 text-gray-400' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}
         >
           {isAnalyzing ? 'Extracting...' : 'Scan Draft'}
         </button>
      </div>

      <div className="flex gap-2 mb-4 overflow-x-auto pb-2 custom-scrollbar">
        {['All', 'Person', 'Location', 'Theme'].map(f => (
          <button 
            key={f}
            onClick={() => setFilter(f as any)}
            className={`px-3 py-1 rounded-lg text-[9px] font-bold uppercase tracking-widest whitespace-nowrap border ${filter === f ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-400 border-gray-200'}`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="relative h-48 bg-white/50 border border-gray-100 rounded-2xl mb-6 overflow-hidden shadow-inner">
        <canvas ref={canvasRef} width={400} height={192} className="w-full h-full" />
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
        {entities.length === 0 && <p className="text-center text-xs text-gray-300 italic mt-10">The lattice is empty. Scan your draft to find connections.</p>}
        {entities.map(e => (
          <div 
            key={e.id} 
            onClick={() => handleExpandLore(e)}
            className="p-3 bg-white/60 rounded-xl border border-gray-100 hover:border-blue-200 transition-all group cursor-pointer hover:shadow-md"
          >
            <div className="flex items-center justify-between mb-1">
              <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${
                e.type === 'Person' ? 'bg-blue-100 text-blue-600' : 
                e.type === 'Location' ? 'bg-emerald-100 text-emerald-600' : 
                e.type === 'Theme' ? 'bg-purple-100 text-purple-600' : 'bg-amber-100 text-amber-600'
              }`}>{e.type}</span>
              <span className="text-[9px] text-gray-300">Found in {e.draftIds.length} ch.</span>
            </div>
            <h4 className="font-bold text-gray-800 text-sm">{e.name}</h4>
            <p className="text-[10px] text-gray-500 leading-relaxed mt-1 line-clamp-2">{e.description}</p>
          </div>
        ))}
      </div>

      {/* Detail Overlay */}
      {selectedEntity && (
        <div className="absolute inset-0 z-20 bg-white/95 backdrop-blur-xl rounded-2xl p-6 flex flex-col animate-in fade-in slide-in-from-bottom-4">
           <div className="flex items-center justify-between mb-4">
             <div className="flex items-center gap-2">
                <span className={`w-3 h-3 rounded-full ${
                    selectedEntity.type === 'Person' ? 'bg-blue-500' : 
                    selectedEntity.type === 'Location' ? 'bg-emerald-500' : 
                    selectedEntity.type === 'Theme' ? 'bg-purple-500' : 'bg-amber-500'
                }`}></span>
                <h3 className="font-bold text-lg">{selectedEntity.name}</h3>
             </div>
             <button onClick={() => setSelectedEntity(null)} className="p-1 hover:bg-gray-100 rounded-full"><svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg></button>
           </div>
           
           <div className="flex-1 overflow-y-auto custom-scrollbar">
             {isExpanding ? (
               <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2">
                 <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                 <span className="text-xs uppercase tracking-widest">Consulting Archives...</span>
               </div>
             ) : (
               <div className="prose prose-sm prose-blue">
                 <p className="text-xs text-gray-500 italic border-l-2 border-gray-200 pl-2 mb-4">{selectedEntity.description}</p>
                 <h4 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-2">Extended Lore</h4>
                 <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{expandedLore}</div>
               </div>
             )}
           </div>
        </div>
      )}
    </div>
  );
};

export default LatticeView;
