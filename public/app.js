'use strict';

// Plain JavaScript storefront. No build step.
// All text is inserted with textContent / createTextNode, never innerHTML, so product names
// and other user-supplied values cannot inject markup (XSS).

// Filters live in the URL (?category=audio&sort=price_asc&instock=1&q=phone&page=2), so a refresh,
// the back button or a shared link shows the same list.
const initial = new URLSearchParams(location.search);
const SORT_KEYS = ['newest', 'price_asc', 'price_desc', 'name_asc'];
const LOW_STOCK = 5; // show "Only N left" at or below this

const state = {
  token: sessionStorage.getItem('token'),
  user: JSON.parse(sessionStorage.getItem('user') || 'null'),
  paymentsEnabled: false,
  page: Math.max(1, parseInt(initial.get('page'), 10) || 1),
  category: initial.get('category') || '',
  sort: SORT_KEYS.includes(initial.get('sort')) ? initial.get('sort') : 'newest',
  inStock: initial.get('instock') === '1',
  categories: [],
  authMode: 'login',
};

const $ = (id) => document.getElementById(id);
const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits:0 });

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && state.token) logout();
    const detail = Array.isArray(data.details) ? `: ${data.details.join(', ')}` : '';
    throw new Error((data.error || `Request failed (${res.status})`) + detail);
  }
  return data;
}

function notify(text, isError = false) {
  const msg = $('msg');
  msg.textContent = text;
  msg.className = isError ? 'msg error' : 'msg';
  // The side panel covers this message, so when it is open show the text there as well.
  if (text && !$('panel').hidden) {
    $('panel-body').querySelector('.loading')?.remove();
    panelNotify(text, isError);
  }
}

// ---------- theme ----------

// Light or dark follows the system setting until the visitor picks one with the button.
function savedTheme() {
  try {
    return localStorage.getItem('theme');
  } catch {
    return null; // storage blocked (private mode): fall back to the system setting
  }
}

function currentTheme() {
  const saved = savedTheme();
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('theme-btn').textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
  $('theme-btn').setAttribute('aria-pressed', String(theme === 'dark'));
}

// ---------- session ----------

function setSession(token, user) {
  state.token = token;
  state.user = user;
  if (token) {
    sessionStorage.setItem('token', token);
    sessionStorage.setItem('user', JSON.stringify(user));
  } else {
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('user');
  }
  renderNav();
  refreshCartCount();
}

function logout() {
  setSession(null, null);
  closePanel();
}

function renderNav() {
  const loggedIn = Boolean(state.user);
  $('who').textContent = loggedIn ? state.user.name : '';
  $('auth-btn').textContent = loggedIn ? 'Log out' : 'Log in';
  $('orders-btn').hidden = !loggedIn;
  $('admin-btn').hidden = !(loggedIn && state.user.role === 'admin');
}

// ---------- products ----------

async function loadCategories() {
  const { categories } = await api('/products/categories');
  state.categories = categories;
  renderCategories();
}

// "All" plus one chip per category. The active chip is marked for screen readers too.
function renderCategories() {
  const chip = (label, value) =>
    el(
      'button',
      {
        type: 'button',
        class: state.category === value ? 'chip active' : 'chip',
        'aria-pressed': String(state.category === value),
        onclick: () => {
          state.category = value;
          state.page = 1;
          renderCategories();
          loadProducts();
        },
      },
      label
    );
  $('categories').replaceChildren(chip('All', ''), ...state.categories.map((name) => chip(name, name)));
}

