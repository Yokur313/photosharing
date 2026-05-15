import jwt from 'jsonwebtoken';

export function sessionSecret() {
  return process.env.PROD_SESSION_SECRET || process.env.SESSION_SECRET || 'dev-secret';
}

export function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  const token = req.cookies && req.cookies.admin_jwt;
  if (token) {
    try {
      const payload = jwt.verify(token, sessionSecret());
      if (payload && payload.role === 'admin') {
        req.session.isAdmin = true;
        return next();
      }
    } catch {
      /* invalid token */
    }
  }
  return res.redirect('/login');
}
