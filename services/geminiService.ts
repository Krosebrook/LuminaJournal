
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { FileAttachment, WritingTone, ChatMessage } from "../types";

const CIPHER_SALT = 'LUMINA_NEURAL_CORE_v1';

const decryptValue = (cipher: string): string => {
  try {
    const raw = atob(cipher);
    const rawChars = raw.split('').map(c => c.charCodeAt(0));
    const saltChars = CIPHER_SALT.split('').map(c => c.charCodeAt(0));
    const decrypted = rawChars.map((char, i) => 
      char ^ saltChars[i % saltChars.length]
    );
    return String.fromCharCode(...decrypted);
  } catch (e) { return ''; }
};

/**
 * Retrieves the active API key from the vault if set, otherwise returns the default.
 */
const getActiveApiKey = (): string => {
  try {
    const activeId = localStorage.getItem('lumina_active_key_id');
    const vault = localStorage.getItem('lumina_vault');
    if (activeId && vault) {
      const keys = JSON.parse(vault);
      const activeKey = keys.find((k: any) => k.id === activeId);
      if (activeKey) {
        return decryptValue(activeKey.value);
      }
    }
  } catch (e) {
    console.error("Failed to retrieve vault key", e);
  }
  return process.env.API_KEY || '';
};

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
 * GEMINI SUPPORTED MIME TYPES:
 * image/png, image/jpeg, image/webp, image/heic, image/heif, application/pdf
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

export const generateDraftStream = async (
  prompt: string, 
  attachments: FileAttachment[], 
  tone: WritingTone,
  onChunk: (text: string) => void,
  customSystemInstruction?: string
) => {
  const ai = getAIClient();
  const parts: any[] = [{ text: `TONE: ${TONE_INSTRUCTIONS[tone]}\n\nGOAL: ${prompt}` }];
  parts.push(...prepareAttachments(attachments));

  const baseInstruction = "You are an elite writing partner and biographer. Help the user tell their life story with depth and authenticity. Produce clean, structured text only.";
  const finalInstruction = customSystemInstruction ? `${baseInstruction} ${customSystemInstruction}` : baseInstruction;

  const result = await ai.models.generateContentStream({
    model: 'gemini-3-pro-preview',
    contents: { parts },
    config: {
      systemInstruction: finalInstruction,
    },
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

export const rewriteSelectionStream = async (
  fullContent: string, 
  selection: string, 
  feedback: string,
  tone: WritingTone,
  onChunk: (text: string) => void
) => {
  const ai = getAIClient();
  const result = await ai.models.generateContentStream({
    model: 'gemini-3-flash-preview',
    contents: { parts: [{ text: `CONTEXT: ${fullContent}\nREWRITE: "${selection}"\nREQUEST: ${feedback}` }] },
    config: { systemInstruction: `Tone: ${TONE_INSTRUCTIONS[tone]}. Rewrite ONLY the selection while maintaining the memoir's emotional consistency.` },
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
 * TERMINAL RAW EXECUTION WITH SEARCH SUPPORT
 */
export const executeRawTerminalPrompt = async (
  prompt: string, 
  modelName: string = 'gemini-3-pro-preview',
  useSearch: boolean = false
): Promise<{ text: string, sources?: any[] }> => {
  const ai = getAIClient();
  try {
    const config: any = {};
    if (useSearch) {
      config.tools = [{ googleSearch: {} }];
    }

    const response = await ai.models.generateContent({
      model: modelName,
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
  if (useSearch) {
    config.tools = [{ googleSearch: {} }];
  }

  const chat = ai.chats.create({ 
    model: 'gemini-3-flash-preview',
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