function syncUrl(q) {
  const url = new URLSearchParams();
  if (q) url.set('q', q);
  if (state.category) url.set('category', state.category);
  if (state.sort !== 'newest') url.set('sort', state.sort);
  if (state.inStock) url.set('instock', '1');
  if (state.page > 1) url.set('page', String(state.page));
  const qs = url.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

async function loadProducts() {
  const q = $('q').value.trim();
  const params = new URLSearchParams({ page: String(state.page), sort: state.sort });
  if (q) params.set('q', q);
  if (state.category) params.set('category', state.category);
  if (state.inStock) params.set('inStock', 'true');
  syncUrl(q);
  const grid = $('products');
  if (!grid.children.length) grid.replaceChildren(...skeletonCards());
  grid.setAttribute('aria-busy', 'true');
  try {
    const data = await api(`/products?${params}`);
    renderProducts(data);
    $('count').textContent = data.total === 1 ? '1 product' : `${data.total} products`;
    notify(data.total === 0 ? 'No products found. Try a different search or filter.' : '');
  } catch (err) {
    grid.replaceChildren();
    notify(err.message, true);
  } finally {
    grid.removeAttribute('aria-busy');
  }
}

// The same category always gets the same one of eight tints, so the grid is easy to scan.
function hueClass(category) {
  let sum = 0;
  for (const char of String(category)) sum += char.charCodeAt(0);
  return `hue-${sum % 8}`;
}

// Placeholder cards shown while the first page of products loads.
function skeletonCards(count = 6) {
  return Array.from({ length: count }, () =>
    el(
      'article',
      { class: 'card skeleton', 'aria-hidden': 'true' },
      el('div', { class: 'sk sk-thumb' }),
      el('div', { class: 'sk sk-line' }),
      el('div', { class: 'sk sk-line short' }),
      el('div', { class: 'sk sk-btn' })
    )
  );
}

// "Out of stock", "Only 3 left" (urgency, at or below LOW_STOCK) or "In stock".
function stockBadge(stock) {
  if (stock <= 0) return el('span', { class: 'stock out' }, 'Out of stock');
  if (stock <= LOW_STOCK) return el('span', { class: 'stock low' }, `Only ${stock} left`);
  return el('span', { class: 'stock' }, 'In stock');
}

function renderProducts({ items, page, pages }) {
  const grid = $('products');
  grid.replaceChildren(
    ...items.map((p) =>
      el(
        'article',
        { class: 'card' },
        el('div', { class: `thumb ${hueClass(p.category)}`, 'aria-hidden': 'true' }, p.name.slice(0, 2).toUpperCase()),
        el('span', { class: 'tag' }, p.category),
        el('h3', {}, p.name),
        el('p', {}, p.description),
        el('span', { class: 'price' }, money.format(p.price)),
        stockBadge(p.stock),
        el(
          'button',
          { class: 'primary', ...(p.stock > 0 ? {} : { disabled: '' }), onclick: (event) => addToCart(p._id, event.currentTarget) },
          'Add to cart'
        ),
        el('p', { class: 'cart-notice', role: 'status', 'aria-live': 'polite' })
      )
    )
  );

  const pager = $('pager');
  pager.replaceChildren();
  if (pages > 1) {
    pager.append(
      el('button', { ...(page > 1 ? {} : { disabled: '' }), onclick: () => { state.page -= 1; loadProducts(); } }, 'Previous'),
      el('span', {}, `Page ${page} of ${pages}`),
      el('button', { ...(page < pages ? {} : { disabled: '' }), onclick: () => { state.page += 1; loadProducts(); } }, 'Next')
    );
  }
}

// ---------- cart ----------

// A request is in flight: ignore extra clicks so a double click cannot place two orders
// or send two quantity changes.
let busy = false;

function panelNotify(text, isError = false) {
  const msg = $('panel-msg');
  msg.textContent = text;
  msg.className = isError ? 'msg error' : 'msg';
}

async function addToCart(productId, button) {
  if (!state.user) return openAuth('login');
  const notice = button.closest('.card').querySelector('.cart-notice');
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Adding...';
  try {
    const { cart } = await api('/cart/items', { method: 'POST', body: { productId, quantity: 1 } });
    $('cart-count').textContent = cart.itemCount;
    notice.className = 'cart-notice';
    notice.textContent = 'Added to your cart.';
  } catch (err) {
    notice.className = 'cart-notice error';
    notice.textContent = err.message;
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

async function refreshCartCount() {
  if (!state.user) {
    $('cart-count').textContent = '0';
    return;
  }
  try {
    const { cart } = await api('/cart');
    $('cart-count').textContent = cart.itemCount;
  } catch {
    // ignore: the session may have expired and logout() already ran
  }
}

// One cart line: name and price, a - / + stepper, the line total and a Remove button.
function cartLine(line) {
  const { product, quantity } = line;
  const limit = Math.min(99, product.stock);
  const short = quantity > product.stock;
  return el(
    'div',
    { class: short ? 'line cart-line short' : 'line cart-line' },
    el(
      'div',
      { class: 'line-info' },
      el('strong', {}, product.name),
      el('small', {}, `${money.format(product.price)} each`),
      short
        ? el('small', { class: 'warn' }, product.stock === 0 ? 'Out of stock' : `Only ${product.stock} left, lower the quantity`)
        : ''
    ),
    el(
      'div',
      { class: 'stepper' },
      el(
        'button',
        { type: 'button', 'aria-label': `Decrease quantity of ${product.name}`, onclick: () => changeQuantity(product.id, quantity - 1) },
        '−'
      ),
      el('span', { class: 'qty', 'aria-label': `Quantity of ${product.name}` }, String(quantity)),
      el(
        'button',
        {
          type: 'button',
          'aria-label': `Increase quantity of ${product.name}`,
          ...(quantity >= limit ? { disabled: '' } : {}),
          onclick: () => changeQuantity(product.id, quantity + 1),
        },
        '+'
      )
    ),
    el('strong', { class: 'line-total' }, money.format(line.lineTotal)),
    el('button', { type: 'button', class: 'link danger', 'aria-label': `Remove ${product.name}`, onclick: () => removeItem(product.id) }, 'Remove')
  );
}

// Open the panel straight away with a placeholder, so a slow request never looks like a dead button.
// Skipped when the same panel is already showing, so actions inside it do not flicker.
function panelLoading(title, wide = false) {
  if (!$('panel').hidden && $('panel-title').textContent === title) return;
  $('panel-body').replaceChildren(el('p', { class: 'empty loading' }, 'Loading...'));
  openPanel(title, wide);
}

// Renders the cart in the side panel. `note` is an optional { text, isError } message shown
// at the top, used to report the result of the action that triggered the re-render.
async function showCart(note) {
  if (!state.user) return openAuth('login');
  panelLoading('Your cart');
  try {
    const { cart } = await api('/cart');
    const body = $('panel-body');
    $('cart-count').textContent = cart.itemCount;
    if (cart.items.length === 0) {
      body.replaceChildren(
        el('p', { class: 'empty' }, 'Your cart is empty.'),
        el('button', { type: 'button', class: 'primary', onclick: closePanel }, 'Browse products')
      );
    } else {
      const blocked = cart.items.some((line) => line.quantity > line.product.stock);
      body.replaceChildren(
        ...cart.items.map(cartLine),
        el(
          'div',
          { class: 'cart-summary' },
          el('div', { class: 'total' }, el('span', {}, `Total (${cart.itemCount} ${cart.itemCount === 1 ? 'item' : 'items'})`), el('span', {}, money.format(cart.total))),
          el(
            'button',
            {
              id: 'checkout-btn',
              type: 'button',
              class: 'primary wide',
              ...(blocked ? { disabled: '' } : {}),
              onclick: showCheckout,
            },
            'Review order'
          ),
          blocked ? el('p', { class: 'error' }, 'Fix the highlighted items before placing your order.') : '',
          el(
            'div',
            { class: 'row' },
            el('button', { type: 'button', class: 'link', onclick: closePanel }, 'Continue shopping'),
            el('button', { type: 'button', class: 'link danger', onclick: clearCart }, 'Clear cart')
          )
        )
      );
    }
    openPanel('Your cart');
    if (note) panelNotify(note.text, note.isError);
  } catch (err) {
    notify(err.message, true);
  }
}

// Run one cart change, then redraw the cart. Errors (for example "Only 3 of X in stock")
// are shown inside the panel, where the user is looking, not behind it.
async function cartAction(run, successText) {
  if (busy) return;
  busy = true;
  let note = null;
  try {
    await run();
    if (successText) note = { text: successText, isError: false };
  } catch (err) {
    note = { text: err.message, isError: true };
  } finally {
    busy = false;
  }
  await showCart(note);
}

const changeQuantity = (productId, quantity) =>
  cartAction(() => api(`/cart/items/${productId}`, { method: 'PATCH', body: { quantity } }));

const removeItem = (productId) => cartAction(() => api(`/cart/items/${productId}`, { method: 'DELETE' }), 'Item removed.');

const clearCart = () => cartAction(() => api('/cart', { method: 'DELETE' }), 'Cart cleared.');

function addressText(address) {
  if (!address) return '';
  return [
    address.fullName,
    address.phone,
    address.addressLine1,
    address.addressLine2,
    [address.city, address.state, address.postalCode].filter(Boolean).join(', '),
    address.country,
  ]
    .filter(Boolean)
    .join(' · ');
}

async function showCheckout({ address = {}, note = '', noteIsError = false } = {}) {
  if (!state.user) return openAuth('login');
  panelLoading('Checkout', true);
  try {
    const { cart } = await api('/cart');
    if (!cart.items.length) return showCart({ text: 'Your cart is empty.', isError: true });

    const field = (name, label, value, options = {}) =>
      el(
        'label',
        { class: 'checkout-field' },
        label,
        el('input', {
          name,
          value: value || '',
          maxlength: String(options.maxlength || 200),
          autocomplete: options.autocomplete,
          ...(options.required === false ? {} : { required: '' }),
          ...(options.type ? { type: options.type } : {}),
          ...(options.pattern ? { pattern: options.pattern } : {}),
          ...(options.inputmode ? { inputmode: options.inputmode } : {}),
          ...(options.title ? { title: options.title } : {}),
        })
      );

    const paymentOptions = [
      el(
        'label',
        { class: 'payment-option' },
        el('input', { type: 'radio', name: 'paymentMethod', value: 'cod', checked: '', required: '' }),
        el('span', {}, el('strong', {}, 'Cash on delivery'), el('small', {}, 'Pay in cash when your order arrives'))
      ),
    ];
    if (state.paymentsEnabled && window.Razorpay) {
      paymentOptions.push(
        el(
          'label',
          { class: 'payment-option' },
          el('input', { type: 'radio', name: 'paymentMethod', value: 'razorpay', required: '' }),
          el('span', {}, el('strong', {}, 'Pay online'), el('small', {}, 'Secure checkout with Razorpay'))
        )
      );
    }

    const form = el(
      'form',
      { class: 'checkout-form', onsubmit: completeCheckout },
      el(
        'section',
        { class: 'checkout-section' },
        el('h3', {}, 'Delivery address'),
        field('fullName', 'Recipient name', address.fullName || state.user.name, {
          autocomplete: 'name',
          maxlength: 100,
        }),
        field('phone', 'Mobile number', address.phone, {
          type: 'tel',
          autocomplete: 'tel',
          pattern: '(?:\\+91[ -]?)?[6-9][0-9]{9}',
          title: 'Enter a 10-digit Indian mobile number, optionally prefixed with +91',
          maxlength: 14,
        }),
        field('addressLine1', 'Address line 1', address.addressLine1, {
          autocomplete: 'shipping address-line1',
        }),
        field('addressLine2', 'Address line 2 (optional)', address.addressLine2, {
          autocomplete: 'shipping address-line2',
          maxlength: 200,
          required: false,
        }),
        el(
          'div',
          { class: 'checkout-row' },
          field('city', 'City', address.city, { autocomplete: 'shipping address-level2', maxlength: 100 }),
          field('state', 'State', address.state, { autocomplete: 'shipping address-level1', maxlength: 100 })
        ),
        field('postalCode', 'PIN code', address.postalCode, {
          autocomplete: 'shipping postal-code',
          inputmode: 'numeric',
          pattern: '[1-9][0-9]{5}',
          title: 'Enter a valid 6-digit Indian PIN code',
          maxlength: 6,
        }),
        el('small', { class: 'checkout-country' }, 'Delivery country: India')
      ),
      el(
        'fieldset',
        { class: 'checkout-section payment-methods' },
        el('legend', {}, 'Payment method'),
        ...paymentOptions
      ),
      el(
        'section',
        { class: 'checkout-section checkout-review' },
        el('h3', {}, 'Review your order'),
        ...cart.items.map((line) =>
          el(
            'div',
            { class: 'checkout-item' },
            el('span', {}, `${line.quantity} × ${line.product.name}`),
            el('strong', {}, money.format(line.lineTotal))
          )
        ),
        el('div', { class: 'checkout-total' }, el('span', {}, 'Total'), el('strong', {}, money.format(cart.total)))
      ),
      el(
        'div',
        { class: 'row checkout-actions' },
        el('button', { type: 'button', class: 'link', onclick: () => showCart() }, 'Back to cart'),
        el('button', { type: 'submit', class: 'primary' }, 'Place COD order')
      )
    );
    form.querySelectorAll('input[name="paymentMethod"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (input.checked) {
          form.querySelector('[type="submit"]').textContent =
            input.value === 'cod' ? 'Place COD order' : 'Continue to payment';
        }
      });
    });

    $('panel-body').replaceChildren(form);
    openPanel('Checkout', true);
    if (note) panelNotify(note, noteIsError);
  } catch (err) {
    notify(err.message, true);
  }
}

