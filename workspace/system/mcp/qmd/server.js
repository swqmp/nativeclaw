#!/usr/bin/env node

// QMD — Queryable Memory Database
// MCP server that provides semantic search across all memory files
// Uses Gemini Embedding 2 (gemini-embedding-2-preview, free tier) for embeddings
// Zero external dependencies — Node.js built-in modules only

const fs = require('fs');
const path = require('path');
const https = require('https');
const readline = require('readline');

// ============================================================
// CONFIG
// ============================================================

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const WORKSPACE = process.env.QMD_WORKSPACE || path.join(process.env.HOME, '.claude', 'workspace');
const INDEX_PATH = path.join(WORKSPACE, 'system', 'mcp', 'qmd', 'index.json');
const EMBED_MODEL = 'gemini-embedding-2-preview';
const EMBED_DIMENSIONS = 1536;
const CHUNK_SIZE = 500; // ~500 words per chunk
const TOP_K = 10; // return top 10 results

// Directories to index
const SEARCH_DIRS = [
  path.join(WORKSPACE, 'memory'),
  path.join(WORKSPACE, 'feedback'),
  path.join(WORKSPACE, 'shared-memory'),
];

// Also index these specific files
const SEARCH_FILES = [
  path.join(WORKSPACE, 'MEMORY.md'),
  path.join(WORKSPACE, 'AGENTS.md'),
  path.join(WORKSPACE, 'SOUL.md'),
  path.join(WORKSPACE, 'USER.md'),
  path.join(WORKSPACE, 'TOOLS.md'),
];

// ============================================================
// GEMINI EMBEDDING API
// ============================================================

