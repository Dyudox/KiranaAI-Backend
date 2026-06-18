// src/utils/vectorUtils.js

/**
 * Fungsi menghitung Cosine Similarity antara dua array angka (vektor).
 * Menghasilkan nilai antara 0 (sangat berbeda) sampai 1 (sangat mirip/identik).
 */

// 2. Fungsi hitung kemiripan sudut teks (Cosine Similarity)
// const cosineSimilarity = (vecA, vecB) => {
//   let dotProduct = 0.0;
//   let normA = 0.0;
//   let normB = 0.0;
//   for (let i = 0; i < vecA.length; i++) {
//     dotProduct += vecA[i] * vecB[i];
//     normA += vecA[i] * vecA[i];
//     normB += vecB[i] * vecB[i];
//   }
//   if (normA === 0 || normB === 0) return 0;
//   return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
// };

export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;

  let dotProduct = 0.0;
  let normA = 0.0;
  let normB = 0.0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
