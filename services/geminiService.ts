import { GoogleGenAI, Type } from "@google/genai";
import { FileAttachment, WritingTone, ChatMessage } from "../types";
import { base64ToArrayBuffer } from "./audioUtils";
import { getActiveApiKey } from "./security";

/**
 * Initializes the Google GenAI client using the active key from the security service.
 */
const getAIClient = () => {
  return new GoogleGenAI({ apiKey: getActiveApiKey() });
};

const TONE_INSTRUCTIONS: Record<WritingTone, string> = {
  creative: "Vivid imagery, varied sentence structures, evocative storytelling voice.",
  professional: "Authoritative, respectful, clear, and efficient.",
  punchy: "Short sentences. Direct. High impact. Zero fluff.",
  academic: "Formal, precise terminology, logical and structured flow.",
  casual: "Friendly, relatable, relaxed, conversational rhythm.",
  memoir: "Introspective and deeply personal. Focus on sensory details (sounds, smells, textures), emotional honesty, and the passage of time. Avoid clichés; sound like a real person reflecting on their life."
};

/**
 * Prepares file attachments for the Gemini API by filtering supported MIME types
 * and formatting them into the `inlineData` structure.
 */
const prepareAttachments = (attachments: FileAttachment[]) => {
  const supportedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
  return attachments
    .filter(file => supportedTypes.includes(file.type))
    .map(file => ({
      inlineData: {
        mimeType: file.type,
        data: file.data.includes(',') ? file.data.split(',')[1] : file.data
      }
    }));
};

/**
 * Generates a full draft based on a prompt and attachments.
 * Supports "Thinking Mode" for complex reasoning.
 */
export const generateDraftStream = async (
  prompt: string, 
  attachments: FileAttachment[], 
  tone: WritingTone,
  onChunk: (text: string) => void,
  customSystemInstruction?: string,
  useThinking: boolean = false
) => {
  const ai = getAIClient();
  const parts: any[] = [{ text: `TONE: ${TONE_INSTRUCTIONS[tone]}\n\nGOAL: ${prompt}` }];
  parts.push(...prepareAttachments(attachments));

  const baseInstruction = "You are an elite writing partner and biographer. Help the user tell their life story with depth and authenticity. Produce clean, structured text only.";
  const finalInstruction = customSystemInstruction ? `${baseInstruction} ${customSystemInstruction}` : baseInstruction;

  const config: any = {
    systemInstruction: finalInstruction,
  };

  if (useThinking) {
    config.thinkingConfig = { thinkingBudget: 32768 };
  }

  const result = await ai.models.generateContentStream({
    model: 'gemini-3-pro-preview',
    contents: { parts },
    config: config,
  });

  let fullText = "";
  for await (const chunk of result) {
    if (chunk.text) {
      fullText += chunk.text;
      onChunk(fullText);
    }
  }
  return fullText;
};

/**
 * Rewrites a specific text selection based on user feedback.
 * Uses Gemini 2.5 Flash Lite for ultra-low latency.
 */
export const rewriteSelectionStream = async (
  fullContent: string, 
  selection: string, 
  feedback: string,
  tone: WritingTone,
  onChunk: (text: string) => void
) => {
  const ai = getAIClient();
  const result = await ai.models.generateContentStream({
    model: 'gemini-2.5-flash-lite',
    contents: { parts: [{ text: `CONTEXT: ${fullContent}\nREWRITE: "${selection}"\nREQUEST: ${feedback}` }] },
    config: { systemInstruction: `Tone: ${TONE_INSTRUCTIONS[tone]}. Rewrite ONLY the selection.` },
  });

  let fullText = "";
  for await (const chunk of result) {
    if (chunk.text) {
      fullText += chunk.text;
      onChunk(fullText);
    }
  }
  return fullText;
};

/**
 * Executes a raw prompt in the "Terminal" view.
 * Uses Gemini 3 Flash for Search Grounding if enabled, otherwise Pro.
 */