async function completeCheckout(event) {
  event.preventDefault();
  if (busy) return;

  const form = event.currentTarget;
  const values = new FormData(form);
  const deliveryAddress = {
    fullName: values.get('fullName'),
    phone: values.get('phone'),
    addressLine1: values.get('addressLine1'),
    addressLine2: values.get('addressLine2'),
    city: values.get('city'),
    state: values.get('state'),
    postalCode: values.get('postalCode'),
  };
  const paymentMethod = values.get('paymentMethod');
  const submit = form.querySelector('[type="submit"]');
  busy = true;
  submit.disabled = true;
  submit.textContent = paymentMethod === 'cod' ? 'Placing COD order...' : 'Starting secure checkout...';

  try {
    if (paymentMethod === 'cod') {
      const { order } = await api('/orders', {
        method: 'POST',
        body: { paymentMethod, deliveryAddress },
      });
      busy = false;
      await Promise.all([loadProducts(), refreshCartCount()]);
      showOrderPlaced(order);
      return;
    }

    if (!state.paymentsEnabled || !window.Razorpay) {
      throw new Error('Online payment is unavailable. Select cash on delivery or try again later.');
    }
    const { payment } = await api('/payments/order', { method: 'POST', body: { deliveryAddress } });
    let finished = false;
    const checkout = new window.Razorpay({
      key: payment.keyId,
      amount: payment.amount,
      currency: payment.currency,
      name: 'Gada Electronics',
      description: 'Purchase from Gada Electronics',
      order_id: payment.orderId,
      prefill: { name: state.user.name, email: state.user.email },
      handler: async (response) => {
        try {
          const { order } = await api('/payments/verify', { method: 'POST', body: response });
          finished = true;
          busy = false;
          await Promise.all([loadProducts(), refreshCartCount()]);
          showOrderPlaced(order);
        } catch (err) {
          finished = true;
          busy = false;
          showPaymentIssue(err.message);
          await loadProducts();
        }
      },
      modal: {
        ondismiss: async () => {
          if (finished) return;
          finished = true;
          busy = false;
          await showCheckout({ address: deliveryAddress, note: 'Checkout closed. Your cart is unchanged.' });
        },
      },
    });
    checkout.on('payment.failed', (paymentEvent) => {
      panelNotify(paymentEvent.error?.description || 'Payment failed. You can try again.');
    });
    checkout.open();
  } catch (err) {
    busy = false;
    await showCheckout({ address: deliveryAddress, note: err.message, noteIsError: true });
  }
}

