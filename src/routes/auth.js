import express from 'express';
import jwt from 'jsonwebtoken';
import { sessionSecret } from '../middleware/auth.js';

const router = express.Router();

router.get('/', (req, res) => {
  res.redirect('/login');
});

router.get('/login', (req, res) => {
  res.render('login', { error: null });
});

router.post('/login', (req, res) => {
  const { password } = req.body;
  const adminPw = (process.env.PROD_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || '').toString();
  if (adminPw && password === adminPw) {
    req.session.isAdmin = true;
    const token = jwt.sign({ role: 'admin' }, sessionSecret(), { expiresIn: '30d' });
    res.cookie('admin_jwt', token, { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 30 });
    return res.redirect('/admin');
  }
  return res.status(401).render('login', { error: 'Invalid password' });
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

export const authRoutes = router;