export const executeRawTerminalPrompt = async (
  prompt: string, 
  modelName: string = 'gemini-3-pro-preview',
  useSearch: boolean = false
): Promise<{ text: string, sources?: any[] }> => {
  const ai = getAIClient();
  try {
    const config: any = {};
    let model = modelName;
    
    if (useSearch) {
      config.tools = [{ googleSearch: {} }];
      model = 'gemini-3-flash-preview'; // Enforce Flash for search as per requirements
    }

    const response = await ai.models.generateContent({
      model: model,
      contents: prompt,
      config: config
    });
    
    const text = response.text || "No response received.";
    const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    
    return { text, sources };
  } catch (e: any) {
    return { text: `Error: ${e.message || JSON.stringify(e)}` };
  }
};

/**
 * Proactively scans content to provide structured suggestions (grammar, style, expansion).
 * Returns strictly typed JSON.
 */
export const getProactiveSuggestions = async (content: string, tone: WritingTone): Promise<any[]> => {
  if (!content || content.length < 50) return [];
  const ai = getAIClient();
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Suggest improvements for this autobiography draft: "${content}". Focus on sensory details and emotional resonance.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              originalText: { type: Type.STRING },
              suggestedText: { type: Type.STRING },
              explanation: { type: Type.STRING },
              type: { type: Type.STRING, enum: ['improvement', 'grammar', 'expansion', 'critique'] }
            },
            required: ["originalText", "suggestedText", "explanation", "type"]
          }
        }
      },
    });
    return JSON.parse(response.text || "[]");
  } catch (e) { return []; }
};

/**
 * Maintains a multi-turn chat context with the model.
 * Uses Gemini 3 Pro for chat, or Flash if search is enabled.
 */
export const chatWithContext = async (
  content: string,
  history: ChatMessage[],
  message: string,
  onChunk: (text: string) => void,
  customSystemInstruction?: string,
  useSearch: boolean = false
) => {
  const ai = getAIClient();
  const baseInstruction = "You are a professional ghostwriter and biographer. Your job is to help the user recall memories and turn them into compelling narrative prose.";
  const finalInstruction = customSystemInstruction ? `${baseInstruction} ${customSystemInstruction}` : baseInstruction;
  
  const config: any = { systemInstruction: finalInstruction };
  let model = 'gemini-3-pro-preview';

  if (useSearch) {
    config.tools = [{ googleSearch: {} }];
    model = 'gemini-3-flash-preview';
  }

  const chat = ai.chats.create({ 
    model: model,
    config: config
  });
  
  const result = await chat.sendMessageStream({ message: `DOC: ${content}\nUSER: ${message}` });
  let fullText = "";
  let sources: any[] | undefined;

  for await (const chunk of result) {
    if (chunk.text) {
      fullText += chunk.text;
      onChunk(fullText);
    }
    // Grounding metadata is usually available on chunks or the final candidate
    if (chunk.candidates?.[0]?.groundingMetadata?.groundingChunks) {
      sources = chunk.candidates[0].groundingMetadata.groundingChunks;
    }
  }
  return { text: fullText, sources };
};

// --- MULTIMODAL CAPABILITIES ---

/**
 * Generates high-quality images using Nano Banana Pro (Gemini 3 Pro Image).
 * Supports advanced configuration for Aspect Ratio and Size.
 */
export const generateSceneImage = async (
  prompt: string, 
  aspectRatio: string = "16:9", 
  imageSize: string = "1K"
): Promise<string | null> => {
  const ai = getAIClient();
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-image-preview',
      contents: { parts: [{ text: prompt }] },
      config: {
        imageConfig: { 
          aspectRatio: aspectRatio,
          imageSize: imageSize
        }
      }
    });
    
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return part.inlineData.data;
      }
    }
  } catch (e) { console.error("Image Gen Error", e); }
  return null;
};

/**
 * Generates a video from an image using Veo.
 * Requires Paid API Key selection.
 */
