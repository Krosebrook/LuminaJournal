
/**
 * Audio Utilities for Gemini Live API Integration
 * Handles PCM conversion, Base64 encoding/decoding, and buffer management.
 */

// Converts Float32Array (Web Audio API default) to Int16Array (Gemini API requirement)
export function floatTo16BitPCM(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return output;
}

// ArrayBuffer to Base64 string
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Base64 string to ArrayBuffer
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// Convert PCM Int16 ArrayBuffer to AudioBuffer for playback
export function pcmToAudioBuffer(
  pcmData: ArrayBuffer, 
  context: AudioContext, 
  sampleRate: number = 24000
): AudioBuffer {
  const int16Array = new Int16Array(pcmData);
  const float32Array = new Float32Array(int16Array.length);
  
  for (let i = 0; i < int16Array.length; i++) {
    float32Array[i] = int16Array[i] / 32768.0;
  }

  const audioBuffer = context.createBuffer(1, float32Array.length, sampleRate);
  audioBuffer.getChannelData(0).set(float32Array);
  return audioBuffer;
}
