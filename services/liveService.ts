
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { floatTo16BitPCM, arrayBufferToBase64, base64ToArrayBuffer, pcmToAudioBuffer } from "./audioUtils";
import { getActiveApiKey } from "./security";

const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-12-2025';

/**
 * LiveSessionManager
 * 
 * Manages the WebSocket connection to the Gemini Live API.
 * Handles bidirectional streaming of audio:
 * 1. Captures microphone input -> PCM16 -> Base64 -> Gemini
 * 2. Receives Base64 audio -> PCM -> AudioContext -> Speakers
 */
export class LiveSessionManager {
  private client: GoogleGenAI;
  private audioContext: AudioContext | null = null;
  private inputSource: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private stream: MediaStream | null = null;
  private nextStartTime: number = 0;
  private session: any = null; // Session object from connect()
  private isActive: boolean = false;
  
  // Callbacks
  public onTranscriptUpdate: (text: string, isUser: boolean) => void = () => {};
  public onAudioLevel: (level: number) => void = () => {};
  public onStatusChange: (status: 'connecting' | 'connected' | 'disconnected' | 'error') => void = () => {};

  constructor() {
    this.client = new GoogleGenAI({ apiKey: getActiveApiKey() });
  }

  async connect(systemInstruction: string) {
    try {
      this.onStatusChange('connecting');
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      
      // Request Mic Access
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000 } });
      
      const sessionPromise = this.client.live.connect({
        model: MODEL_NAME,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: systemInstruction,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          inputAudioTranscription: { model: 'gemini-2.5-flash-latest' }, // Enable user transcription
          outputAudioTranscription: { model: 'gemini-2.5-flash-latest' }, // Enable model transcription
        },
        callbacks: {
          onopen: () => {
            console.log('[Live] Connected');
            this.onStatusChange('connected');
            this.isActive = true;
            this.startAudioInput(sessionPromise);
          },
          onmessage: (msg: LiveServerMessage) => this.handleMessage(msg),
          onclose: () => {
            console.log('[Live] Closed');
            this.disconnect();
          },
          onerror: (err) => {
            console.error('[Live] Error', err);
            this.onStatusChange('error');
          }
        }
      });
      
      // Wait for session to be ready
      this.session = await sessionPromise;
      
    } catch (err) {
      console.error("Failed to start live session", err);
      this.onStatusChange('error');
    }
  }

  private startAudioInput(sessionPromise: Promise<any>) {
    if (!this.audioContext || !this.stream) return;

    this.inputSource = this.audioContext.createMediaStreamSource(this.stream);
    // 4096 buffer size provides a balance between latency and processor overhead for the main thread
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (e) => {
      if (!this.isActive) return;
      
      const inputData = e.inputBuffer.getChannelData(0);
      
      // Calculate volume level for UI visualizer
      let sum = 0;
      for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
      const rms = Math.sqrt(sum / inputData.length);
      this.onAudioLevel(rms);

      // Convert to PCM and Send
      const pcm16 = floatTo16BitPCM(inputData);
      const base64Data = arrayBufferToBase64(pcm16.buffer);
      
      sessionPromise.then(session => {
        session.sendRealtimeInput({
          media: {
            mimeType: 'audio/pcm;rate=16000',
            data: base64Data
          }
        });
      });
    };

    this.inputSource.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
  }

  private async handleMessage(message: LiveServerMessage) {
    if (!this.audioContext) return;

    // Handle Transcriptions
    const serverContent = message.serverContent;
    if (serverContent) {
      if (serverContent.outputTranscription?.text) {
        this.onTranscriptUpdate(serverContent.outputTranscription.text, false);
      }
      if (serverContent.inputTranscription?.text) {
        this.onTranscriptUpdate(serverContent.inputTranscription.text, true);
      }
    }

    // Handle Audio Output
    const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (audioData) {
      try {
        const arrayBuffer = base64ToArrayBuffer(audioData);
        // Live API output is 24kHz
        const audioBuffer = pcmToAudioBuffer(arrayBuffer, this.audioContext, 24000);
        
        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.audioContext.destination);
        
        // Ensure seamless playback by scheduling next chunk exactly at end of previous
        const currentTime = this.audioContext.currentTime;
        if (this.nextStartTime < currentTime) {
          this.nextStartTime = currentTime;
        }
        source.start(this.nextStartTime);
        this.nextStartTime += audioBuffer.duration;
      } catch (e) {
        console.error("Error decoding audio chunk", e);
      }
    }
  }

  disconnect() {
    this.isActive = false;
    this.onStatusChange('disconnected');
    
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.inputSource) {
      this.inputSource.disconnect();
      this.inputSource = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}
