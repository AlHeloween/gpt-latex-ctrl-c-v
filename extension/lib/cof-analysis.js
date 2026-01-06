(() => {
  const cof = (globalThis.__cof = globalThis.__cof || {});
  const diag = cof.diag || (() => {});

  // Simple stop words list (common English words to filter out)
  const STOP_WORDS = new Set([
    "the", "be", "to", "of", "and", "a", "in", "that", "have", "i",
    "it", "for", "not", "on", "with", "he", "as", "you", "do", "at",
    "this", "but", "his", "by", "from", "they", "we", "say", "her", "she",
    "or", "an", "will", "my", "one", "all", "would", "there", "their",
    "what", "so", "up", "out", "if", "about", "who", "get", "which", "go",
    "me", "when", "make", "can", "like", "time", "no", "just", "him", "know",
    "take", "people", "into", "year", "your", "good", "some", "could", "them",
    "see", "other", "than", "then", "now", "look", "only", "come", "its", "over",
    "think", "also", "back", "after", "use", "two", "how", "our", "work", "first",
    "well", "way", "even", "new", "want", "because", "any", "these", "give", "day",
    "most", "us", "is", "are", "was", "were", "been", "being", "has", "had",
    "having", "does", "did", "doing", "said", "says", "get", "got", "getting",
  ]);

  function extractTextFromHtml(html) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const text = doc.body?.textContent || doc.documentElement?.textContent || "";
      return text;
    } catch (e) {
      diag("analysisExtractTextError", String(e));
      return html.replace(/<[^>]+>/g, " ");
    }
  }

  function filterRealWords(text) {
    // Decode common HTML entities without using innerHTML.
    // Note: inputs often already come from DOMParser.textContent (entities decoded), but keep this
    // for robustness when called with raw text.
    let cleanText = String(text || "");
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(`<!doctype html><body>${cleanText}</body>`, "text/html");
      cleanText = doc.body?.textContent || cleanText;
    } catch (e) {
      // ignore
    }

    // Extract words (alphanumeric sequences, at least 2 characters)
    const words = cleanText
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((word) => {
        // Filter: at least 2 chars, not pure numbers, not stop words
        return (
          word.length >= 2 &&
          !/^\d+$/.test(word) &&
          !STOP_WORDS.has(word)
        );
      });

    return words;
  }

  function calculateWordFrequency(text) {
    const words = filterRealWords(text);
    const frequency = {};
    let total = 0;

    words.forEach((word) => {
      frequency[word] = (frequency[word] || 0) + 1;
      total++;
    });

    // Convert to distribution (percentages)
    const distribution = {};
    Object.keys(frequency).forEach((word) => {
      distribution[word] = frequency[word] / total;
    });

    // Sort by frequency and take top words
    const sorted = Object.entries(distribution)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 100); // Top 100 words

    return {
      distribution,
      topWords: sorted.map(([word]) => word),
      frequencies: frequency,
      totalWords: total,
    };
  }

  function calculateSimpleEmbedding(text) {
    // Simple hash-based 64-d embedding
    // This is a lightweight approach - for better results, use a proper embedding API/model
    const words = filterRealWords(text);
    const embedding = new Array(64).fill(0);

    words.forEach((word) => {
      // Simple hash function
      let hash = 0;
      for (let i = 0; i < word.length; i++) {
        hash = ((hash << 5) - hash + word.charCodeAt(i)) & 0xffffffff;
      }
      hash = Math.abs(hash);

      // Distribute hash across dimensions
      for (let i = 0; i < 64; i++) {
        embedding[i] += (hash % (i + 1)) / 64.0;
      }
    });

    // Normalize to 0-1 range
    const max = Math.max(...embedding);
    if (max > 0) {
      for (let i = 0; i < 64; i++) {
        embedding[i] = embedding[i] / max;
      }
    }

    return embedding;
  }

  function analyzeContent(html) {
    try {
      const text = extractTextFromHtml(html);
      const frequency = calculateWordFrequency(text);
      const embedding = calculateSimpleEmbedding(text);

      return {
        embedding,
        frequency: frequency.distribution,
        topWords: frequency.topWords,
        totalWords: frequency.totalWords,
      };
    } catch (e) {
      diag("analysisError", String(e));
      return {
        embedding: new Array(64).fill(0),
        frequency: {},
        topWords: [],
        totalWords: 0,
      };
    }
  }

  cof.analysis = {
    analyzeContent,
    calculateWordFrequency,
    calculateSimpleEmbedding,
    extractTextFromHtml,
    filterRealWords,
  };
})();

