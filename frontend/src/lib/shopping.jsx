import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { useAuth } from './auth';
import { useToast } from './toast';

// Browser-side lists: products to compare, recently viewed products and the
// guest wish list. Signed-in customers keep their wish list on the server.
const KEYS = { compare: 'techhaven.compare', recent: 'techhaven.recent', wish: 'techhaven.wishlist' };
export const MAX_COMPARE = 4;
const MAX_RECENT = 12;

function read(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

export function recordRecentlyViewed(slug) {
  write(KEYS.recent, [slug, ...read(KEYS.recent).filter((s) => s !== slug)].slice(0, MAX_RECENT));
}
export const recentlyViewed = () => read(KEYS.recent);

const ShoppingContext = createContext(null);

export function ShoppingProvider({ children }) {
  const { user } = useAuth();
  const toast = useToast();
  const [compare, setCompare] = useState(() => read(KEYS.compare));
  const [guestWish, setGuestWish] = useState(() => read(KEYS.wish)); // [{ id, slug }]
  const [serverWish, setServerWish] = useState([]); // product ids

  useEffect(() => {
    write(KEYS.compare, compare);
  }, [compare]);
  useEffect(() => {
    write(KEYS.wish, guestWish);
  }, [guestWish]);

  // On sign-in, merge the guest wish list into the account.
  useEffect(() => {
    if (!user) return;
    const local = read(KEYS.wish);
    const load = local.length
      ? api.post('/wishlist/merge', { productIds: local.map((x) => x.id) }).then((r) => { setGuestWish([]); return r; })
      : api.get('/wishlist?limit=1');
    load.then((r) => setServerWish(r.ids)).catch(() => {});
  }, [user]);

  const wishIds = useMemo(() => (user ? serverWish : guestWish.map((x) => x.id)), [user, serverWish, guestWish]);
  const inWishlist = useCallback((id) => wishIds.includes(id), [wishIds]);

  const toggleWishlist = useCallback(async (product) => {
    const on = wishIds.includes(product.id);
    if (user) {
      try {
        const r = on ? await api.del(`/wishlist/${product.id}`) : await api.put(`/wishlist/${product.id}`);
        setServerWish(r.ids);
      } catch (err) {
        return toast(err.message, 'danger');
      }
    } else {
      setGuestWish((cur) => (on ? cur.filter((x) => x.id !== product.id) : [{ id: product.id, slug: product.slug }, ...cur].slice(0, 100)));
    }
    toast(on ? 'Removed from your wish list' : 'Saved to your wish list', on ? 'secondary' : 'success');
  }, [user, wishIds, toast]);

  const toggleCompare = useCallback((product) => {
    setCompare((cur) => {
      if (cur.includes(product.slug)) return cur.filter((s) => s !== product.slug);
      if (cur.length >= MAX_COMPARE) {
        toast(`You can compare up to ${MAX_COMPARE} products`, 'warning');
        return cur;
      }
      return [...cur, product.slug];
    });
  }, [toast]);

  const value = {
    wishIds, inWishlist, toggleWishlist, guestWish,
    compare, toggleCompare, inCompare: (slug) => compare.includes(slug),
    removeCompare: (slug) => setCompare((c) => c.filter((s) => s !== slug)), clearCompare: () => setCompare([]),
  };
  return <ShoppingContext.Provider value={value}>{children}</ShoppingContext.Provider>;
}

export const useShopping = () => useContext(ShoppingContext);
