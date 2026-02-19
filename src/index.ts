import express from 'express';
import cors from 'cors';
import { extractElements, BrowserManager } from './browser.js';

const app = express();
const port = process.env.PORT || 8888;

app.use(cors());
app.use(express.json());

const browserManager = new BrowserManager();

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
  const { url } = req.query;
  
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing url parameter' });
  }
  
  try {
    const elements = await browserManager.withPage(async (page) => {
      await page.goto(url, { waitUntil: 'networkidle' });
      return extractElements(page);
    });
    
    res.json({ url, elements, count: elements.length });
  } catch (err) {
    const error = err as Error;
    res.status(500).json({ error: error.message });
  }
});

// Get screenshot
app.get('/screenshot', async (req, res) => {
  const { url } = req.query;
  
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing url parameter' });
  }
  
  try {
    const screenshot = await browserManager.withPage(async (page) => {
      await page.goto(url, { waitUntil: 'networkidle' });
      return await page.screenshot({ fullPage: false });
    });
    
    res.json({ url, screenshot: screenshot.toString('base64') });
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
    const result = await browserManager.withPage(async (page) => {
      await page.goto(url, { waitUntil: 'networkidle' });
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
    const result = await browserManager.withPage(async (page) => {
      await page.goto(url, { waitUntil: 'networkidle' });
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
    const result = await browserManager.withPage(async (page) => {
      await page.goto(url, { waitUntil: 'networkidle' });
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
    const state = await browserManager.withPage(async (page) => {
      await page.goto(url, { waitUntil: 'networkidle' });
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
  GET  /elements   ?url=<url>     - Extract interactive elements
  GET  /screenshot?url=<url>     - Get page screenshot  
  POST /click                    - Click an element
  POST /type                    - Type into an input
  POST /submit                  - Submit a form
  GET  /state     ?url=<url>     - Get page state
  POST /config                  - Configure stealth/proxy options`);
});
