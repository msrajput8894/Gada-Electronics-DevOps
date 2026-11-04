'use strict';

// Plain JavaScript storefront. No build step.
// All text is inserted with textContent / createTextNode, never innerHTML, so product names
// and other user-supplied values cannot inject markup (XSS).

const state = {
  token: sessionStorage.getItem('token'),
  user: JSON.parse(sessionStorage.getItem('user') || 'null'),
  page: 1,
  authMode: 'login',
};

const $ = (id) => document.getElementById(id);
const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

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
  const select = $('category');
  for (const name of categories) select.append(el('option', { value: name }, name));
}

async function loadProducts() {
  const params = new URLSearchParams({ page: String(state.page) });
  if ($('q').value.trim()) params.set('q', $('q').value.trim());
  if ($('category').value) params.set('category', $('category').value);
  try {
    const data = await api(`/products?${params}`);
    renderProducts(data);
    notify(data.total === 0 ? 'No products found.' : '');
  } catch (err) {
    notify(err.message, true);
  }
}

function renderProducts({ items, page, pages }) {
  const grid = $('products');
  grid.replaceChildren(
    ...items.map((p) =>
      el(
        'article',
        { class: 'card' },
        el('div', { class: 'thumb', 'aria-hidden': 'true' }, p.name.slice(0, 2).toUpperCase()),
        el('span', { class: 'tag' }, p.category),
        el('h3', {}, p.name),
        el('p', {}, p.description),
        el('span', { class: 'price' }, money.format(p.price)),
        el('span', { class: 'stock' }, p.stock > 0 ? `${p.stock} in stock` : 'Out of stock'),
        el(
          'button',
          { class: 'primary', ...(p.stock > 0 ? {} : { disabled: '' }), onclick: () => addToCart(p._id) },
          'Add to cart'
        )
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

async function addToCart(productId) {
  if (!state.user) return openAuth('login');
  try {
    const { cart } = await api('/cart/items', { method: 'POST', body: { productId, quantity: 1 } });
    $('cart-count').textContent = cart.itemCount;
    notify('Added to cart.');
  } catch (err) {
    notify(err.message, true);
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

async function showCart() {
  if (!state.user) return openAuth('login');
  try {
    const { cart } = await api('/cart');
    const body = $('panel-body');
    if (cart.items.length === 0) {
      body.replaceChildren(el('p', {}, 'Your cart is empty.'));
    } else {
      body.replaceChildren(
        ...cart.items.map((line) =>
          el(
            'div',
            { class: 'line' },
            el('div', {}, line.product.name, el('small', {}, `${money.format(line.product.price)} each`)),
            el('input', {
              type: 'number', min: '0', max: '99', value: String(line.quantity), 'aria-label': `Quantity of ${line.product.name}`,
              onchange: (event) => changeQuantity(line.product.id, Number(event.target.value)),
            }),
            el('strong', {}, money.format(line.lineTotal))
          )
        ),
        el('div', { class: 'total' }, el('span', {}, 'Total'), el('span', {}, money.format(cart.total))),
        el('button', { class: 'primary', onclick: checkout }, 'Place order')
      );
    }
    $('cart-count').textContent = cart.itemCount;
    openPanel('Your cart');
  } catch (err) {
    notify(err.message, true);
  }
}

async function changeQuantity(productId, quantity) {
  try {
    await api(`/cart/items/${productId}`, { method: 'PATCH', body: { quantity } });
  } catch (err) {
    notify(err.message, true);
  }
  showCart();
}

async function checkout() {
  try {
    await api('/orders', { method: 'POST' });
    notify('Order placed. Thank you!');
    await Promise.all([loadProducts(), refreshCartCount()]);
    showOrders();
  } catch (err) {
    notify(err.message, true);
  }
}

// ---------- orders ----------

const orderLine = (order, actions = []) =>
  el(
    'div',
    { class: 'line' },
    el(
      'div',
      {},
      `Order ${order._id.slice(-6)} · ${new Date(order.createdAt).toLocaleDateString()}`,
      el('small', {}, order.items.map((i) => `${i.quantity} x ${i.name}`).join(', '))
    ),
    el('div', {}, el('strong', {}, money.format(order.total)), ' ', el('span', { class: 'status' }, order.status), ' ', actions)
  );

async function showOrders() {
  try {
    const { orders } = await api('/orders');
    $('panel-body').replaceChildren(
      ...(orders.length ? orders.map((order) => orderLine(order)) : [el('p', {}, 'You have no orders yet.')])
    );
    openPanel('Your orders');
  } catch (err) {
    notify(err.message, true);
  }
}

// ---------- admin ----------

const NEXT_STATUS = { placed: ['shipped', 'cancelled'], shipped: ['delivered'] };

async function showAdmin() {
  try {
    const { orders } = await api('/orders?all=true');
    const field = (name, type, placeholder) =>
      el('input', { name, type, placeholder, required: '', ...(type === 'number' ? { min: '0' } : {}) });
    const form = el(
      'form',
      {
        class: 'admin-form',
        onsubmit: async (event) => {
          event.preventDefault();
          const data = Object.fromEntries(new FormData(event.target));
          try {
            await api('/products', {
              method: 'POST',
              body: { name: data.name, category: data.category, price: Number(data.price), stock: Number(data.stock) },
            });
            notify('Product added.');
            await loadProducts();
            showAdmin();
          } catch (err) {
            notify(err.message, true);
          }
        },
      },
      el('strong', {}, 'Add a product'),
      field('name', 'text', 'Name'),
      field('category', 'text', 'Category'),
      field('price', 'number', 'Price (INR)'),
      field('stock', 'number', 'Stock'),
      el('button', { type: 'submit', class: 'primary' }, 'Add product')
    );

    const lines = orders.map((order) =>
      orderLine(
        order,
        (NEXT_STATUS[order.status] || []).map((next) =>
          el('button', { class: next === 'cancelled' ? 'danger' : '', onclick: () => setOrderStatus(order._id, next) }, next)
        )
      )
    );
    $('panel-body').replaceChildren(form, el('strong', {}, 'All orders'), ...lines);
    openPanel('Admin');
  } catch (err) {
    notify(err.message, true);
  }
}

async function setOrderStatus(id, status) {
  try {
    await api(`/orders/${id}/status`, { method: 'PATCH', body: { status } });
    await loadProducts();
  } catch (err) {
    notify(err.message, true);
  }
  showAdmin();
}

// ---------- panel and auth dialog ----------

function openPanel(title) {
  $('panel-title').textContent = title;
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
$('cart-btn').addEventListener('click', showCart);
$('orders-btn').addEventListener('click', showOrders);
$('admin-btn').addEventListener('click', showAdmin);
$('panel-close').addEventListener('click', closePanel);

$('search').addEventListener('submit', (event) => {
  event.preventDefault();
  state.page = 1;
  loadProducts();
});
$('category').addEventListener('change', () => {
  state.page = 1;
  loadProducts();
});

// ---------- start ----------

renderNav();
loadCategories().catch((err) => notify(err.message, true));
loadProducts();
refreshCartCount();
