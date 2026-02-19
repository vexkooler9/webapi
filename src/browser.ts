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

export async function extractElements(page: Page): Promise<ExtractedElement[]> {
  const selector = 'button, a[href], input:not([type="hidden"]), textarea, select, [role="button"], [tabindex]:not([tabindex="-1"])';

  const raw = await page.$$eval(selector, (els) => {
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
      if (tag === 'button' || tag === 'a' || role === 'button' || tabindex) {
        action = 'click';
      } else if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        action = 'input';
      }

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

function generateSelector(attrs: any): string {
  if (attrs.id) return '#' + attrs.id;
  if (attrs.dataTestid) return '[data-testid="' + attrs.dataTestid + '"]';
  if (attrs.ariaLabel) return '[aria-label="' + attrs.ariaLabel + '"]';
  if (attrs.name) return '[name="' + attrs.name + '"]';
  return attrs.tag || 'element';
}
