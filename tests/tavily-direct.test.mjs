import test from "node:test";
import assert from "node:assert/strict";
import worker from "./hub-fixture.mjs";
import { tavilyDirect, isTavilyTool } from "../worker/tavily-direct.mjs";

const ROOT = "https://go-together.pureekangraw.workers.dev";
const owner = { access: { aud: "aud", getIdentity: async () => ({ email: "owner@example.com" }) } };
const base = {
  ACCESS_AUD: "aud",
  OWNER_EMAIL: "owner@example.com",
  DB: { prepare: () => ({ first: async () => ({ healthy: 1 }) }) },
  ASSETS: { fetch: async () => new Response("ok") }
};

const call = (env, name, args = {}, ctx = owner) =>
  worker.fetch(
    new Request(ROOT + "/mcp", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 42,
        method: "tools/call",
        params: { name, arguments: args }
      })
    }),
    env,
    ctx
  );

test("Tavily tools are discovered in MCP tools/list", async () => {
  const res = await worker.fetch(
    new Request(ROOT + "/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    }),
    base,
    owner
  );
  const list = (await res.json()).result.tools.map((x) => x.name);
  assert.ok(list.includes("tavily_status"), "missing tavily_status");
  assert.ok(list.includes("tavily_search"), "missing tavily_search");
  assert.ok(list.includes("tavily_extract"), "missing tavily_extract");
});

test("isTavilyTool recognizes exact Tavily tool names", () => {
  assert.equal(isTavilyTool("tavily_status"), true);
  assert.equal(isTavilyTool("tavily_search"), true);
  assert.equal(isTavilyTool("tavily_extract"), true);
  assert.equal(isTavilyTool("tavily_delete"), false);
  assert.equal(isTavilyTool("brain_search"), false);
});

test("tavily_status reports unconfigured when TAVILY_API_KEY is missing", async () => {
  const res = await tavilyDirect({}, "tavily_status");
  assert.equal(res.ok, false);
  assert.equal(res.status, "TAVILY_API_KEY_NOT_CONFIGURED");
  assert.equal(res.configured, false);
});

test("tavily_status reports CONNECTED when TAVILY_API_KEY is provided", async () => {
  const env = { TAVILY_API_KEY: "tvly-sample-test-key-12345" };
  const res = await tavilyDirect(env, "tavily_status");
  assert.equal(res.ok, true);
  assert.equal(res.status, "CONNECTED");
  assert.equal(res.configured, true);
  // Key itself must NEVER be returned
  assert.equal("apiKey" in res, false);
  assert.equal(JSON.stringify(res).includes("tvly-sample"), false);
});

test("tavily_search validates empty or oversized queries", async () => {
  const env = { TAVILY_API_KEY: "tvly-sample-key" };
  const emptyRes = await tavilyDirect(env, "tavily_search", { query: "" });
  assert.equal(emptyRes.ok, false);
  assert.equal(emptyRes.status, "INVALID_QUERY");

  const longRes = await tavilyDirect(env, "tavily_search", { query: "a".repeat(501) });
  assert.equal(longRes.ok, false);
  assert.equal(longRes.status, "INVALID_QUERY");
});

test("tavily_search calls upstream API with sanitized output", async () => {
  let capturedUrl = "";
  let capturedBody = null;

  const mockFetch = async (url, options) => {
    capturedUrl = url;
    capturedBody = JSON.parse(options.body);
    return new Response(
      JSON.stringify({
        answer: "Tavily search answer summary",
        results: [
          {
            title: "YGG Metro Documentation",
            url: "https://example.com/docs",
            content: "YGG Metro is an AI operator workstation platform.",
            score: 0.98
          }
        ]
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const env = { TAVILY_API_KEY: "tvly-sample-key" };
  const res = await tavilyDirect(
    env,
    "tavily_search",
    { query: "YGG Metro AGY", search_depth: "basic", max_results: 5 },
    { fetchImpl: mockFetch }
  );

  assert.equal(capturedUrl, "https://api.tavily.com/search");
  assert.equal(capturedBody.query, "YGG Metro AGY");
  assert.equal(capturedBody.api_key, "tvly-sample-key");
  assert.equal(res.ok, true);
  assert.equal(res.status, "SUCCESS");
  assert.equal(res.answer, "Tavily search answer summary");
  assert.equal(res.results.length, 1);
  assert.equal(res.results[0].title, "YGG Metro Documentation");
});

test("tavily_search redacts API key on upstream error", async () => {
  const mockFetch = async () =>
    new Response("Unauthorized tvly-secret-123456 invalid key", { status: 401 });

  const env = { TAVILY_API_KEY: "tvly-secret-123456" };
  const res = await tavilyDirect(
    env,
    "tavily_search",
    { query: "test query" },
    { fetchImpl: mockFetch }
  );

  assert.equal(res.ok, false);
  assert.equal(res.status, "TAVILY_UPSTREAM_ERROR");
  assert.equal(res.httpStatus, 401);
  assert.ok(!res.error.includes("tvly-secret-123456"));
  assert.ok(res.error.includes("[REDACTED_API_KEY]"));
});

test("tavily_extract validates and fetches content from URLs", async () => {
  let capturedBody = null;
  const mockFetch = async (url, options) => {
    capturedBody = JSON.parse(options.body);
    return new Response(
      JSON.stringify({
        results: [
          {
            url: "https://example.com/page1",
            raw_content: "Extracted page content text."
          }
        ]
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const env = { TAVILY_API_KEY: "tvly-test-key" };
  const res = await tavilyDirect(
    env,
    "tavily_extract",
    { urls: ["https://example.com/page1"] },
    { fetchImpl: mockFetch }
  );

  assert.equal(res.ok, true);
  assert.equal(res.results.length, 1);
  assert.equal(res.results[0].rawContent, "Extracted page content text.");
  assert.deepEqual(capturedBody.urls, ["https://example.com/page1"]);
});

test("MCP tools/call executes tavily_status over JSON-RPC", async () => {
  const env = { ...base, TAVILY_API_KEY: "tvly-test-key" };
  const r = await call(env, "tavily_status", {});
  assert.equal(r.status, 200);
  const parsed = JSON.parse((await r.json()).result.content[0].text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.status, "CONNECTED");
});

test("MCP tools/call sets isError when tavily tool fails unconfigured", async () => {
  const r = await call(base, "tavily_status", {});
  const json = await r.json();
  assert.equal(json.result.isError, true);
  const parsed = JSON.parse(json.result.content[0].text);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.status, "TAVILY_API_KEY_NOT_CONFIGURED");
});