function embedText(text) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: `models/${EMBED_MODEL}`,
      content: { parts: [{ text }] },
      outputDimensionality: EMBED_DIMENSIONS,
    });

    const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${GEMINI_API_KEY}`);

    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            return reject(new Error(`Gemini API error: ${parsed.error.message}`));
          }
          if (parsed.embedding && parsed.embedding.values) {
            resolve(parsed.embedding.values);
          } else {
            reject(new Error(`Unexpected Gemini response: ${data.slice(0, 200)}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse Gemini response: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function embedBatch(texts) {
  // Gemini supports batch embedding
  return new Promise((resolve, reject) => {
    const requests = texts.map(text => ({
      model: `models/${EMBED_MODEL}`,
      content: { parts: [{ text }] },
      outputDimensionality: EMBED_DIMENSIONS,
    }));

    const payload = JSON.stringify({ requests });

    const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents?key=${GEMINI_API_KEY}`);

    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            return reject(new Error(`Gemini batch API error: ${parsed.error.message}`));
          }
          if (parsed.embeddings) {
            resolve(parsed.embeddings.map(e => e.values));
          } else {
            reject(new Error(`Unexpected batch response: ${data.slice(0, 200)}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse batch response: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ============================================================
// TEXT CHUNKING
// ============================================================

function chunkMarkdown(text, filePath) {
  const chunks = [];
  const lines = text.split('\n');
  let currentChunk = [];
  let currentHeader = '';
  let wordCount = 0;

  for (const line of lines) {
    // Track headers for context
    if (line.match(/^#{1,4}\s/)) {
      // If we have accumulated content, save it
      if (currentChunk.length > 0 && wordCount > 30) {
        chunks.push({
          text: currentChunk.join('\n').trim(),
          source: filePath,
          header: currentHeader,
        });
      }
      currentHeader = line.replace(/^#+\s*/, '').trim();
      currentChunk = [line];
      wordCount = line.split(/\s+/).length;
      continue;
    }

    currentChunk.push(line);
    wordCount += line.split(/\s+/).length;

    // Split on chunk size
    if (wordCount >= CHUNK_SIZE) {
      chunks.push({
        text: currentChunk.join('\n').trim(),
        source: filePath,
        header: currentHeader,
      });
      currentChunk = [];
      wordCount = 0;
    }
  }

  // Don't forget the last chunk
  if (currentChunk.length > 0 && wordCount > 30) {
    chunks.push({
      text: currentChunk.join('\n').trim(),
      source: filePath,
      header: currentHeader,
    });
  }

  return chunks;
}

// ============================================================
// INDEXING
// ============================================================

function collectFiles() {
  const files = [];

  for (const dir of SEARCH_DIRS) {
    if (!fs.existsSync(dir)) continue;
    const entries = fs.readdirSync(dir, { recursive: true });
    for (const entry of entries) {
      const full = path.join(dir, entry);
      if (fs.statSync(full).isFile() && full.endsWith('.md')) {
        files.push(full);
      }
    }
  }

  for (const file of SEARCH_FILES) {
    if (fs.existsSync(file)) {
      files.push(file);
    }
  }

  return [...new Set(files)]; // dedupe
}

function loadIndex() {
  if (fs.existsSync(INDEX_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
    } catch {
      return { chunks: [], fileHashes: {}, meta: {} };
    }
  }
  return { chunks: [], fileHashes: {}, meta: {} };
}

function saveIndex(index) {
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index));
}

function fileHash(filePath) {
  const stat = fs.statSync(filePath);
  return `${stat.size}_${stat.mtimeMs}`;
}

async function reindex() {
  const index = loadIndex();
  const firstEmbedding = index.chunks?.find(c => Array.isArray(c.embedding))?.embedding;
  const existingDimensions = index.meta?.embedDimensions || firstEmbedding?.length;
  const modelChanged = index.meta?.embedModel && index.meta.embedModel !== EMBED_MODEL;
  const dimensionsChanged = existingDimensions && existingDimensions !== EMBED_DIMENSIONS;

  if (modelChanged || dimensionsChanged) {
    process.stderr.write(`QMD: embedding config changed; rebuilding full index (model=${index.meta?.embedModel || 'unknown'}->${EMBED_MODEL}, dimensions=${existingDimensions || 'unknown'}->${EMBED_DIMENSIONS})\n`);
    index.chunks = [];
    index.fileHashes = {};
  }

  const files = collectFiles();
  const newFileHashes = {};
  let newChunks = [];
  let unchanged = 0;
  let reindexed = 0;

  // Figure out which files changed
  for (const file of files) {
    const hash = fileHash(file);
    const relPath = path.relative(WORKSPACE, file);
    newFileHashes[relPath] = hash;

    if (index.fileHashes[relPath] === hash) {
      // File unchanged, keep existing chunks
      const existing = index.chunks.filter(c => c.source === relPath);
      newChunks.push(...existing);
      unchanged++;
    } else {
      // File changed or new, re-chunk and re-embed
      const content = fs.readFileSync(file, 'utf8');
      const chunks = chunkMarkdown(content, relPath);

      if (chunks.length > 0) {
        // Batch embed with rate limiting (free tier: 100 req/min)
        for (let i = 0; i < chunks.length; i += 10) {
          const batch = chunks.slice(i, i + 10);
          const texts = batch.map(c => c.text);
          try {
            const embeddings = await embedBatch(texts);
            for (let j = 0; j < batch.length; j++) {
              newChunks.push({
                text: batch[j].text,
                source: batch[j].source,
                header: batch[j].header,
                embedding: embeddings[j],
              });
            }
          } catch (err) {
            process.stderr.write(`QMD: Failed to embed chunks from ${relPath}: ${err.message}\n`);
          }
          // Rate limit: wait between batches
          if (i + 10 < chunks.length) {
            await new Promise(r => setTimeout(r, 2000));
          }
        }
      }
      reindexed++;
    }
  }

  const result = {
    chunks: newChunks,
    fileHashes: newFileHashes,
    meta: {
      embedModel: EMBED_MODEL,
      embedDimensions: EMBED_DIMENSIONS,
      indexedAt: new Date().toISOString(),
    },
  };
  saveIndex(result);
  return { total: files.length, unchanged, reindexed, chunks: newChunks.length };
}

// ============================================================
// SEARCH
// ============================================================

function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// Extract date from source filename (e.g. memory/2026-03-25.md or shared-memory/<agent>/2026-03-25.md)
// Non-dated files (MEMORY.md, AGENTS.md, etc.) are treated as always current.
function extractDate(source) {
  const match = source.match(/(\d{4}-\d{2}-\d{2})/);
  if (match) return new Date(match[1]);
  return new Date(); // non-dated files treated as current
}

async function search(query, topK = TOP_K) {
  const index = loadIndex();
  if (index.chunks.length === 0) {
    return { results: [], message: 'Index is empty. Run reindex first.' };
  }

  // Embed the query
  const queryEmbedding = await embedText(query);
  const queryLower = query.toLowerCase();

  // Score all chunks with semantic similarity, recency weighting, and keyword boost
  const scored = index.chunks
    .filter(c => Array.isArray(c.embedding) && c.embedding.length === queryEmbedding.length)
    .map(chunk => {
      const similarity = cosineSimilarity(queryEmbedding, chunk.embedding);

      // Recency boost: newer files score higher
      const chunkDate = extractDate(chunk.source);
      const daysSince = (Date.now() - chunkDate.getTime()) / (1000 * 60 * 60 * 24);
      const recencyBoost = 1 / (1 + daysSince * 0.01);

      // Keyword boost: exact query string match in chunk text
      const keywordMatch = chunk.text.toLowerCase().includes(queryLower) ? 0.05 : 0;

      // Final score: 85% semantic, 15% recency, + keyword bonus
      const finalScore = similarity * 0.85 + recencyBoost * 0.15 + keywordMatch;

      return {
        text: chunk.text,
        source: chunk.source,
        header: chunk.header,
        score: finalScore,
        embedding: chunk.embedding,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK * 3); // grab extra candidates for deduplication

  // Deduplicate near-identical results (>90% cosine similarity)
  const deduped = [];
  for (const result of scored) {
    const isDuplicate = deduped.some(existing =>
      cosineSimilarity(existing.embedding, result.embedding) > 0.90
    );
    if (!isDuplicate) deduped.push(result);
    if (deduped.length >= topK) break;
  }

  // Strip embeddings from results to avoid bloating the response
  const results = deduped.map(({ embedding, ...rest }) => rest);

  return { results };
}

// ============================================================
// MCP PROTOCOL (JSON-RPC over stdio)
// ============================================================

const TOOLS = [
  {
    name: 'search_memory',
    description: 'Search across all memory files, daily logs, and feedback using natural language. Returns the most relevant chunks with source file and section. Use this when you need to recall past events, decisions, client interactions, or any historical context.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language search query (e.g., "when did Merick pay", "BBB networking event contacts", "Cedar Stone testimonial")',
        },
        top_k: {
          type: 'number',
          description: 'Number of results to return (default 10, max 20)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'reindex_memory',
    description: 'Re-scan and re-index all memory files. Run this after significant memory updates or if search results seem stale. Only re-embeds files that have changed since last index.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'memory_stats',
    description: 'Show stats about the memory index: how many files, chunks, last indexed, etc.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

async function handleToolCall(name, args) {
  switch (name) {
    case 'search_memory': {
      process.stderr.write(`QMD: search_memory called — query="${args.query}", top_k=${args.top_k || TOP_K}\n`);
      const topK = Math.min(args.top_k || TOP_K, 20);
      const result = await search(args.query, topK);
      process.stderr.write(`QMD: search_memory returned ${result.results?.length || 0} results\n`);

      if (result.results.length === 0) {
        return { content: [{ type: 'text', text: result.message || 'No results found.' }] };
      }

      const formatted = result.results.map((r, i) => {
        const score = (r.score * 100).toFixed(1);
        return `**[${i + 1}] ${r.source}${r.header ? ' > ' + r.header : ''}** (${score}% match)\n${r.text}`;
      }).join('\n\n---\n\n');

      return { content: [{ type: 'text', text: formatted }] };
    }

    case 'reindex_memory': {
      process.stderr.write(`QMD: reindex_memory called\n`);
      const stats = await reindex();
      process.stderr.write(`QMD: reindex complete — scanned=${stats.total}, reindexed=${stats.reindexed}, chunks=${stats.chunks}\n`);
      return {
        content: [{
          type: 'text',
          text: `Reindex complete.\n- Files scanned: ${stats.total}\n- Unchanged (skipped): ${stats.unchanged}\n- Re-indexed: ${stats.reindexed}\n- Total chunks: ${stats.chunks}`,
        }],
      };
    }

    case 'memory_stats': {
      const index = loadIndex();
      const files = [...new Set(index.chunks.map(c => c.source))];
      const indexSize = fs.existsSync(INDEX_PATH)
        ? (fs.statSync(INDEX_PATH).size / 1024 / 1024).toFixed(2)
        : '0';

      return {
        content: [{
          type: 'text',
          text: `Memory Index Stats:\n- Indexed files: ${files.length}\n- Total chunks: ${index.chunks.length}\n- Index size: ${indexSize} MB\n- Embedding model: ${index.meta?.embedModel || 'unknown'}\n- Embedding dimensions: ${index.meta?.embedDimensions || 'unknown'}\n- Last indexed: ${index.meta?.indexedAt || 'unknown'}\n- Files:\n${files.map(f => '  - ' + f).join('\n')}`,
        }],
      };
    }

    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  }
}

// ============================================================
// MCP JSON-RPC HANDLER
// ============================================================

function sendResponse(id, result) {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, result });
  process.stdout.write(`${msg}\n`);
}

function sendError(id, code, message) {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
  process.stdout.write(`${msg}\n`);
}

async function handleMessage(message) {
  const { id, method, params } = message;

  switch (method) {
    case 'initialize':
      sendResponse(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'qmd', version: '1.0.0' },
      });
      break;

    case 'notifications/initialized':
      // No response needed for notifications
      break;

    case 'tools/list':
      sendResponse(id, { tools: TOOLS });
      break;

    case 'tools/call': {
      const { name, arguments: args } = params;
      try {
        const result = await handleToolCall(name, args || {});
        sendResponse(id, result);
      } catch (err) {
        sendResponse(id, {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true,
        });
      }
      break;
    }

    default:
      if (id) {
        sendError(id, -32601, `Method not found: ${method}`);
      }
  }
}

// ============================================================
// MAIN — Read JSON-RPC from stdin
// ============================================================

if (!GEMINI_API_KEY) {
  process.stderr.write('QMD: GEMINI_API_KEY environment variable required\n');
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin });

rl.on('line', async (line) => {
  if (!line.trim()) return;
  try {
    const message = JSON.parse(line);
    await handleMessage(message);
  } catch (err) {
    process.stderr.write(`QMD: Failed to parse message: ${err.message}\n`);
  }
});

process.stderr.write('QMD: Memory search server started\n');
