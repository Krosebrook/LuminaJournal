
import React, { useEffect, useRef, useState } from 'react';
import { LiveSessionManager } from '../services/liveService';

interface InterviewRoomProps {
  isOpen: boolean;
  onClose: (transcript: string) => void;
  systemInstruction: string;
}

const InterviewRoom: React.FC<InterviewRoomProps> = ({ isOpen, onClose, systemInstruction }) => {
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');
  const [volume, setVolume] = useState(0);
  const [transcript, setTranscript] = useState<string>("");
  const sessionRef = useRef<LiveSessionManager | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>();

  useEffect(() => {
    if (isOpen) {
      startSession();
    } else {
      endSession();
    }
    return () => endSession();
  }, [isOpen]);

  const startSession = async () => {
    if (sessionRef.current) return;
    
    const session = new LiveSessionManager();
    sessionRef.current = session;
    
    session.onStatusChange = setStatus;
    session.onAudioLevel = (v) => setVolume(Math.min(1, v * 5)); // Amplify for visualizer
    session.onTranscriptUpdate = (text, isUser) => {
      setTranscript(prev => prev + (prev ? "\n" : "") + (isUser ? "You: " : "Lumina: ") + text);
    };

    await session.connect(systemInstruction || "You are an insightful biographer. Ask the user gentle questions about their life.");
  };

  const endSession = () => {
    if (sessionRef.current) {
      sessionRef.current.disconnect();
      sessionRef.current = null;
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
  };

  const handleClose = () => {
    endSession();
    onClose(transcript);
  };

  // Canvas Visualizer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let time = 0;
    const draw = () => {
      if (!isOpen) return;
      
      // Responsive canvas
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;

      ctx.clearRect(0, 0, w, h);
      time += 0.05;

      // Draw Orb
      // Base radius + volume modulation
      const baseR = Math.min(w, h) * 0.15;
      const r = baseR + (volume * 100);
      
      // Dynamic Gradient
      const grad = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
      if (status === 'connected') {
        grad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
        grad.addColorStop(0.4, 'rgba(59, 130, 246, 0.4)'); // Blue
        grad.addColorStop(1, 'rgba(59, 130, 246, 0)');
      } else if (status === 'connecting') {
        grad.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
        grad.addColorStop(1, 'rgba(251, 191, 36, 0)'); // Amber
      } else {
        grad.addColorStop(0, 'rgba(255, 255, 255, 0.2)');
        grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      }

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      // Orbital Rings
      if (status === 'connected') {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;
        for (let i = 1; i <= 3; i++) {
          const orbitR = baseR * 2 * i + Math.sin(time + i) * 10;
          ctx.beginPath();
          ctx.arc(cx, cy, orbitR, 0, Math.PI * 2);
          ctx.stroke();
          
          // Planet
          const px = cx + Math.cos(time * 0.5 * (4-i)) * orbitR;
          const py = cy + Math.sin(time * 0.5 * (4-i)) * orbitR;
          ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
          ctx.beginPath();
          ctx.arc(px, py, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      animationFrameRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isOpen, volume, status]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-[#0f172a] text-white flex flex-col items-center justify-center animate-in fade-in duration-500">
      <div className="absolute top-8 left-8">
        <h2 className="text-xl font-serif font-bold tracking-wide">The Interview Room</h2>
        <p className="text-xs text-white/40 uppercase tracking-widest mt-1">Live Memory Excavation</p>
      </div>

      <div className="absolute top-8 right-8 flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${status === 'connected' ? 'bg-green-500 animate-pulse' : status === 'connecting' ? 'bg-amber-500' : 'bg-red-500'}`}></div>
        <span className="text-[10px] font-black uppercase tracking-widest opacity-60">
          {status === 'connected' ? 'Live Link Active' : status}
        </span>
      </div>

      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

      {/* Transcript Preview (Subtle) */}
      <div className="absolute bottom-32 w-full max-w-2xl px-6 text-center">
        <p className="text-lg font-serif italic opacity-60 transition-all duration-300">
          {transcript.split('\n').slice(-1)[0] || "Waiting for your voice..."}
        </p>
      </div>

      <div className="absolute bottom-12 flex gap-4 z-10">
        <button 
          onClick={handleClose}
          className="bg-white text-black px-8 py-3 rounded-full text-xs font-black uppercase tracking-[0.2em] hover:scale-105 active:scale-95 transition-all shadow-[0_0_20px_rgba(255,255,255,0.3)]"
        >
          End Interview
        </button>
      </div>
    </div>
  );
};

export default InterviewRoom;
