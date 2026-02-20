import { chromium, Browser, Page } from 'playwright';

export interface ExtractedElement {
  id: string;
  tag: string;
  type?: string;
  name?: string;
  placeholder?: string;
  text?: string;
  href?: string;
  action: 'click' | 'input' | 'submit' | 'none';
  selector: string;
  attributes: Record<string, string>;
}

export interface BoxedElement extends ExtractedElement {
  bbox?: { x: number; y: number; width: number; height: number };
  confidence?: number;
}

export interface StealthOptions {
  proxy?: string;
  userAgent?: string;
  rotateUA?: boolean;
  viewport?: { width: number; height: number };
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
];

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 720 },
];

let uaIndex = 0;
let viewportIndex = 0;

function getNextUserAgent(): string {
  const ua = USER_AGENTS[uaIndex];
  uaIndex = (uaIndex + 1) % USER_AGENTS.length;
  return ua;
}

function getNextViewport(): { width: number; height: number } {
  const vp = VIEWPORTS[viewportIndex];
  viewportIndex = (viewportIndex + 1) % VIEWPORTS.length;
  return vp;
}

export class BrowserManager {
  private browser: Browser | null = null;
  private options: StealthOptions = {};
  
  setOptions(options: StealthOptions): void {
    this.options = options;
    if (this.browser) {
      this.close();
    }
  }
  
  async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      const launchOptions: any = {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-software-rasterizer',
          '--disable-blink-features=AutomationControlled',
        ]
      };

      if (this.options.proxy) {
        launchOptions.proxy = { server: this.options.proxy };
      }

      this.browser = await chromium.launch(launchOptions);
    }
    return this.browser;
  }
  
  async withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    const browser = await this.getBrowser();
    
    let userAgent = this.options.userAgent;
    if (!userAgent && this.options.rotateUA) {
      userAgent = getNextUserAgent();
    }
    
    const viewport = this.options.viewport || getNextViewport();
    
    const contextOptions: any = {
      viewport,
      userAgent,
      locale: 'en-US',
      timezoneId: 'America/Los_Angeles',
      colorScheme: 'light',
    };
    
    contextOptions.extraHTTPHeaders = {
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
    };

    const context = await browser.newContext(contextOptions);
    
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
        configurable: true
      });
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
        configurable: true
      });
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
        configurable: true
      });
    });

    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    
    const randomDelay = Math.floor(Math.random() * 1000) + 500;
    
    try {
      await new Promise(resolve => setTimeout(resolve, randomDelay));
      return await fn(page);
    } finally {
      await context.close();
    }
  }
  
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

const INTERACTIVE_SELECTOR = 'button, a[href], input:not([type="hidden"]), textarea, select, [role="button"], [tabindex]:not([tabindex="-1"])';

function mapRawElements(raw: any[]): ExtractedElement[] {
  return raw.map((element: any) => ({
    ...element,
    selector: generateSelector({
      id: element.attributes?.id || undefined,
      dataTestid: element.attributes?.dataTestid || undefined,
      ariaLabel: element.attributes?.ariaLabel || undefined,
      name: element.name,
      tag: element.tag,
    }),
  }));
}

export async function extractElements(page: Page): Promise<ExtractedElement[]> {
  const raw = await page.$$eval(INTERACTIVE_SELECTOR, (els) => {
    return els.map((e, i) => {
      const id = e.getAttribute('id');
      const name = e.getAttribute('name');
      const placeholder = e.getAttribute('placeholder');
      const href = e.getAttribute('href');
      const className = e.getAttribute('class');
      const dataTestid = e.getAttribute('data-testid');
      const ariaLabel = e.getAttribute('aria-label');
      const role = e.getAttribute('role');
      const tabindex = e.getAttribute('tabindex');

      const tag = e.tagName.toLowerCase();
      const type = (e as HTMLInputElement).type || undefined;

      let action: 'click' | 'input' | 'submit' | 'none' = 'none';
      if (tag === 'button' || tag === 'a' || role === 'button' || tabindex) action = 'click';
      else if (tag === 'input' || tag === 'textarea' || tag === 'select') action = 'input';

      return {
        id: id || `el-${i}`,
        tag,
        type,
        name: name || undefined,
        placeholder: placeholder || undefined,
        text: e.textContent?.trim()?.substring(0, 100),
        href: href || undefined,
        action,
        attributes: {
          id: id || '',
          className: className || '',
          dataTestid: dataTestid || '',
          ariaLabel: ariaLabel || '',
          role: role || '',
        },
      };
    });
  });

  return mapRawElements(raw);
}

export async function extractVisibleElementsWithBoxes(page: Page): Promise<BoxedElement[]> {
  const collect = (selector: string, confidence: number, includeTextOnly = false) => page.$$eval(selector, (els, cfg) => {
    const { conf, textOnly } = cfg as { conf: number; textOnly: boolean };
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    return els.map((e, i) => {
      const rect = e.getBoundingClientRect();
      const visible = rect.width > 8 && rect.height > 8 && rect.bottom > 0 && rect.right > 0 && rect.left < vw && rect.top < vh;
      if (!visible) return null;

      const text = e.textContent?.trim()?.replace(/\s+/g, ' ').substring(0, 120) || '';
      if (textOnly && text.length < 2) return null;

      const id = e.getAttribute('id');
      const name = e.getAttribute('name');
      const placeholder = e.getAttribute('placeholder');
      const href = e.getAttribute('href');
      const className = e.getAttribute('class');
      const dataTestid = e.getAttribute('data-testid');
      const ariaLabel = e.getAttribute('aria-label');
      const role = e.getAttribute('role');
      const tabindex = e.getAttribute('tabindex');
      const tag = e.tagName.toLowerCase();
      const type = (e as HTMLInputElement).type || undefined;

      let action: 'click' | 'input' | 'submit' | 'none' = 'none';
      if (tag === 'button' || tag === 'a' || role === 'button' || tabindex || textOnly) action = 'click';
      else if (tag === 'input' || tag === 'textarea' || tag === 'select') action = 'input';

      return {
        id: id || `el-${i}`,
        tag,
        type,
        name: name || undefined,
        placeholder: placeholder || undefined,
        text,
        href: href || undefined,
        action,
        bbox: {
          x: Math.max(0, Math.round(rect.left)),
          y: Math.max(0, Math.round(rect.top)),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        confidence: conf,
        attributes: {
          id: id || '',
          className: className || '',
          dataTestid: dataTestid || '',
          ariaLabel: ariaLabel || '',
          role: role || '',
        },
      };
    }).filter(Boolean);
  }, { conf: confidence, textOnly: includeTextOnly });

  let raw: any[] = await collect(INTERACTIVE_SELECTOR, 0.85, false);

  if (!raw.length) {
    raw = await collect('a, button, input, textarea, select, [role="button"], [onclick], h1, h2, h3, p, div, span', 0.55, true);
    raw = raw.slice(0, 50);
  }

  return mapRawElements(raw) as BoxedElement[];
}

function generateSelector(attrs: any): string {
  if (attrs.id) return '#' + attrs.id;
  if (attrs.dataTestid) return '[data-testid="' + attrs.dataTestid + '"]';
  if (attrs.ariaLabel) return '[aria-label="' + attrs.ariaLabel + '"]';
  if (attrs.name) return '[name="' + attrs.name + '"]';
  return attrs.tag || 'element';
}
