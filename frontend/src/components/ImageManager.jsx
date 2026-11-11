import { useRef, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

// Illustration images of a product: 1 to 10 images, uploaded from the computer
// (button or drag & drop) or added from an https URL. The first image is the
// cover shown in product lists. Changes are kept in the form until it is saved.
export default function ImageManager({ images, onChange }) {
  const { config } = useAuth();
  const limits = config.productImages || { min: 1, max: 10, maxBytes: 3 * 1024 * 1024 };
  const max = limits.max;
  const [busy, setBusy] = useState(0); // number of files being uploaded
  const [messages, setMessages] = useState([]);
  const [url, setUrl] = useState('');
  const [over, setOver] = useState(false);
  const [dragIndex, setDragIndex] = useState(null);
  const inputRef = useRef(null);

  const remaining = max - images.length - busy;
  const full = remaining <= 0;

  const addFiles = async (fileList) => {
    const files = [...fileList];
    if (!files.length) return;
    const notes = [];
    const accepted = [];
    for (const f of files) {
      if (!TYPES.includes(f.type)) notes.push(`${f.name}: only PNG, JPG, WEBP or GIF images are allowed`);
      else if (f.size > limits.maxBytes) notes.push(`${f.name}: larger than ${Math.round(limits.maxBytes / 1048576)} MB`);
      else if (accepted.length >= remaining) notes.push(`${f.name}: skipped, a product can have at most ${max} images`);
      else accepted.push(f);
    }
    setMessages(notes);
    if (!accepted.length) return;
    const fd = new FormData();
    accepted.forEach((f) => fd.append('images', f));
    setBusy(accepted.length);
    try {
      const { urls } = await api.post('/admin/uploads', fd);
      onChange((cur) => [...cur, ...urls].slice(0, max));
    } catch (err) {
      setMessages((m) => [...m, err.message]);
    } finally {
      setBusy(0);
    }
  };

  const addUrl = (e) => {
    e?.preventDefault();
    const value = url.trim();
    if (!/^https:\/\/\S{4,280}$/.test(value)) return setMessages(['Enter an https:// image address']);
    if (images.includes(value)) return setMessages(['This image is already in the list']);
    if (full) return setMessages([`A product can have at most ${max} images`]);
    onChange((cur) => [...cur, value]);
    setUrl('');
    setMessages([]);
  };

  const move = (from, to) => {
    if (to < 0 || to >= images.length || from === to) return;
    onChange((cur) => {
      const next = [...cur];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };
  const remove = (i) => onChange((cur) => cur.filter((_, j) => j !== i));

  return (
    <div className="card card-body">
      <div className="d-flex justify-content-between align-items-center mb-1">
        <h6 className="mb-0">Product images</h6>
        <span data-testid="image-count" className={`badge ${images.length === 0 ? 'text-bg-danger' : full ? 'text-bg-warning' : 'text-bg-light'}`}>{images.length} / {max}</span>
      </div>
      <div className="small text-muted mb-2">Add from {limits.min} to {max} illustration images. The first image is the cover; drag an image to reorder.</div>
      <div className="progress mb-3" style={{ height: 4 }} aria-hidden="true">
        <div className="progress-bar" style={{ width: `${(images.length / max) * 100}%` }} />
      </div>

      <div className="row g-2 mb-2" data-testid="image-grid">
        {images.map((src, i) => (
          <div
            className="col-6"
            key={`${src}-${i}`}
            draggable
            onDragStart={() => setDragIndex(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (dragIndex !== null) move(dragIndex, i); setDragIndex(null); }}
          >
            <div className={`image-tile ${dragIndex === i ? 'dragging' : ''}`}>
              <img src={src} alt={`Product image ${i + 1}`} />
              <span className="image-index">{i + 1}</span>
              {i === 0 ? (
                <span className="badge text-bg-primary image-cover">Cover</span>
              ) : (
                <button type="button" className="btn btn-sm btn-light image-cover" onClick={() => move(i, 0)} title="Use as cover">
                  <i className="bi bi-star" /> Cover
                </button>
              )}
              <div className="btn-group btn-group-sm image-actions">
                <button type="button" className="btn btn-light" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label="Move left"><i className="bi bi-arrow-left" /></button>
                <button type="button" className="btn btn-light" onClick={() => move(i, i + 1)} disabled={i === images.length - 1} aria-label="Move right"><i className="bi bi-arrow-right" /></button>
                <button type="button" className="btn btn-light text-danger" onClick={() => remove(i)} aria-label="Remove image"><i className="bi bi-trash" /></button>
              </div>
            </div>
          </div>
        ))}
        {Array.from({ length: busy }, (_, i) => (
          <div className="col-6" key={`busy-${i}`}>
            <div className="image-tile d-flex align-items-center justify-content-center text-muted"><span className="spinner-border spinner-border-sm me-2" />Uploading</div>
          </div>
        ))}
      </div>

      <div
        className={`drop-zone ${over ? 'over' : ''} ${full ? 'disabled' : ''}`}
        onDragOver={(e) => { e.preventDefault(); if (!full) setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!full && dragIndex === null) addFiles(e.dataTransfer.files); }}
        onClick={() => !full && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !full && inputRef.current?.click()}
        aria-disabled={full}
      >
        <i className="bi bi-cloud-arrow-up fs-3 d-block" />
        {full ? `Maximum of ${max} images reached` : <>Drop images here or <u>browse</u><div className="small text-muted">PNG, JPG, WEBP or GIF · up to {Math.round(limits.maxBytes / 1048576)} MB each · {remaining} more allowed</div></>}
        <input ref={inputRef} type="file" accept={TYPES.join(',')} multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
      </div>

      {/* Not a <form>: this block lives inside the product form. */}
      <div className="input-group input-group-sm mt-2">
        <input className="form-control" type="url" placeholder="or paste an https:// image URL" value={url} onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addUrl(e)} disabled={full} aria-label="Image URL" />
        <button type="button" className="btn btn-outline-primary" onClick={addUrl} disabled={full || !url.trim()}>Add</button>
      </div>

      {messages.length > 0 && (
        <div className="alert alert-warning small py-2 mt-2 mb-0">
          {messages.map((m) => <div key={m}>{m}</div>)}
        </div>
      )}
      {images.length > 0 && images.length < 3 && (
        <div className="small text-muted mt-2"><i className="bi bi-info-circle me-1" />Tip: three or more images give customers a full gallery.</div>
      )}
    </div>
  );
}
