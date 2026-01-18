
import { db } from "../lib/db";
import { generateEmbedding } from "./geminiService";

/**
 * Calculates cosine similarity between two vectors.
 */
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    magnitudeA += vecA[i] * vecA[i];
    magnitudeB += vecB[i] * vecB[i];
  }
  magnitudeA = Math.sqrt(magnitudeA);
  magnitudeB = Math.sqrt(magnitudeB);
  if (magnitudeA === 0 || magnitudeB === 0) return 0;
  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * Updates the vector index for a specific draft.
 */
export async function indexDraft(draftId: number, content: string) {
  if (!content.trim()) return;
  const vector = await generateEmbedding(content.slice(0, 8000)); // Embed first 8k chars for summary context
  if (vector) {
    await db.embeddings.put({ draftId, vector });
  }
}

/**
 * Performs a semantic search across all indexed drafts.
 */
export async function semanticSearch(query: string, limit: number = 5): Promise<number[]> {
  const queryVector = await generateEmbedding(query);
  if (!queryVector) return [];

  const allEmbeddings = await db.embeddings.toArray();
  
  const scored = allEmbeddings.map(e => ({
    draftId: e.draftId,
    score: cosineSimilarity(queryVector, e.vector)
  }));

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Return top K draft IDs
  return scored.slice(0, limit).map(s => s.draftId);
}
