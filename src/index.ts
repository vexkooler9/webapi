import express from 'express';
import cors from 'cors';
import { extractElements, extractVisibleElementsWithBoxes, BrowserManager } from './browser.js';

const app = express();
const port = process.env.PORT || 8888;

app.use(cors());
app.use(express.json());

const browserManager = new BrowserManager();

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

// Configure stealth/proxy options
app.post('/config', (req, res) => {
  const { proxy, userAgent, rotateUA, viewport } = req.body;
  
  browserManager.setOptions({
    proxy,
    userAgent,
    rotateUA: rotateUA === true,
    viewport
  });
  
  res.json({ 
    status: 'ok', 
    message: 'Configuration updated',
    options: { proxy, userAgent, rotateUA, viewport }
  });
});

app.get('/config', (req, res) => {
  res.json({ status: 'ok', message: 'Use POST to update config' });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Extract elements from a URL
app.get('/elements', async (req, res) => {
  const { url, timeoutMs } = req.query;
  
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing url parameter' });
  }
  
  try {
    const targetUrl = normalizeUrl(url);
    const parsedTimeout = Number(timeoutMs);
    const effectiveTimeout = Number.isFinite(parsedTimeout)
      ? Math.min(Math.max(parsedTimeout, 3000), 120000)
      : 30000;

    const extraction = await browserManager.withPage(async (page) => {
      const response = await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: effectiveTimeout });
      const status = response?.status() ?? null;
      const finalUrl = page.url();
      const elements = await extractElements(page);
      return { elements, status, finalUrl, timeoutMs: effectiveTimeout };
    });

    if (extraction.elements.length === 0) {
      const statusHint = extraction.status ? ` (HTTP ${extraction.status})` : '';
      return res.status(422).json({
        ok: false,
        url: targetUrl,
        finalUrl: extraction.finalUrl,
        status: extraction.status,
        elements: [],
        count: 0,
        timeoutMs: extraction.timeoutMs,
        error: `Extraction failed: no interactive elements were found${statusHint}. The site may be blocking automation or returned non-usable content.`,
      });
    }

    res.json({
      ok: true,
      url: targetUrl,
      finalUrl: extraction.finalUrl,
      status: extraction.status,
      elements: extraction.elements,
      count: extraction.elements.length,
      timeoutMs: extraction.timeoutMs,
    });
  } catch (err) {
    const error = err as Error;
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Screenshot + visible element scan (vision-style)
app.get('/scan-screenshot', async (req, res) => {
  const { url, timeoutMs } = req.query;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ ok: false, error: 'Missing url parameter' });
  }

  try {
    const targetUrl = normalizeUrl(url);
    const parsedTimeout = Number(timeoutMs);
    const effectiveTimeout = Number.isFinite(parsedTimeout)
      ? Math.min(Math.max(parsedTimeout, 3000), 120000)
      : 30000;

    const scan = await browserManager.withPage(async (page) => {
      const response = await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: effectiveTimeout });
      const status = response?.status() ?? null;
      const finalUrl = page.url();
      const title = await page.title();
      const elements = await extractVisibleElementsWithBoxes(page);
      const screenshot = await page.screenshot({ fullPage: false, type: 'png' });
      const viewport = page.viewportSize();
      return { status, finalUrl, title, elements, screenshot: screenshot.toString('base64'), timeoutMs: effectiveTimeout, viewport };
    });

    const blockedByStatus = scan.status === 401 || scan.status === 403 || scan.status === 429;
    const blockedByTitle = /access denied|forbidden|captcha|attention required/i.test(scan.title || '');
    if (blockedByStatus || blockedByTitle) {
      return res.status(422).json({
        ok: false,
        blocked: true,
        url: targetUrl,
        finalUrl: scan.finalUrl,
        status: scan.status,
        title: scan.title,
        elements: [],
        count: 0,
        timeoutMs: scan.timeoutMs,
        viewport: scan.viewport,
        error: 'Target site blocked access (403/anti-bot). Screenshot results are hidden for this page.',
      });
    }

    if (!scan.elements.length) {
      return res.status(422).json({
        ok: false,
        url: targetUrl,
        finalUrl: scan.finalUrl,
        status: scan.status,
        title: scan.title,
        screenshot: scan.screenshot,
        elements: [],
        count: 0,
        timeoutMs: scan.timeoutMs,
        viewport: scan.viewport,
        error: 'Screenshot scan found no visible interactive elements.',
      });
    }

    return res.json({
      ok: true,
      url: targetUrl,
      finalUrl: scan.finalUrl,
      status: scan.status,
      title: scan.title,
      screenshot: scan.screenshot,
      elements: scan.elements,
      count: scan.elements.length,
      timeoutMs: scan.timeoutMs,
      viewport: scan.viewport,
    });
  } catch (err) {
    const error = err as Error;
    return res.status(500).json({ ok: false, error: error.message });
  }
});

