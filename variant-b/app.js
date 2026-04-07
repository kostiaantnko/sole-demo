// ─── Currency Manager ───────────────────────────────────────────────────────

const CURRENCIES = {
  USD: { symbol: '$', rate: 1,      locale: 'en-US', name: 'US Dollar',       flag: '🇺🇸' },
  GBP: { symbol: '£', rate: 0.79,   locale: 'en-GB', name: 'British Pound',   flag: '🇬🇧' },
  EUR: { symbol: '€', rate: 0.92,   locale: 'de-DE', name: 'Euro',            flag: '🇪🇺' },
  JPY: { symbol: '¥', rate: 149,    locale: 'ja-JP', name: 'Japanese Yen',    flag: '🇯🇵' },
};

const EU_COUNTRIES = new Set([
  'AT','BE','BG','CY','CZ','DE','DK','EE','ES','FI','FR','GR',
  'HR','HU','IE','IT','LT','LU','LV','MT','NL','PL','PT','RO',
  'SE','SI','SK',
]);

// Eurozone subset that actually uses EUR
const EUROZONE = new Set([
  'AT','BE','CY','DE','EE','ES','FI','FR','GR','IE','IT','LT',
  'LU','LV','MT','NL','PT','SI','SK',
]);

const CurrencyManager = {
  current: 'USD',
  mode: 'manual', // 'manual' | 'browser' | 'ip'
  ipDetected: null,
  ipCountry: null,

  init() {
    this.current = 'USD';
    this.mode = 'manual';
  },

  format(usdPrice) {
    const { locale } = CURRENCIES[this.current];
    const price = usdPrice * CURRENCIES[this.current].rate;
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: this.current,
      maximumFractionDigits: this.current === 'JPY' ? 0 : 2,
    }).format(price);
  },

  set(code, save = true) {
    if (!CURRENCIES[code]) return;
    this.current = code;
    if (save) localStorage.setItem('currency', code);
    document.dispatchEvent(new CustomEvent('currencyChange', { detail: code }));
  },

  setMode(mode) {
    this.mode = mode;
    localStorage.setItem('currencyMode', mode);
    if (mode === 'browser') this.detectFromBrowser(true);
    if (mode === 'ip') this.detectFromIP();
    // manual — keep current
    document.dispatchEvent(new CustomEvent('modeChange', { detail: mode }));
  },

  detectFromBrowser(save = true) {
    const langs = [...(navigator.languages || [navigator.language])];
    let detected = 'USD';
    for (const lang of langs) {
      const l = lang.toLowerCase();
      if (l.startsWith('ja')) { detected = 'JPY'; break; }
      if (l === 'en-gb' || l.startsWith('en-gb')) { detected = 'GBP'; break; }
      const region = lang.split('-')[1];
      if (region && EUROZONE.has(region.toUpperCase())) { detected = 'EUR'; break; }
      const primary = lang.split('-')[0];
      if (['de','fr','es','it','nl','pt','fi','el'].includes(primary)) { detected = 'EUR'; break; }
    }
    this.set(detected, save);
    return detected;
  },

  async detectFromIP() {
    try {
      const res = await fetch('https://ipapi.co/json/');
      if (!res.ok) throw new Error('API error');
      const data = await res.json();
      this.ipCountry = data.country_code;
      let detected = 'USD';
      if (data.country_code === 'GB') detected = 'GBP';
      else if (data.country_code === 'JP') detected = 'JPY';
      else if (EUROZONE.has(data.country_code)) detected = 'EUR';
      this.ipDetected = detected;
      this.set(detected, true);
      document.dispatchEvent(new CustomEvent('ipDetected', { detail: { currency: detected, country: data.country_name } }));
    } catch (e) {
      console.warn('IP detection failed:', e.message);
      document.dispatchEvent(new CustomEvent('ipDetectError'));
    }
  },
};

// ─── Cart ────────────────────────────────────────────────────────────────────

const Cart = {
  items: [],

  init() {
    const saved = localStorage.getItem('cart');
    this.items = saved ? JSON.parse(saved) : [];
  },

  save() {
    localStorage.setItem('cart', JSON.stringify(this.items));
  },

  add(product, size) {
    const existing = this.items.find(i => i.id === product.id && i.size === size);
    if (existing) {
      existing.qty += 1;
    } else {
      this.items.push({ id: product.id, name: product.name, brand: product.brand, price: product.price, size, qty: 1, image: product.images[0] });
    }
    this.save();
    this._emit();
  },

  remove(id, size) {
    this.items = this.items.filter(i => !(i.id === id && i.size === size));
    this.save();
    this._emit();
  },

  updateQty(id, size, qty) {
    const item = this.items.find(i => i.id === id && i.size === size);
    if (item) {
      if (qty <= 0) this.remove(id, size);
      else { item.qty = qty; this.save(); this._emit(); }
    }
  },

  total() {
    return this.items.reduce((sum, i) => sum + i.price * i.qty, 0);
  },

  count() {
    return this.items.reduce((sum, i) => sum + i.qty, 0);
  },

  clear() {
    this.items = [];
    this.save();
    this._emit();
  },

  _emit() {
    document.dispatchEvent(new CustomEvent('cartChange'));
  },
};

