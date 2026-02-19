import { chromium, Browser, Page, BrowserContext } from 'playwright';

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
        executablePath: '/snap/bin/chromium',
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
          '--disable-extensions',
          '--disable-plugins',
          '--disable-infobars',
          '--user-data-dir=/tmp/chrome-profile-' + Math.random().toString(36).substring(7),
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
  const elements: ExtractedElement[] = [];
  
  const interactiveSelectors = [
    'button',
    'a[href]',
    'input:not([type="hidden"])',
    'textarea',
    'select',
    '[role="button"]',
    '[tabindex]:not([tabindex="-1"])'
  ];
  
  for (const selector of interactiveSelectors) {
    const els = await page.$$(selector);
    
    for (const el of els) {
      try {
        const element = await page.evaluate((e) => {
          const getAttr = (attr: string): string | undefined => {
            const val = e.getAttribute(attr);
            return val === null ? undefined : val;
          };
          
          return {
            tag: e.tagName.toLowerCase(),
            type: (e as HTMLInputElement).type || undefined,
            name: getAttr('name'),
            placeholder: getAttr('placeholder'),
            text: e.textContent?.trim().substring(0, 100),
            href: getAttr('href'),
            id: getAttr('id'),
            className: getAttr('class'),
            dataTestid: getAttr('data-testid'),
            ariaLabel: getAttr('aria-label'),
            role: getAttr('role'),
            tabindex: getAttr('tabindex')
          };
        }, el);
        
        const selector = generateSelector(element);
        
        let action: 'click' | 'input' | 'submit' | 'none' = 'none';
        if (element.tag === 'button' || element.tag === 'a' || element.role === 'button' || element.tabindex) {
          action = 'click';
        } else if (element.tag === 'input' || element.tag === 'textarea' || element.tag === 'select') {
          action = 'input';
        }
        
        const isVisible = await el.isVisible();
        if (!isVisible) continue;
        
        const extracted: ExtractedElement = {
          id: element.id || 'el-' + elements.length,
          tag: element.tag,
          type: element.type,
          name: element.name,
          placeholder: element.placeholder,
          text: element.text,
          href: element.href,
          action,
          selector,
          attributes: {
            className: element.className || '',
            dataTestid: element.dataTestid || '',
            ariaLabel: element.ariaLabel || '',
            role: element.role || ''
          }
        };
        
        elements.push(extracted);
      } catch (e) {
        // Element might have been removed
      }
    }
  }
  
  return elements;
}

function generateSelector(attrs: any): string {
  if (attrs.id) return '#' + attrs.id;
  if (attrs.dataTestid) return '[data-testid="' + attrs.dataTestid + '"]';
  if (attrs.ariaLabel) return '[aria-label="' + attrs.ariaLabel + '"]';
  if (attrs.name) return '[name="' + attrs.name + '"]';
  return attrs.tag || 'element';
}
