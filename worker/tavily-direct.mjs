// GO Brain Tavily Search Provider: bounded, read-only AI web search and extraction.
// Never leaks TAVILY_API_KEY into logs, receipts, or output payloads.

export const isTavilyTool = (name) =>
  ['tavily_search', 'tavily_extract', 'tavily_status'].includes(name);

export const TAVILY_TOOLS = [
  {
    name: 'tavily_status',
    description: 'Verify Tavily search provider connectivity and configuration without returning the API key.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false }
  },
  {
    name: 'tavily_search',
    description: 'Search the live web using Tavily AI Search with bounded results and clean text snippets.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 500 },
        search_depth: { type: 'string', enum: ['basic', 'advanced'] },
        max_results: { type: 'integer', minimum: 1, maximum: 10 }
      },
      required: ['query'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false }
  },
  {
    name: 'tavily_extract',
    description: 'Extract clean text content from up to 5 web URLs using Tavily.',
    inputSchema: {
      type: 'object',
      properties: {
        urls: {
          type: 'array',
          items: { type: 'string', minLength: 1, maxLength: 2000 },
          minItems: 1,
          maxItems: 5
        }
      },
      required: ['urls'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false }
  }
];

const TAVILY_API_URL = 'https://api.tavily.com';

function sanitizeError(msg) {
  if (typeof msg !== 'string') return 'UNKNOWN_ERROR';
  return msg.replace(/tvly-[a-zA-Z0-9_-]+/g, '[REDACTED_API_KEY]').slice(0, 200);
}

export async function tavilyDirect(env, name, args = {}, { fetchImpl = fetch } = {}) {
  if (!isTavilyTool(name)) return { ok: false, status: 'UNSUPPORTED' };
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { ok: false, status: 'INVALID_ARGUMENTS' };
  }

  const apiKey = env?.TAVILY_API_KEY;

  if (name === 'tavily_status') {
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      return { ok: false, status: 'TAVILY_API_KEY_NOT_CONFIGURED', configured: false };
    }
    return { ok: true, status: 'CONNECTED', configured: true };
  }

  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    return { ok: false, status: 'TAVILY_API_KEY_NOT_CONFIGURED' };
  }

  if (name === 'tavily_search') {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query || query.length > 500) {
      return { ok: false, status: 'INVALID_QUERY' };
    }

    const depth = args.search_depth === 'advanced' ? 'advanced' : 'basic';
    const limit = Number.isInteger(args.max_results) && args.max_results >= 1 && args.max_results <= 10
      ? args.max_results
      : 5;

    try {
      const res = await fetchImpl(`${TAVILY_API_URL}/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Go-Together/1.3.0'
        },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          search_depth: depth,
          include_answer: true,
          max_results: limit
        }),
        signal: AbortSignal.timeout(10000)
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        return {
          ok: false,
          status: 'TAVILY_UPSTREAM_ERROR',
          httpStatus: res.status,
          error: sanitizeError(errorText)
        };
      }

      const data = await res.json();
      return {
        ok: true,
        status: 'SUCCESS',
        query,
        answer: typeof data.answer === 'string' ? data.answer : null,
        results: Array.isArray(data.results)
          ? data.results.slice(0, limit).map((r) => ({
              title: typeof r.title === 'string' ? r.title : '',
              url: typeof r.url === 'string' ? r.url : '',
              content: typeof r.content === 'string' ? r.content.slice(0, 2000) : '',
              score: typeof r.score === 'number' ? r.score : null
            }))
          : []
      };
    } catch (err) {
      return {
        ok: false,
        status: 'TAVILY_REQUEST_FAILED',
        error: sanitizeError(err.message)
      };
    }
  }

  if (name === 'tavily_extract') {
    const urls = Array.isArray(args.urls) ? args.urls : [];
    if (urls.length === 0 || urls.length > 5 || !urls.every((u) => typeof u === 'string' && u.startsWith('http'))) {
      return { ok: false, status: 'INVALID_URLS' };
    }

    try {
      const res = await fetchImpl(`${TAVILY_API_URL}/extract`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Go-Together/1.3.0'
        },
        body: JSON.stringify({
          api_key: apiKey,
          urls
        }),
        signal: AbortSignal.timeout(15000)
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        return {
          ok: false,
          status: 'TAVILY_UPSTREAM_ERROR',
          httpStatus: res.status,
          error: sanitizeError(errorText)
        };
      }

      const data = await res.json();
      return {
        ok: true,
        status: 'SUCCESS',
        results: Array.isArray(data.results)
          ? data.results.slice(0, 5).map((r) => ({
              url: typeof r.url === 'string' ? r.url : '',
              rawContent: typeof r.raw_content === 'string' ? r.raw_content.slice(0, 8000) : ''
            }))
          : []
      };
    } catch (err) {
      return {
        ok: false,
        status: 'TAVILY_REQUEST_FAILED',
        error: sanitizeError(err.message)
      };
    }
  }

  return { ok: false, status: 'UNSUPPORTED' };
}
