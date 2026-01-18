
import React, { useState } from 'react';
import { generateSceneImage, generateVeoVideo } from '../../services/geminiService';

const MediaStudio: React.FC = () => {
  const [activeMode, setActiveMode] = useState<'image' | 'video'>('image');
  const [prompt, setPrompt] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);

  // Configs
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [imageSize, setImageSize] = useState('1K');
  const [videoAspectRatio, setVideoAspectRatio] = useState<'16:9' | '9:16'>('16:9');

  const handleImageGen = async () => {
    if (!prompt.trim()) return;
    setIsProcessing(true);
    setResultUrl(null);
    try {
      const base64 = await generateSceneImage(prompt, aspectRatio, imageSize);
      if (base64) {
        setResultUrl(`data:image/png;base64,${base64}`);
      }
    } catch (e) {
      console.error(e);
      alert("Failed to generate image.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleVideoGen = async () => {
    // Need image source: either resultUrl or uploadedImage
    const sourceImage = uploadedImage || resultUrl;
    if (!sourceImage) {
      alert("Please upload an image or generate one first.");
      return;
    }
    
    setIsProcessing(true);
    try {
      const videoBase64 = await generateVeoVideo(sourceImage, prompt, videoAspectRatio);
      if (videoBase64) {
        setResultUrl(videoBase64); // This will be a data URI for video
      }
    } catch (e) {
      console.error(e);
      alert("Video generation failed. Ensure you have a paid API key selected.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setUploadedImage(ev.target?.result as string);
        setResultUrl(null); // Clear previous result
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-2 p-1 bg-gray-100 rounded-xl">
        <button 
          onClick={() => { setActiveMode('image'); setResultUrl(null); }}
          className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${activeMode === 'image' ? 'bg-white text-pink-600 shadow-sm' : 'text-gray-400'}`}
        >
          Image Gen
        </button>
        <button 
          onClick={() => { setActiveMode('video'); setResultUrl(null); setUploadedImage(null); }}
          className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${activeMode === 'video' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400'}`}
        >
          Veo Video
        </button>
      </div>

      {activeMode === 'image' && (
        <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
          <textarea 
            value={prompt} 
            onChange={e => setPrompt(e.target.value)} 
            placeholder="Describe the scene in detail..." 
            className="w-full h-32 bg-white border border-gray-100 rounded-2xl p-4 text-xs outline-none focus:ring-2 ring-pink-100 resize-none" 
          />
          <div className="grid grid-cols-2 gap-3">
             <div className="space-y-1">
               <label className="text-[9px] font-bold text-gray-400 uppercase tracking-widest ml-1">Aspect Ratio</label>
               <select value={aspectRatio} onChange={e => setAspectRatio(e.target.value)} className="w-full p-2 bg-white border border-gray-100 rounded-xl text-xs outline-none">
                 {["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"].map(r => <option key={r} value={r}>{r}</option>)}
               </select>
             </div>
             <div className="space-y-1">
               <label className="text-[9px] font-bold text-gray-400 uppercase tracking-widest ml-1">Quality</label>
               <select value={imageSize} onChange={e => setImageSize(e.target.value)} className="w-full p-2 bg-white border border-gray-100 rounded-xl text-xs outline-none">
                 {["1K", "2K", "4K"].map(r => <option key={r} value={r}>{r}</option>)}
               </select>
             </div>
          </div>
          <button 
            onClick={handleImageGen} 
            disabled={isProcessing || !prompt.trim()} 
            className="w-full py-3 bg-pink-600 hover:bg-pink-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50"
          >
            {isProcessing ? 'Generating (Pro)...' : 'Generate Scene'}
          </button>
        </div>
      )}

      {activeMode === 'video' && (
        <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
          <div className="border-2 border-dashed border-gray-200 rounded-2xl p-4 text-center cursor-pointer hover:border-indigo-300 transition-colors relative">
            <input type="file" accept="image/*" onChange={handleFileUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
            {uploadedImage ? (
              <img src={uploadedImage} alt="Source" className="max-h-32 mx-auto rounded-lg" />
            ) : (
              <div className="py-6 text-gray-400">
                <p className="text-xs font-bold">Upload Source Image</p>
                <p className="text-[9px] uppercase mt-1">or drag & drop</p>
              </div>
            )}
          </div>

          <textarea 
            value={prompt} 
            onChange={e => setPrompt(e.target.value)} 
            placeholder="How should this image move? (e.g. 'Camera pans right, leaves rustling')" 
            className="w-full h-24 bg-white border border-gray-100 rounded-2xl p-4 text-xs outline-none focus:ring-2 ring-indigo-100 resize-none" 
          />
          
          <div className="space-y-1">
             <label className="text-[9px] font-bold text-gray-400 uppercase tracking-widest ml-1">Output Ratio</label>
             <div className="flex gap-2">
               {['16:9', '9:16'].map(r => (
                 <button 
                  key={r} 
                  onClick={() => setVideoAspectRatio(r as any)} 
                  className={`flex-1 py-2 rounded-lg text-xs border ${videoAspectRatio === r ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-500 border-gray-100'}`}
                 >
                   {r}
                 </button>
               ))}
             </div>
          </div>

          <button 
            onClick={handleVideoGen} 
            disabled={isProcessing || (!uploadedImage && !resultUrl)} 
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50"
          >
            {isProcessing ? 'Animating (Veo)...' : 'Animate with Veo'}
          </button>
          <p className="text-[9px] text-center text-gray-400">Requires a paid Google Cloud Project API Key.</p>
        </div>
      )}

      {/* Result Display */}
      {resultUrl && !isProcessing && (
        <div className="mt-6 p-2 bg-white rounded-2xl border border-gray-100 shadow-lg animate-in zoom-in-95">
          {activeMode === 'image' || (!resultUrl.startsWith('data:video') && !resultUrl.includes('mp4')) ? (
            <div className="relative group">
               <img src={resultUrl} alt="Result" className="w-full rounded-xl" />
               <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 rounded-xl">
                 <a href={resultUrl} download="generated-asset.png" className="p-2 bg-white rounded-full text-black hover:scale-110 transition-transform"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg></a>
                 {activeMode === 'image' && (
                   <button 
                    onClick={() => { setUploadedImage(resultUrl); setActiveMode('video'); setResultUrl(null); }}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-full text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-transform"
                   >
                     Animate
                   </button>
                 )}
               </div>
            </div>
          ) : (
            <video src={resultUrl} controls autoPlay loop className="w-full rounded-xl" />
          )}
        </div>
      )}
    </div>
  );
};

export default MediaStudio;
