
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { FileAttachment, WritingTone, ChatMessage } from "../types";

const getAIClient = () => {
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

const TONE_INSTRUCTIONS: Record<WritingTone, string> = {
  creative: "Vivid imagery, varied sentence structures, evocative storytelling voice.",
  professional: "Authoritative, respectful, clear, and efficient.",
  punchy: "Short sentences. Direct. High impact. Zero fluff.",
  academic: "Formal, precise terminology, logical and structured flow.",
  casual: "Friendly, relatable, relaxed, conversational rhythm."
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
  onChunk: (text: string) => void
) => {
  const ai = getAIClient();
  const parts: any[] = [{ text: `TONE: ${TONE_INSTRUCTIONS[tone]}\n\nGOAL: ${prompt}` }];
  parts.push(...prepareAttachments(attachments));

  // Aligned with single-turn content object format
  const result = await ai.models.generateContentStream({
    model: 'gemini-3-pro-preview',
    contents: { parts },
    config: {
      systemInstruction: "You are an elite writing partner. Produce clean, structured text only.",
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
  // Aligned with single-turn content object format
  const result = await ai.models.generateContentStream({
    model: 'gemini-3-flash-preview',
    contents: { parts: [{ text: `CONTEXT: ${fullContent}\nREWRITE: "${selection}"\nREQUEST: ${feedback}` }] },
    config: { systemInstruction: "Rewrite ONLY the selection. Maintain context." },
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
 * TERMINAL RAW EXECUTION
 */
export const executeRawTerminalPrompt = async (prompt: string): Promise<string> => {
  const ai = getAIClient();
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: prompt,
    });
    return response.text || "No response received.";
  } catch (e: any) {
    return `Error: ${e.message || JSON.stringify(e)}`;
  }
};

export const getProactiveSuggestions = async (content: string, tone: WritingTone): Promise<any[]> => {
  if (!content || content.length < 50) return [];
  const ai = getAIClient();
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Suggest improvements for: "${content}"`,
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
  onChunk: (text: string) => void
) => {
  const ai = getAIClient();
  const chat = ai.chats.create({ model: 'gemini-3-flash-preview' });
  const result = await chat.sendMessageStream({ message: `DOC: ${content}\nUSER: ${message}` });
  let fullText = "";
  for await (const chunk of result) {
    if (chunk.text) {
      fullText += chunk.text;
      onChunk(fullText);
    }
  }
  return fullText;
};