// Get screenshot
app.get('/screenshot', async (req, res) => {
  const { url } = req.query;
  
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing url parameter' });
  }
  
  try {
    const targetUrl = normalizeUrl(url);
    const screenshot = await browserManager.withPage(async (page) => {
      await page.goto(targetUrl, { waitUntil: 'networkidle' });
      return await page.screenshot({ fullPage: false });
    });
    
    res.json({ url: targetUrl, screenshot: screenshot.toString('base64') });
  } catch (err) {
    const error = err as Error;
    res.status(500).json({ error: error.message });
  }
});

// Click an element
app.post('/click', async (req, res) => {
  const { url, selector } = req.body;
  
  if (!url || !selector) {
    return res.status(400).json({ error: 'Missing url or selector' });
  }
  
  try {
    const targetUrl = normalizeUrl(url);
    const result = await browserManager.withPage(async (page) => {
      await page.goto(targetUrl, { waitUntil: 'networkidle' });
      await page.click(selector);
      return { success: true };
    });
    
    res.json(result);
  } catch (err) {
    const error = err as Error;
    res.status(500).json({ error: error.message });
  }
});

// Type into an input
app.post('/type', async (req, res) => {
  const { url, selector, text } = req.body;
  
  if (!url || !selector || !text) {
    return res.status(400).json({ error: 'Missing url, selector, or text' });
  }
  
  try {
    const targetUrl = normalizeUrl(url);
    const result = await browserManager.withPage(async (page) => {
      await page.goto(targetUrl, { waitUntil: 'networkidle' });
      await page.fill(selector, text);
      return { success: true, typed: text };
    });
    
    res.json(result);
  } catch (err) {
    const error = err as Error;
    res.status(500).json({ error: error.message });
  }
});

// Submit a form
app.post('/submit', async (req, res) => {
  const { url, selector } = req.body;
  
  if (!url || !selector) {
    return res.status(400).json({ error: 'Missing url or selector' });
  }
  
  try {
    const targetUrl = normalizeUrl(url);
    const result = await browserManager.withPage(async (page) => {
      await page.goto(targetUrl, { waitUntil: 'networkidle' });
      await page.click(selector);
      await page.waitForLoadState('networkidle');
      return { success: true };
    });
    
    res.json(result);
  } catch (err) {
    const error = err as Error;
    res.status(500).json({ error: error.message });
  }
});

// Get page state
app.get('/state', async (req, res) => {
  const { url } = req.query;
  
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing url parameter' });
  }
  
  try {
    const targetUrl = normalizeUrl(url);
    const state = await browserManager.withPage(async (page) => {
      await page.goto(targetUrl, { waitUntil: 'networkidle' });
      const title = await page.title();
      const currentUrl = page.url();
      const elements = await extractElements(page);
      return { title, url: currentUrl, elementCount: elements.length };
    });
    
    res.json(state);
  } catch (err) {
    const error = err as Error;
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.listen(port, () => {
  console.log(`WebAPI server running on http://localhost:${port}`);
  console.log(`Endpoints:
  GET  /elements        ?url=<url>     - Extract interactive elements
  GET  /scan-screenshot ?url=<url>     - Screenshot + visible element scan
  GET  /screenshot      ?url=<url>     - Get page screenshot
  POST /click                          - Click an element
  POST /type                    - Type into an input
  POST /submit                  - Submit a form
  GET  /state     ?url=<url>     - Get page state
  POST /config                  - Configure stealth/proxy options`);
});
