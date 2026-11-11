import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorAlert } from '../components/common';
import { AddressFields } from './Checkout';

function AuthCard({ title, subtitle, children }) {
  return (
    <div className="container py-5">
      <div className="row justify-content-center">
        <div className="col-md-8 col-lg-6 col-xl-5">
          <div className="card auth-card shadow-sm">
            <div className="card-body p-4 p-md-5">
              <h1 className="h4 mb-1">{title}</h1>
              {subtitle && <p className="text-muted small mb-4">{subtitle}</p>}
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function GoogleButton({ redirect }) {
  const { config } = useAuth();
  if (!config.googleEnabled) {
    return <button type="button" className="btn btn-outline-secondary w-100" disabled title="Ask the administrator to configure GOOGLE_CLIENT_ID"><i className="bi bi-google me-2" />Google sign-in not configured</button>;
  }
  return (
    <a className="btn btn-outline-dark w-100" href={`/api/auth/google?redirect=${encodeURIComponent(redirect || '/')}`}>
      <i className="bi bi-google me-2" />Continue with Google
    </a>
  );
}

const safeRedirect = (r) => (r && r.startsWith('/') && !r.startsWith('//') ? r : '/');

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = safeRedirect(params.get('redirect'));
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(params.get('error') ? new Error(params.get('error')) : null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { document.title = 'Sign in - TechHaven'; }, []);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await login(form.email, form.password);
      navigate(u.role === 'admin' && redirect === '/' ? '/admin' : redirect, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Welcome back" subtitle="Sign in to track orders, save addresses and use your loyalty points.">
      <ErrorAlert error={error} />
      <form onSubmit={submit} className="vstack gap-3">
        <div><label className="form-label" htmlFor="email">Email</label><input id="email" type="email" className="form-control" required autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
        <div>
          <div className="d-flex justify-content-between"><label className="form-label" htmlFor="pw">Password</label><Link to="/forgot-password" className="small">Forgot password?</Link></div>
          <input id="pw" type="password" className="form-control" required autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </div>
        <button className="btn btn-primary w-100" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
      </form>
      <div className="divider my-3"><span>or</span></div>
      <GoogleButton redirect={redirect} />
      <p className="small text-center mt-4 mb-0">New to TechHaven? <Link to={`/register${redirect !== '/' ? `?redirect=${encodeURIComponent(redirect)}` : ''}`}>Create an account</Link></p>
    </AuthCard>
  );
}

export function Register() {
  const [params] = useSearchParams();
  const [form, setForm] = useState({ email: '', fullName: '' });
  const [address, setAddress] = useState({ recipient: '', phone: '', addressLine: '', ward: '', district: '', city: '' });
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { document.title = 'Create account - TechHaven'; }, []);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post('/auth/register', { ...form, address: { ...address, recipient: address.recipient || form.fullName } });
      setDone(r.message);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <AuthCard title="Check your inbox">
        <div className="alert alert-success"><i className="bi bi-envelope-check me-2" />{done}</div>
        <p className="small text-muted">We sent a link to <b>{form.email}</b>. Open it to choose your password, then you are signed in automatically.</p>
        <Link to="/login" className="btn btn-outline-primary w-100">Back to sign in</Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Create your account" subtitle="Just your email, name and shipping address - we will email you a link to set your password.">
      <ErrorAlert error={error} />
      <form onSubmit={submit} className="vstack gap-3">
        <div><label className="form-label" htmlFor="r-email">Email *</label><input id="r-email" type="email" className="form-control" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
        <div><label className="form-label" htmlFor="r-name">Full name *</label><input id="r-name" className="form-control" required minLength={2} value={form.fullName} onChange={(e) => { setForm({ ...form, fullName: e.target.value }); if (!address.recipient || address.recipient === form.fullName) setAddress({ ...address, recipient: e.target.value }); }} /></div>
        <fieldset>
          <legend className="form-label fs-6 fw-semibold">Shipping address</legend>
          <AddressFields value={address} onChange={setAddress} idPrefix="reg" />
        </fieldset>
        <button className="btn btn-primary w-100" disabled={busy}>{busy ? 'Creating account...' : 'Create account'}</button>
      </form>
      <div className="divider my-3"><span>or</span></div>
      <GoogleButton redirect={safeRedirect(params.get('redirect'))} />
      <p className="small text-center mt-4 mb-0">Already have an account? <Link to="/login">Sign in</Link></p>
    </AuthCard>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setMsg((await api.post('/auth/forgot-password', { email })).message);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthCard title="Recover your password" subtitle="Enter your account email and we will send you a link to choose a new password.">
      <ErrorAlert error={error} />
      {msg ? <div className="alert alert-success">{msg}</div> : (
        <form onSubmit={submit} className="vstack gap-3">
          <div><label className="form-label" htmlFor="f-email">Email</label><input id="f-email" type="email" className="form-control" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <button className="btn btn-primary w-100" disabled={busy}>{busy ? 'Sending...' : 'Send recovery link'}</button>
        </form>
      )}
      <p className="small text-center mt-4 mb-0"><Link to="/login">Back to sign in</Link></p>
    </AuthCard>
  );
}

export function SetPassword() {
  const [params] = useSearchParams();
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [pw, setPw] = useState({ a: '', b: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const isSetup = params.get('purpose') === 'setup';

  const submit = async (e) => {
    e.preventDefault();
    if (pw.a !== pw.b) return setError(new Error('The two passwords do not match'));
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.post('/auth/set-password', { token: params.get('token'), password: pw.a });
      setUser(user);
      navigate(user.role === 'admin' ? '/admin' : '/account', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title={isSetup ? 'Set your password' : 'Choose a new password'} subtitle="At least 8 characters with letters and digits.">
      <ErrorAlert error={error} />
      <form onSubmit={submit} className="vstack gap-3">
        <div><label className="form-label" htmlFor="pa">New password</label><input id="pa" type="password" className="form-control" required minLength={8} autoComplete="new-password" value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} /></div>
        <div><label className="form-label" htmlFor="pb">Confirm password</label><input id="pb" type="password" className="form-control" required minLength={8} autoComplete="new-password" value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} /></div>
        <button className="btn btn-primary w-100" disabled={busy || !params.get('token')}>{busy ? 'Saving...' : 'Save password and sign in'}</button>
      </form>
    </AuthCard>
  );
}
