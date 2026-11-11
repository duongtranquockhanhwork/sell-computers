import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './styles.css';
import { AuthProvider } from './lib/auth';
import { CartProvider } from './lib/cart';
import { ToastProvider } from './lib/toast';
import { ShoppingProvider } from './lib/shopping';
import Layout from './components/Layout';
import Home from './pages/Home';
import Catalog from './pages/Catalog';
import ProductDetail from './pages/ProductDetail';
import Cart from './pages/Cart';
import Checkout from './pages/Checkout';
import OrderSuccess from './pages/OrderSuccess';
import { ForgotPassword, Login, Register, SetPassword } from './pages/Auth';
import { AccountLayout, MyOrderDetail, MyOrders, Profile } from './pages/account/Account';
import { EmptyState, Spinner } from './components/common';
import { Compare, TrackOrder, Wishlist } from './pages/Shopping';

// The administration pages (and Chart.js) are loaded only when an administrator
// opens them, so shoppers download a much smaller bundle.
const named = (load, name) => lazy(() => load().then((m) => ({ default: m[name] })));
const loadProducts = () => import('./pages/admin/Products');
const loadManage = () => import('./pages/admin/Manage');
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));
const Dashboard = lazy(() => import('./pages/admin/Dashboard'));
const ProductList = named(loadProducts, 'ProductList');
const ProductForm = named(loadProducts, 'ProductForm');
const Categories = named(loadProducts, 'Categories');
const AdminOrders = named(loadManage, 'AdminOrders');
const AdminOrderDetail = named(loadManage, 'AdminOrderDetail');
const AdminUsers = named(loadManage, 'AdminUsers');
const AdminDiscounts = named(loadManage, 'AdminDiscounts');

function NotFound() {
  return (
    <div className="container py-5">
      <EmptyState icon="signpost-split" title="Page not found">
        <Link to="/" className="btn btn-primary mt-2">Back to the store</Link>
      </EmptyState>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <CartProvider>
          <ShoppingProvider>
            <Suspense fallback={<Spinner />}>
            <Routes>
              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<Dashboard />} />
                <Route path="products" element={<ProductList />} />
                <Route path="products/:id" element={<ProductForm />} />
                <Route path="categories" element={<Categories />} />
                <Route path="orders" element={<AdminOrders />} />
                <Route path="orders/:number" element={<AdminOrderDetail />} />
                <Route path="users" element={<AdminUsers />} />
                <Route path="discounts" element={<AdminDiscounts />} />
              </Route>
              <Route element={<Layout />}>
                <Route index element={<Home />} />
                <Route path="products" element={<Catalog />} />
                <Route path="category/:slug" element={<Catalog />} />
                <Route path="products/:slug" element={<ProductDetail />} />
                <Route path="cart" element={<Cart />} />
                <Route path="compare" element={<Compare />} />
                <Route path="wishlist" element={<Wishlist />} />
                <Route path="track-order" element={<TrackOrder />} />
                <Route path="checkout" element={<Checkout />} />
                <Route path="order-success/:number" element={<OrderSuccess />} />
                <Route path="login" element={<Login />} />
                <Route path="register" element={<Register />} />
                <Route path="forgot-password" element={<ForgotPassword />} />
                <Route path="set-password" element={<SetPassword />} />
                <Route path="account" element={<AccountLayout />}>
                  <Route index element={<Profile />} />
                  <Route path="orders" element={<MyOrders />} />
                  <Route path="orders/:number" element={<MyOrderDetail />} />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
            </Suspense>
          </ShoppingProvider>
          </CartProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