function showPaymentIssue(message) {
  $('panel-body').replaceChildren(
    el('p', { class: 'error' }, message),
    el('p', {}, 'If you were charged, please contact the store before trying checkout again.'),
    el(
      'div',
      { class: 'row' },
      el('button', { type: 'button', onclick: () => showOrders() }, 'Check my orders'),
      el('button', { type: 'button', class: 'link', onclick: closePanel }, 'Close')
    )
  );
  openPanel('Payment needs attention', true);
}

async function loadPaymentConfig() {
  try {
    const { enabled } = await api('/payments/config');
    if (enabled) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.async = true;
        script.onload = resolve;
        script.onerror = () => reject(new Error('Payment checkout could not be loaded. Check your connection and refresh.'));
        document.head.append(script);
      });
    }
    state.paymentsEnabled = enabled;
  } catch (err) {
    state.paymentsEnabled = false;
    notify(`Online payment setup failed. Cash on delivery is still available. ${err.message}`, true);
  } finally {
    if (!$('panel').hidden && $('panel-title').textContent === 'Your cart') {
      await showCart();
    }
  }
}

function showOrderPlaced(order) {
  $('panel-body').replaceChildren(
    el('p', { class: 'confirm' }, 'Thank you! Your order has been placed.'),
    el('p', {}, `Order ${order._id.slice(-6)}`),
    el('p', { class: 'order-meta' }, `Payment: ${paymentLabel(order)}`),
    el('p', { class: 'order-address' }, `Delivering to: ${addressText(order.deliveryAddress)}`),
    ...order.items.map((item) =>
      el('div', { class: 'line' }, el('span', {}, `${item.quantity} x ${item.name}`), el('strong', {}, money.format(item.price * item.quantity)))
    ),
    el('div', { class: 'total' }, el('span', {}, 'Total'), el('span', {}, money.format(order.total))),
    el(
      'div',
      { class: 'row' },
      el('button', { type: 'button', class: 'primary', onclick: () => showOrders() }, 'View my orders'),
      el('button', { type: 'button', class: 'link', onclick: closePanel }, 'Keep shopping')
    )
  );
  openPanel('Order placed');
}

