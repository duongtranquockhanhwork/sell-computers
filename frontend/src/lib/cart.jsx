import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { useAuth } from './auth';

// The cart lives in the browser (localStorage) so guests can shop without an
// account and any API replica can serve them. Prices, stock, discount and
// points are always re-validated by the server through /cart/quote.
const KEY = 'techhaven.cart.v1';
const CODE_KEY = 'techhaven.discount';
const CartContext = createContext(null);

function load() {
  try {
    const items = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(items) ? items.filter((i) => i.variantId && i.quantity > 0) : [];
  } catch {
    return [];
  }
}

export function CartProvider({ children }) {
  const { user } = useAuth();
  const [items, setItems] = useState(load);
  // The code survives a page reload during checkout (per tab only).
  const [discountCode, setDiscountCode] = useState(() => {
    try { return sessionStorage.getItem(CODE_KEY) || ''; } catch { return ''; }
  });
  const [pointsToUse, setPointsToUse] = useState(0);
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [miniCartOpen, setMiniCartOpen] = useState(false); // drawer shown after "Add to cart"
  const seq = useRef(0);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(items));
    } catch {
      /* storage unavailable: cart stays in memory */
    }
  }, [items]);

  useEffect(() => {
    try {
      if (discountCode) sessionStorage.setItem(CODE_KEY, discountCode);
      else sessionStorage.removeItem(CODE_KEY);
    } catch {
      /* ignore */
    }
  }, [discountCode]);

  // Keep several open tabs in sync.
  useEffect(() => {
    const onStorage = (e) => e.key === KEY && setItems(load());
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const refreshQuote = useCallback(async () => {
    const id = ++seq.current;
    if (!items.length) {
      setQuote(null);
      return;
    }
    setQuoting(true);
    try {
      const q = await api.post('/cart/quote', {
        items: items.map(({ variantId, quantity }) => ({ variantId, quantity })),
        discountCode: discountCode || undefined,
        pointsToUse,
      });
      if (id === seq.current) setQuote(q);
    } catch {
      /* keep the last quote */
    } finally {
      if (id === seq.current) setQuoting(false);
    }
  }, [items, discountCode, pointsToUse]);

  useEffect(() => {
    const t = setTimeout(refreshQuote, 120);
    return () => clearTimeout(t);
  }, [refreshQuote, user]);

  const add = (variantId, quantity = 1, { openMiniCart = true } = {}) => {
    if (openMiniCart) setMiniCartOpen(true);
    setItems((prev) => {
      const found = prev.find((i) => i.variantId === variantId);
      if (found) return prev.map((i) => (i.variantId === variantId ? { ...i, quantity: Math.min(99, i.quantity + quantity) } : i));
      return [...prev, { variantId, quantity }];
    });
  };
  const setQuantity = (variantId, quantity) =>
    setItems((prev) => prev.map((i) => (i.variantId === variantId ? { ...i, quantity: Math.max(1, Math.min(99, quantity)) } : i)));
  const remove = (variantId) => setItems((prev) => prev.filter((i) => i.variantId !== variantId));
  const clear = () => {
    setItems([]);
    setDiscountCode('');
    setPointsToUse(0);
  };

  const count = useMemo(() => items.reduce((s, i) => s + i.quantity, 0), [items]);

  return (
    <CartContext.Provider
      value={{ items, count, add, miniCartOpen, setMiniCartOpen, setQuantity, remove, clear, quote, quoting, refreshQuote, discountCode, setDiscountCode, pointsToUse, setPointsToUse }}
    >
      {children}
    </CartContext.Provider>
  );
}

export const useCart = () => useContext(CartContext);
