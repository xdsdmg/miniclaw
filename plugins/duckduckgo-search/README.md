# @miniclaw/duckduckgo-search

DuckDuckGo web search plugin for miniclaw. Enables the `web_search` tool using the Python `duckduckgo-search` library.

## Prerequisites

- Python 3.8+
- pip

## Installation

```bash
cd plugins/duckduckgo-search

# Install Python dependencies
pip install -r requirements.txt

# (Optional) Build TypeScript
npm install && npm run build
```

## How It Works

The plugin bridges Node.js (miniclaw) to the Python `duckduckgo-search` library:

1. When the LLM calls the `web_search` tool, `ToolExecutor.executeWebSearch()` lazily loads this plugin
2. `DuckDuckGoSearchProvider.search()` invokes `search.py` via `child_process`
3. `search.py` calls `DDGS().text()` and outputs JSON results to stdout
4. Results are parsed and formatted into a numbered list for the LLM

## Configuration

No configuration required. Defaults:
- Max results: 5
- Timeout: 15 seconds
- Body snippet: 200 characters per result

## Direct Usage (Testing)

```bash
# Test Python script directly
python3 search.py --query '"TypeScript 5.0 features"' --max-results 3

# Test TypeScript provider
npx ts-node src/index.ts
```