// ---------- orders ----------

const STATUS_LABEL = { placed: 'Placed', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled' };
const dateTime = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

const statusBadge = (status) => el('span', { class: `status status-${status}` }, STATUS_LABEL[status] || status);

function paymentLabel(order) {
  if (order.paymentMethod === 'cod') {
    return order.paymentStatus === 'paid' ? 'Cash on delivery — collected' : 'Cash on delivery — due';
  }
  if (order.paymentMethod === 'razorpay') return 'Paid online';
  return 'Payment details unavailable';
}

// "All (5)  Placed (2)  Shipped (1) ..." Only statuses that exist are shown.
function statusFilter(orders, current, onPick) {
  const count = (status) => (status === 'all' ? orders.length : orders.filter((o) => o.status === status).length);
  const chip = (status, label) =>
    el(
      'button',
      {
        type: 'button',
        class: current === status ? 'chip active' : 'chip',
        'aria-pressed': String(current === status),
        onclick: () => onPick(status),
      },
      `${label} (${count(status)})`
    );
  return el(
    'div',
    { class: 'chips filter' },
    chip('all', 'All'),
    ...Object.keys(STATUS_LABEL).filter((s) => count(s) > 0).map((s) => chip(s, STATUS_LABEL[s]))
  );
}

// One order as a card: reference and status, date, items with line totals, total, then actions.
function orderCard(order, actions = [], customer = '') {
  return el(
    'article',
    { class: 'order' },
    el('div', { class: 'order-head' }, el('strong', {}, `Order ${order._id.slice(-6).toUpperCase()}`), statusBadge(order.status)),
    el('small', { class: 'order-meta' }, [dateTime.format(new Date(order.createdAt)), customer].filter(Boolean).join(' · ')),
    el('small', { class: 'order-meta' }, `Payment: ${paymentLabel(order)}`),
    ...(order.deliveryAddress ? [el('small', { class: 'order-address' }, `Deliver to: ${addressText(order.deliveryAddress)}`)] : []),
    ...order.items.map((item) =>
      el('div', { class: 'order-item' }, el('span', {}, `${item.quantity} x ${item.name}`), el('span', {}, money.format(item.price * item.quantity)))
    ),
    el('div', { class: 'order-foot' }, el('strong', {}, `Total ${money.format(order.total)}`), el('span', { class: 'actions' }, actions))
  );
}

async function showOrders({ filter = 'all', note } = {}) {
  panelLoading('Your orders');
  try {
    const { orders } = await api('/orders');
    const shown = filter === 'all' ? orders : orders.filter((o) => o.status === filter);
    const cards = shown.map((order) =>
      orderCard(
        order,
        order.status === 'placed'
          ? [el('button', { type: 'button', class: 'danger', onclick: () => cancelMyOrder(order._id, filter) }, 'Cancel order')]
          : []
      )
    );
    $('panel-body').replaceChildren(
      ...(orders.length ? [statusFilter(orders, filter, (status) => showOrders({ filter: status }))] : []),
      ...(cards.length ? cards : [el('p', { class: 'empty' }, orders.length ? 'No orders with this status.' : 'You have no orders yet.')])
    );
    openPanel('Your orders');
    if (note) panelNotify(note.text, note.isError);
  } catch (err) {
    notify(err.message, true);
  }
}

async function cancelMyOrder(id, filter) {
  if (!window.confirm('Cancel this order? The items go back into stock.')) return;
  let note;
  try {
    await api(`/orders/${id}/cancel`, { method: 'POST' });
    note = { text: 'Order cancelled.', isError: false };
    await loadProducts();
  } catch (err) {
    note = { text: err.message, isError: true };
  }
  showOrders({ filter, note });
}

// ---------- admin ----------

const NEXT_STATUS = { placed: ['shipped', 'cancelled'], shipped: ['delivered'] };
const ACTION_LABEL = { shipped: 'Mark shipped', delivered: 'Mark delivered', cancelled: 'Cancel order' };

// Admin panel with two tabs. `ctx` carries where we are, so that after every action the same
// tab, filter and search are redrawn together with a result message.
async function showAdmin(ctx = {}) {
  const view = { tab: 'orders', filter: 'all', q: '', ...ctx };
  panelLoading('Admin', true);
  try {
    const tabs = el(
      'div',
      { class: 'tabs', role: 'tablist' },
      ...[['orders', 'Orders'], ['products', 'Products']].map(([id, label]) =>
        el(
          'button',
          {
            type: 'button',
            role: 'tab',
            class: view.tab === id ? 'tab active' : 'tab',
            'aria-selected': String(view.tab === id),
            onclick: () => showAdmin({ tab: id }),
          },
          label
        )
      )
    );
    const content = view.tab === 'orders' ? await adminOrders(view) : await adminProducts(view);
    $('panel-body').replaceChildren(tabs, ...content);
    openPanel('Admin', true);
    if (view.note) panelNotify(view.note.text, view.note.isError);
  } catch (err) {
    notify(err.message, true);
  }
}

async function adminOrders(view) {
  const { orders } = await api('/orders?all=true');
  const shown = view.filter === 'all' ? orders : orders.filter((o) => o.status === view.filter);
  const who = (order) => (order.user && order.user.name ? `${order.user.name} (${order.user.email})` : 'deleted customer');
  const cards = shown.map((order) =>
    orderCard(
      order,
      (NEXT_STATUS[order.status] || []).map((next) =>
        el(
          'button',
          { type: 'button', class: next === 'cancelled' ? 'danger' : '', onclick: () => setOrderStatus(order._id, next, view) },
          ACTION_LABEL[next]
        )
      ),
      who(order)
    )
  );
  return [
    ...(orders.length ? [statusFilter(orders, view.filter, (filter) => showAdmin({ ...view, filter, note: undefined }))] : []),
    ...(cards.length ? cards : [el('p', { class: 'empty' }, orders.length ? 'No orders with this status.' : 'No orders yet.')]),
  ];
}

async function setOrderStatus(id, status, view) {
  if (status === 'cancelled' && !window.confirm('Cancel this order? The items go back into stock.')) return;
  let note;
  try {
    await api(`/orders/${id}/status`, { method: 'PATCH', body: { status } });
    note = { text: `Order marked ${STATUS_LABEL[status].toLowerCase()}.`, isError: false };
    await loadProducts();
  } catch (err) {
    note = { text: err.message, isError: true };
  }
  showAdmin({ ...view, note });
}

const MAX_ADMIN_PRODUCTS = 50;

async function adminProducts(view) {
  const params = new URLSearchParams({ limit: String(MAX_ADMIN_PRODUCTS), sort: 'name_asc' });
  if (view.q) params.set('q', view.q);
  const { items, total } = await api(`/products?${params}`);

  const num = (name, value, min, step) =>
    el('input', { name, type: 'number', value: String(value), min, step, required: '', 'aria-label': name });

  const addForm = el(
    'form',
    {
      class: 'admin-form',
      onsubmit: async (event) => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(event.target));
        const note = await run(
          () =>
            api('/products', {
              method: 'POST',
              body: { name: data.name, category: data.category, description: data.description, price: Number(data.price), stock: Number(data.stock) },
            }),
          `Added ${data.name}.`
        );
        showAdmin({ ...view, note });
      },
    },
    el('strong', {}, 'Add a product'),
    el('input', { name: 'name', placeholder: 'Name', required: '', maxlength: '150' }),
    el('input', { name: 'category', placeholder: 'Category (for example audio)', required: '' }),
    el('input', { name: 'description', placeholder: 'Description (optional)', maxlength: '2000' }),
    el('div', { class: 'row' }, el('input', { name: 'price', type: 'number', min: '0', step: '1', placeholder: 'Price (INR)', required: '' }), el('input', { name: 'stock', type: 'number', min: '0', step: '1', placeholder: 'Stock', required: '' })),
    el('button', { type: 'submit', class: 'primary' }, 'Add product')
  );

  const search = el(
    'form',
    {
      class: 'search-admin',
      onsubmit: (event) => {
        event.preventDefault();
        showAdmin({ ...view, q: new FormData(event.target).get('q').trim() });
      },
    },
    el('input', { name: 'q', type: 'search', value: view.q, placeholder: 'Search products', 'aria-label': 'Search products' }),
    el('button', { type: 'submit' }, 'Search')
  );

  const rows = items.map((p) =>
    el(
      'form',
      {
        class: 'prod-row',
        onsubmit: async (event) => {
          event.preventDefault();
          const data = Object.fromEntries(new FormData(event.target));
          const note = await run(
            () => api(`/products/${p._id}`, { method: 'PUT', body: { price: Number(data.price), stock: Number(data.stock) } }),
            `Saved ${p.name}.`
          );
          await loadProducts();
          showAdmin({ ...view, note });
        },
      },
      el('div', { class: 'prod-info' }, el('strong', {}, p.name), el('small', {}, p.category)),
      el('label', {}, 'Price', num('price', p.price, '0', '1')),
      el('label', {}, 'Stock', num('stock', p.stock, '0', '1')),
      el(
        'span',
        { class: 'actions' },
        el('button', { type: 'submit' }, 'Save'),
        el(
          'button',
          {
            type: 'button',
            class: 'danger',
            'aria-label': `Delete ${p.name}`,
            onclick: async () => {
              if (!window.confirm(`Delete ${p.name}? This cannot be undone.`)) return;
              const note = await run(() => api(`/products/${p._id}`, { method: 'DELETE' }), `Deleted ${p.name}.`);
              await Promise.all([loadProducts(), loadCategories()]);
              showAdmin({ ...view, note });
            },
          },
          'Delete'
        )
      )
    )
  );

  return [
    addForm,
    search,
    el('small', { class: 'count' }, total > MAX_ADMIN_PRODUCTS ? `Showing the first ${MAX_ADMIN_PRODUCTS} of ${total}. Use search to find others.` : `${total} products`),
    ...(rows.length ? rows : [el('p', { class: 'empty' }, 'No products found.')]),
  ];
}

