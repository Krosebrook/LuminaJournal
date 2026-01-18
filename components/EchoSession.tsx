
import React, { useState, useEffect, useRef } from 'react';
import { LiveSessionManager } from '../services/liveService';
import { transformMonologueToProse } from '../services/geminiService';
import { WritingTone } from '../types';

interface EchoSessionProps {
  isOpen: boolean;
  onClose: (prose: string) => void;
  tone: WritingTone;
}

const EchoSession: React.FC<EchoSessionProps> = ({ isOpen, onClose, tone }) => {
  const [status, setStatus] = useState<'idle' | 'recording' | 'processing'>('idle');
  const [transcript, setTranscript] = useState('');
  const sessionRef = useRef<LiveSessionManager | null>(null);

  useEffect(() => {
    if (isOpen) {
      startRecording();
    } else {
      stopRecording();
    }
    return () => stopRecording();
  }, [isOpen]);

  const startRecording = async () => {
    setStatus('recording');
    const session = new LiveSessionManager();
    sessionRef.current = session;
    
    session.onTranscriptUpdate = (text, isUser) => {
      // In Echo mode, we only care about user input mostly, but we capture everything just in case
      if (isUser) setTranscript(prev => prev + " " + text);
    };

    // System instruction: Passive listener
    await session.connect("You are a silent listener. Do not interrupt. Just acknowledge with short affirmations if there is a long pause.");
  };

  const stopRecording = () => {
    if (sessionRef.current) {
      sessionRef.current.disconnect();
      sessionRef.current = null;
    }
  };

  const handleFinish = async () => {
    stopRecording();
    if (!transcript.trim()) {
      onClose('');
      return;
    }

    setStatus('processing');
    try {
      const prose = await transformMonologueToProse(transcript, tone);
      onClose(prose);
    } catch (e) {
      console.error(e);
      onClose(transcript); // Fallback to raw transcript
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black text-white flex flex-col items-center justify-center animate-in fade-in">
      {status === 'processing' ? (
        <div className="flex flex-col items-center gap-6">
           <div className="w-16 h-16 border-4 border-white/20 border-t-white rounded-full animate-spin"></div>
           <h3 className="text-xl font-serif">Structuring your thoughts...</h3>
           <p className="text-white/40 max-w-md text-center">Gemini is converting your spoken ramblings into structured {tone} prose.</p>
        </div>
      ) : (
        <>
           <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-blue-500/20 rounded-full blur-[100px] animate-pulse"></div>
           
           <div className="relative z-10 flex flex-col items-center gap-8">
             <div className="text-center space-y-2">
               <h2 className="text-3xl font-bold tracking-tighter">Echo Mode</h2>
               <p className="text-white/60">Walk. Talk. Let memories flow.</p>
             </div>

             <div className="w-32 h-32 rounded-full border-4 border-blue-500 flex items-center justify-center relative">
               <div className="w-24 h-24 bg-blue-500 rounded-full animate-ping absolute opacity-20"></div>
               <div className="w-3 h-12 bg-white rounded-full mx-1 animate-[sound-wave_1s_infinite]"></div>
               <div className="w-3 h-16 bg-white rounded-full mx-1 animate-[sound-wave_1.2s_infinite]"></div>
               <div className="w-3 h-10 bg-white rounded-full mx-1 animate-[sound-wave_0.8s_infinite]"></div>
             </div>

             <div className="max-w-md text-center px-6 h-32 overflow-hidden relative">
                <p className="text-xl font-serif text-white/80 leading-relaxed italic">
                  "{transcript.slice(-150) || "Listening..."}"
                </p>
                <div className="absolute bottom-0 left-0 w-full h-16 bg-gradient-to-t from-black to-transparent"></div>
             </div>

             <button 
               onClick={handleFinish}
               className="bg-white text-black px-10 py-4 rounded-full font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all shadow-[0_0_40px_rgba(255,255,255,0.3)]"
             >
               Synthesize Draft
             </button>
           </div>
        </>
      )}
      <style>{`
        @keyframes sound-wave {
          0%, 100% { height: 20px; }
          50% { height: 100%; }
        }
      `}</style>
    </div>
  );
};

export default EchoSession;
