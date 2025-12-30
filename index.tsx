
import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(registration => {
        console.log('SW registered: ', registration);
      })
      .catch(registrationError => {
        console.log('SW registration failed: ', registrationError);
      });
  });
}

// Internal component for handling PWA installation UI
const PwaInstallPrompt = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const handler = (e: any) => {
      // Prevent the mini-infobar from appearing on mobile
      e.preventDefault();
      // Stash the event so it can be triggered later.
      setDeferredPrompt(e);
      // Update UI notify the user they can install the PWA
      setIsVisible(true);
    };

    window.addEventListener('beforeinstallprompt', handler);

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    // Show the install prompt
    deferredPrompt.prompt();
    // Wait for the user to respond to the prompt
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`User response to the install prompt: ${outcome}`);
    // We've used the prompt, and can't use it again, throw it away
    setDeferredPrompt(null);
    setIsVisible(false);
  };

  const handleDismiss = () => {
    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[100] p-6 max-w-[340px] bg-[#0f172a] text-white rounded-[2rem] shadow-2xl border border-white/10 flex flex-col gap-4 animate-in slide-in-from-bottom-10 fade-in duration-700">
      <div className="flex items-start gap-4">
         <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-emerald-500 rounded-2xl flex items-center justify-center shadow-lg shrink-0">
            <span className="text-2xl">✨</span>
         </div>
         <div>
           <h3 className="font-bold text-sm tracking-wide">Install Lumina</h3>
           <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">Add your magic biographer to the home screen for a distraction-free, full-screen writing experience.</p>
         </div>
      </div>
      <div className="flex gap-3 mt-1">
        <button 
          onClick={handleDismiss} 
          className="flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest text-gray-500 hover:text-white hover:bg-white/5 transition-all"
        >
          Later
        </button>
        <button 
          onClick={handleInstallClick} 
          className="flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-white text-gray-900 hover:bg-gray-100 transition-all shadow-lg shadow-white/10"
        >
          Install App
        </button>
      </div>
    </div>
  );
};

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
    <PwaInstallPrompt />
  </React.StrictMode>
);