// Run one API call and turn its outcome into a { text, isError } panel message.
async function run(call, successText) {
  try {
    await call();
    return { text: successText, isError: false };
  } catch (err) {
    return { text: err.message, isError: true };
  }
}

// ---------- panel and auth dialog ----------

function openPanel(title, wide = false) {
  $('panel-title').textContent = title;
  $('panel').classList.toggle('wide', wide);
  panelNotify('');
  $('panel').hidden = false;
}
function closePanel() {
  $('panel').hidden = true;
}

function openAuth(mode) {
  state.authMode = mode;
  const registering = mode === 'register';
  $('auth-title').textContent = registering ? 'Create an account' : 'Log in';
  $('auth-submit').textContent = registering ? 'Sign up' : 'Log in';
  $('auth-switch').textContent = registering ? 'I have an account' : 'Create an account';
  $('name-row').hidden = !registering;
  $('auth-name').required = registering;
  $('auth-password').autocomplete = registering ? 'new-password' : 'current-password';
  $('auth-error').textContent = '';
  $('auth-dialog').showModal();
}

$('auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const registering = state.authMode === 'register';
  const body = { email: $('auth-email').value, password: $('auth-password').value };
  if (registering) body.name = $('auth-name').value;
  try {
    const { token, user } = await api(registering ? '/auth/register' : '/auth/login', { method: 'POST', body });
    setSession(token, user);
    $('auth-form').reset();
    $('auth-dialog').close();
    notify(`Welcome, ${user.name}.`);
  } catch (err) {
    $('auth-error').textContent = err.message;
  }
});
$('auth-switch').addEventListener('click', () => openAuth(state.authMode === 'login' ? 'register' : 'login'));
$('auth-cancel').addEventListener('click', () => $('auth-dialog').close());