export const generateVeoVideo = async (
  image: string, // Base64
  prompt: string,
  aspectRatio: '16:9' | '9:16'
): Promise<string | null> => {
  
  // Ensure paid key is selected
  // We use type assertion to any to avoid strict type checks if global definition is missing or conflicting
  const win = window as any;
  if (win.aistudio && !await win.aistudio.hasSelectedApiKey()) {
    await win.aistudio.openSelectKey();
  }
  
  // Re-initialize client to pick up the potentially newly selected key from process.env
  const ai = getAIClient(); 

  try {
    // Determine mimeType (assuming png/jpeg based on base64 headers usually, but Veo is strict)
    // We strip header if present
    const cleanBase64 = image.includes(',') ? image.split(',')[1] : image;
    
    let operation = await ai.models.generateVideos({
      model: 'veo-3.1-fast-generate-preview',
      prompt: prompt || "Animate this scene naturally.",
      image: {
        imageBytes: cleanBase64,
        mimeType: 'image/png', // Assuming PNG for generated images
      },
      config: {
        numberOfVideos: 1,
        resolution: '720p', // Fast preview supports 720p
        aspectRatio: aspectRatio
      }
    });

    while (!operation.done) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      operation = await ai.operations.getVideosOperation({operation: operation});
    }

    const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (downloadLink) {
       // Append API Key to fetch
       const apiKey = getActiveApiKey();
       const videoRes = await fetch(`${downloadLink}&key=${apiKey}`);
       const blob = await videoRes.blob();
       
       return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
       });
    }
  } catch (e) {
    console.error("Veo Error", e);
    throw e;
  }
  return null;
};

/**
 * Converts text to speech using Gemini's audio generation capabilities.
 * Returns an ArrayBuffer of audio data.
 */
export const generateSpeech = async (text: string): Promise<ArrayBuffer | null> => {
   const ai = getAIClient();
   try {
     const response = await ai.models.generateContent({
       model: "gemini-2.5-flash-preview-tts",
       contents: [{ parts: [{ text }] }],
       config: {
         responseModalities: ["AUDIO"],
         speechConfig: {
             voiceConfig: {
               prebuiltVoiceConfig: { voiceName: 'Kore' },
             },
         },
       },
     });
     
     const base64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
     if (base64) {
       return base64ToArrayBuffer(base64);
     }
   } catch (e) { console.error("TTS Error", e); }
   return null;
};

// --- KNOWLEDGE GRAPH & SEMANTIC SEARCH ---

export const extractEntities = async (content: string): Promise<any[]> => {
  if (content.length < 100) return [];
  const ai = getAIClient();
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Analyze this text and extract key recurring entities (People, Locations, Objects, Themes) that are important to the narrative. Return JSON.`,
      config: {
        systemInstruction: `Text: "${content.slice(0, 10000)}..."`,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              type: { type: Type.STRING, enum: ['Person', 'Location', 'Object', 'Theme'] },
              description: { type: Type.STRING, description: "A brief summary of this entity's role in the story so far." }
            },
            required: ["name", "type", "description"]
          }
        }
      }
    });
    return JSON.parse(response.text || "[]");
  } catch (e) { return []; }
};

export const generateEmbedding = async (text: string): Promise<number[] | null> => {
  const ai = getAIClient();
  try {
    const response = await ai.models.embedContent({
      model: 'text-embedding-004',
      contents: text, 
    });
    return response.embedding?.values || null;
  } catch (e) { 
    console.error("Embedding Error", e); 
    return null;
  }
};

export const transformMonologueToProse = async (transcript: string, tone: WritingTone): Promise<string> => {
  const ai = getAIClient();
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: `Transform this raw spoken transcript into a polished memoir chapter. 
    TRANSCRIPT: ${transcript}`,
    config: {
      systemInstruction: `You are a ghostwriter. The user has just dictated a memory. 
      Tone: ${TONE_INSTRUCTIONS[tone]}. 
      Fix grammar, improve flow, add sensory details inferred from the context, and structure it into paragraphs. 
      Keep the narrator's authentic voice but remove filler words.`
    }
  });
  return response.text || "";
};