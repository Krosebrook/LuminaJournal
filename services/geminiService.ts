
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { FileAttachment, WritingTone, ChatMessage } from "../types";

const getAIClient = () => {
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

const TONE_INSTRUCTIONS: Record<WritingTone, string> = {
  creative: "Use vivid imagery, varied sentence structures, and an evocative, storytelling voice.",
  professional: "Maintain a clear, authoritative, and respectful tone. Focus on clarity and efficiency.",
  punchy: "Use short sentences. Be direct. High impact. No fluff.",
  academic: "Use formal language, precise terminology, and a structured, logical flow.",
  casual: "Friendly, relatable, and relaxed. Use contractions and a conversational rhythm."
};

export const generateDraftStream = async (
  prompt: string, 
  attachments: FileAttachment[], 
  tone: WritingTone,
  onChunk: (text: string) => void
) => {
  const ai = getAIClient();
  const parts: any[] = [{ text: `TONE: ${TONE_INSTRUCTIONS[tone]}\n\nPROMPT: ${prompt}` }];

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
      systemInstruction: "You are an elite writing partner. Produce only the requested content. No conversational filler. If files are provided, integrate their facts deeply into the writing.",
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
    SELECTION TO EDIT: "${selection}"
    FEEDBACK/INSTRUCTION: "${feedback}"
    DESIRED TONE: ${TONE_INSTRUCTIONS[tone]}
    
    TASK: Rewrite ONLY the SELECTION. Ensure it fits perfectly into the surrounding CONTEXT. Return ONLY the rewritten text.
  `;

  const result = await ai.models.generateContentStream({
    model: 'gemini-3-flash-preview',
    contents: prompt,
    config: {
      systemInstruction: "You are a surgical editor. Replace the provided text while honoring the feedback and context.",
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

export const getProactiveSuggestions = async (content: string, tone: WritingTone): Promise<any[]> => {
  if (!content || content.length < 50) return [];

  const ai = getAIClient();
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Current Content: "${content}"\nTone: ${tone}`,
    config: {
      systemInstruction: "You are a world-class editor. Identify exactly two segments of the text that need improvement. One should be a structural/tone suggestion and the other a phrasing improvement. Be specific.",
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
      systemInstruction: `You are a writing assistant. You have access to the current document content: "${content}". 
      Help the user brainstorm, research, or critique the work. Keep answers focused on the writing.`,
    }
  });

  // Convert history for the Gemini SDK chat format if needed, 
  // but we'll use a simple prompt for this context-injection.
  const fullPrompt = `DOCUMENT CONTENT:\n${content}\n\nUSER QUESTION: ${message}`;
  
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
