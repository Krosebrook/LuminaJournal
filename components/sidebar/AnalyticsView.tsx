
import React, { useState } from 'react';
import { analyzeNarrativeArc } from '../../services/geminiService';

interface AnalyticsViewProps {
  content: string;
}

const AnalyticsView: React.FC<AnalyticsViewProps> = ({ content }) => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [data, setData] = useState<any[]>([]);

  const handleAnalyze = async () => {
    if (!content.trim()) return;
    setIsAnalyzing(true);
    try {
      const result = await analyzeNarrativeArc(content);
      setData(result);
    } catch (e) {
      console.error(e);
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-6">
         <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Narrative Pulse</h3>
         <button 
           onClick={handleAnalyze} 
           disabled={isAnalyzing}
           className={`text-[9px] font-bold px-3 py-1 rounded-full transition-all flex items-center gap-2 ${isAnalyzing ? 'bg-gray-100 text-gray-400' : 'bg-red-50 text-red-600 hover:bg-red-100'}`}
         >
           {isAnalyzing ? (
             <span className="animate-spin">⏳</span>
           ) : (
             <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
           )}
           {isAnalyzing ? 'Scanning...' : 'Measure Tension'}
         </button>
      </div>

      {data.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-300 gap-3 border-2 border-dashed border-gray-100 rounded-2xl">
          <svg className="w-8 h-8 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"></path></svg>
          <span className="text-[10px] uppercase tracking-widest opacity-60">No Analysis Data</span>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
          {/* Graph Visualization */}
          <div className="h-40 flex items-end gap-1 mb-6 border-b border-gray-100 pb-2 px-1">
            {data.map((d, i) => (
              <div key={i} className="flex-1 group relative flex flex-col items-center">
                <div 
                  className={`w-full rounded-t-sm transition-all duration-500 hover:opacity-80 ${d.tension > 7 ? 'bg-red-400' : d.tension > 4 ? 'bg-amber-400' : 'bg-emerald-400'}`} 
                  style={{ height: `${d.tension * 10}%` }}
                ></div>
                {/* Tooltip */}
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-[9px] p-2 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                  <span className="font-bold block">Intensity: {d.tension}/10</span>
                  <span className="opacity-70">{d.emotion}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            {data.map((d, i) => (
              <div key={i} className="flex items-center gap-3 p-3 bg-white border border-gray-100 rounded-xl hover:shadow-sm transition-all">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-sm shrink-0 ${d.tension > 7 ? 'bg-red-500' : d.tension > 4 ? 'bg-amber-500' : 'bg-emerald-500'}`}>
                  {d.tension}
                </div>
                <div>
                  <div className="text-xs font-bold text-gray-800">{d.segment}</div>
                  <div className="text-[9px] font-black uppercase tracking-widest text-gray-400">{d.emotion}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default AnalyticsView;