$('auth-btn').addEventListener('click', () => (state.user ? logout() : openAuth('login')));
$('cart-btn').addEventListener('click', () => showCart());
$('orders-btn').addEventListener('click', () => showOrders());
$('admin-btn').addEventListener('click', () => showAdmin());
$('panel-close').addEventListener('click', closePanel);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('panel').hidden) closePanel();
});

$('search').addEventListener('submit', (event) => {
  event.preventDefault();
  state.page = 1;
  loadProducts();
});
$('sort').addEventListener('change', () => {
  state.sort = $('sort').value;
  state.page = 1;
  loadProducts();
});
$('instock').addEventListener('change', () => {
  state.inStock = $('instock').checked;
  state.page = 1;
  loadProducts();
});

// ---------- footer version ----------

// The running version comes from /health. A local run reports a full git SHA: shorten that.
async function loadVersion() {
  try {
    const res = await fetch('/health');
    const { version } = await res.json();
    if (!version) return;
    $('version').textContent = /^[0-9a-f]{40}$/.test(version) ? `Build ${version.slice(0, 7)}` : `Version ${version}`;
  } catch {
    // footer stays empty: the version is a nicety, never a reason to show an error
  }
}

// ---------- start ----------

applyTheme(currentTheme());
$('theme-btn').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem('theme', next);
  } catch {
    // storage blocked: the choice still applies until the page is closed
  }
  applyTheme(next);
});
loadVersion();
loadPaymentConfig().catch((err) => notify(err.message, true));
renderNav();
$('q').value = initial.get('q') || '';
$('sort').value = state.sort;
$('instock').checked = state.inStock;
loadCategories().catch((err) => notify(err.message, true));
loadProducts();
refreshCartCount();