// ─── Currency Switcher UI ────────────────────────────────────────────────────

function buildCurrencyPanel() {
  const panel = document.createElement('div');
  panel.className = 'currency-panel';
  panel.innerHTML = `
    <button class="currency-trigger" aria-expanded="false">
      <span class="currency-trigger-flag">${CURRENCIES[CurrencyManager.current].flag}</span>
      <span class="currency-trigger-code">${CurrencyManager.current}</span>
      <svg class="chevron" width="10" height="6" viewBox="0 0 10 6" fill="none">
        <path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    </button>
    <div class="currency-dropdown" hidden>
      <div class="currency-options">
        ${Object.entries(CURRENCIES).map(([code, c]) => `
          <button class="currency-option ${CurrencyManager.current === code ? 'active' : ''}" data-code="${code}">
            <span>${c.flag}</span>
            <span class="currency-option-code">${code}</span>
            <span class="currency-option-name">${c.name}</span>
          </button>
        `).join('')}
      </div>
    </div>
  `;

  const trigger = panel.querySelector('.currency-trigger');
  const dropdown = panel.querySelector('.currency-dropdown');

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = !dropdown.hidden;
    dropdown.hidden = open;
    trigger.setAttribute('aria-expanded', String(!open));
  });

  document.addEventListener('click', () => {
    dropdown.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  });

  dropdown.addEventListener('click', e => e.stopPropagation());

  panel.querySelectorAll('.currency-option').forEach(btn => {
    btn.addEventListener('click', () => {
      CurrencyManager.set(btn.dataset.code);
      updatePanelUI(panel);
    });
  });

  document.addEventListener('currencyChange', () => updatePanelUI(panel));

  return panel;
}

function updatePanelUI(panel) {
  const code = CurrencyManager.current;
  panel.querySelector('.currency-trigger-flag').textContent = CURRENCIES[code].flag;
  panel.querySelector('.currency-trigger-code').textContent = code;
  panel.querySelectorAll('.currency-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.code === code);
  });
}

// ─── Geo Currency Notification (Variant B — persistent confirmed state) ───────

const GeoNotification = {
  APPEAR_DELAY: 1000,
  SWITCH_DELAY: 6000,

  init() {
    setTimeout(() => this.show({ currency: 'GBP', country: 'United Kingdom', flag: '🇬🇧' }), this.APPEAR_DELAY);
  },

  show({ currency, country, flag }) {
    const fromCode = CurrencyManager.current;

    const toast = document.createElement('div');
    toast.className = 'geo-toast';
    toast.innerHTML = `
      <div class="geo-toast-body">${flag} Your location is ${country}. Switching prices to ${currency}</div>
      <div class="geo-toast-spinner" aria-hidden="true"></div>
    `;

    document.body.appendChild(toast);

    setTimeout(() => this._apply(toast, currency, flag, fromCode), this.SWITCH_DELAY);
  },

  _apply(toast, currency, flag, fromCode) {
    CurrencyManager.set(currency);

    toast.querySelector('.geo-toast-body').innerHTML =
      `${flag} Now showing prices in ${currency}. <a class="geo-toast-link" href="#">Switch to ${fromCode}</a>`;

    const spinner = toast.querySelector('.geo-toast-spinner');
    spinner.outerHTML = `<button class="geo-toast-keep">Keep ${currency}</button>`;

    toast.querySelector('.geo-toast-link').addEventListener('click', (e) => {
      e.preventDefault();
      CurrencyManager.set(fromCode);
      this._dismiss(toast);
    });

    toast.querySelector('.geo-toast-keep').addEventListener('click', () => this._dismiss(toast), { once: true });

    // No auto-dismiss — stays until user interacts
  },

  _dismiss(toast) {
    toast.classList.add('geo-toast--out');
    setTimeout(() => toast.remove(), 240);
  },
};

// ─── Cart Badge ──────────────────────────────────────────────────────────────

function updateCartBadge() {
  const badge = document.querySelector('.cart-badge');
  if (!badge) return;
  const count = Cart.count();
  badge.textContent = count;
  badge.style.display = count > 0 ? 'flex' : 'none';
}

// ─── Init ────────────────────────────────────────────────────────────────────

function initApp() {
  CurrencyManager.init();
  Cart.init();

  // No currency panel in variant-b

  document.addEventListener('cartChange', updateCartBadge);
  updateCartBadge();

  GeoNotification.init();
}
