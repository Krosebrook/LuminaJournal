
/**
 * Lumina Intelligence Service
 * Core logic for document generation, surgical editing, and proactive analysis.
 * Utilizes a hybrid Gemini 3 architecture for optimal latency/quality trade-offs.
 */

import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { FileAttachment, WritingTone, ChatMessage } from "../types";

// Standardizing initialization to ensure thread safety
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
 * Generates a full document draft using the Pro model for high reasoning depth.
 * @param prompt The user's narrative direction
 * @param attachments Supporting documentation/images
 * @param tone The selected sonic profile
 * @param onChunk Callback for streaming tokens
 */
export const generateDraftStream = async (
  prompt: string, 
  attachments: FileAttachment[], 
  tone: WritingTone,
  onChunk: (text: string) => void
) => {
  const ai = getAIClient();
  const parts: any[] = [{ text: `TONE: ${TONE_INSTRUCTIONS[tone]}\n\nPROMPT: ${prompt}` }];

  // Inject multi-modal context if provided
  attachments.forEach(file => {
    parts.push({
      inlineData: {
        mimeType: file.type,
        data: file.data.split(',')[1] || file.data
      }
    });
  });

  const result = await ai.models.generateContentStream({
    model: 'gemini-3-pro-preview',
    contents: { parts },
    config: {
      systemInstruction: "You are an elite writing partner. Produce only the requested content. No conversational filler. Integrate facts from attachments deeply.",
      thinkingConfig: { thinkingBudget: 4000 }
    },
  });

  let fullText = "";
  for await (const chunk of result) {
    const text = chunk.text;
    if (text) {
      fullText += text;
      onChunk(fullText);
    }
  }
  return fullText;
};

/**
 * Surgical rewrite of selected text using Flash for sub-second latency.
 */
export const rewriteSelectionStream = async (
  fullContent: string, 
  selection: string, 
  feedback: string,
  tone: WritingTone,
  onChunk: (text: string) => void
) => {
  const ai = getAIClient();
  const prompt = `
    CONTEXT: ${fullContent}
    TARGET: "${selection}"
    FEEDBACK: "${feedback}"
    TONE: ${TONE_INSTRUCTIONS[tone]}
    
    Rewrite ONLY the TARGET. Fit the CONTEXT. Return only the revised text.
  `;

  const result = await ai.models.generateContentStream({
    model: 'gemini-3-flash-preview',
    contents: prompt,
    config: {
      systemInstruction: "You are a surgical editor. Replace text while maintaining perfect contextual continuity.",
    },
  });

  let fullText = "";
  for await (const chunk of result) {
    const text = chunk.text;
    if (text) {
      fullText += text;
      onChunk(fullText);
    }
  }
  return fullText;
};

/**
 * Proactively scans content for structural and stylistic improvements.
 */
export const getProactiveSuggestions = async (content: string, tone: WritingTone): Promise<any[]> => {
  if (!content || content.length < 50) return [];

  const ai = getAIClient();
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Content: "${content}"\nTone: ${tone}`,
    config: {
      systemInstruction: "Identify two critical segments for improvement. One structural, one phrasing. Return as JSON.",
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

  try {
    return JSON.parse(response.text || "[]");
  } catch (e) {
    return [];
  }
};

/**
 * Scans text for linguistic errors and returns corrections.
 */
export const getSpellingCorrections = async (content: string): Promise<any[]> => {
  if (!content || content.length < 5) return [];

  const ai = getAIClient();
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Scan for errors: "${content}"`,
    config: {
      systemInstruction: "Identify misspelled words. Return JSON array of {word, corrections}.",
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            word: { type: Type.STRING },
            corrections: { 
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          },
          required: ["word", "corrections"]
        }
      }
    },
  });

  try {
    return JSON.parse(response.text || "[]");
  } catch (e) {
    return [];
  }
};

/**
 * Chat-based counsel for brainstorming or research queries.
 */
export const chatWithContext = async (
  content: string,
  history: ChatMessage[],
  message: string,
  onChunk: (text: string) => void
) => {
  const ai = getAIClient();
  const chat = ai.chats.create({
    model: 'gemini-3-flash-preview',
    config: {
      systemInstruction: "You are a writing assistant. Use the document content for context. Help brainstorm or critique.",
    }
  });

  const fullPrompt = `DOC:\n${content}\n\nUSER: ${message}`;
  const result = await chat.sendMessageStream({ message: fullPrompt });
  
  let fullText = "";
  for await (const chunk of result) {
    const text = chunk.text;
    if (text) {
      fullText += text;
      onChunk(fullText);
    }
  }
  return fullText;
};
