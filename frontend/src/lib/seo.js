import { useEffect } from 'react';

// Per-page title, meta description, canonical link and optional JSON-LD data,
// so search engines and link previews see meaningful information for every page.
const SITE = 'TechHaven';
const DEFAULT_DESCRIPTION = 'TechHaven - laptops, desktop PCs, monitors and computer components with genuine warranty, fast delivery and 10% loyalty points.';

function setMeta(attr, key, content) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

export function usePageMeta({ title, description, image, jsonLd } = {}) {
  const ld = jsonLd ? JSON.stringify(jsonLd) : '';
  useEffect(() => {
    const full = title ? `${title} - ${SITE}` : `${SITE} - Computers & Components`;
    const desc = (description || DEFAULT_DESCRIPTION).replace(/\s+/g, ' ').slice(0, 160);
    document.title = full;
    setMeta('name', 'description', desc);
    setMeta('property', 'og:title', full);
    setMeta('property', 'og:description', desc);
    setMeta('property', 'og:type', jsonLd ? 'product' : 'website');
    if (image) setMeta('property', 'og:image', new URL(image, window.location.origin).href);
    let link = document.head.querySelector('link[rel="canonical"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'canonical';
      document.head.appendChild(link);
    }
    link.href = window.location.origin + window.location.pathname;
    let script = document.getElementById('page-jsonld');
    if (ld) {
      if (!script) {
        script = document.createElement('script');
        script.type = 'application/ld+json';
        script.id = 'page-jsonld';
        document.head.appendChild(script);
      }
      script.textContent = ld;
    } else if (script) {
      script.remove();
    }
  }, [title, description, image, ld]);
}
