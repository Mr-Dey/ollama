const express     = require('express');
const axios       = require('axios');
const cors        = require('cors');
const bodyParser  = require('body-parser');
const multer      = require('multer');
const pdf         = require('pdf-parse');
const fs          = require('fs');
const https       = require('https');
const mongoose    = require('mongoose');
const jwt         = require('jsonwebtoken');
const bcrypt      = require('bcryptjs');
const nodemailer  = require('nodemailer');
const rateLimit   = require('express-rate-limit');
const swaggerJsdoc = require('swagger-jsdoc');
const http        = require('http');

// Disable HTTP keep-alive for Ollama calls so each request opens a fresh TCP
// connection. K8s Services load-balance per connection — with keep-alive ON,
// all requests would pin to a single Ollama pod and the other replicas sit idle.
const ollamaHttpAgent = new http.Agent({ keepAlive: false });
const ollamaAxios = axios.create({ httpAgent: ollamaHttpAgent });

const app = express();
const PORT        = process.env.PORT       || 5000;
const OLLAMA_URL  = process.env.OLLAMA_URL || 'http://localhost:31434/api/chat';
const OLLAMA_BASE = process.env.OLLAMA_BASE || 'http://localhost:31434';
const MONGO_URI   = process.env.MONGO_URI  ||
  `mongodb://${process.env.MONGO_USER||'ollamaadmin'}:${process.env.MONGO_PASS||'mongopass123'}` +
  `@localhost:${process.env.MONGO_PORT||'30017'}/${process.env.MONGO_DB||'ollama_chat'}?authSource=admin`;
const JWT_SECRET  = process.env.JWT_SECRET || 'change-this-in-production-use-a-long-random-string-32chars';
const JWT_EXPIRY  = process.env.JWT_EXPIRY || '24h';
const SMTP_HOST   = process.env.SMTP_HOST  || '';
const SMTP_PORT   = parseInt(process.env.SMTP_PORT || '587');
const SMTP_USER   = process.env.SMTP_USER  || '';
const SMTP_PASS   = process.env.SMTP_PASS  || '';
const SMTP_FROM   = process.env.SMTP_FROM  || 'noreply@ollama.local';
const DEV_OTP_IN_RESPONSE = process.env.DEV_OTP_IN_RESPONSE === 'true' || !SMTP_HOST;

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

const upload = multer({ dest: 'uploads/' });

// Rate limit auth endpoints — 10 attempts / 15 min per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter limit for OTP requests — 5 / hour per IP
const otpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Too many OTP requests. Please try again in an hour.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── MongoDB Schemas ──────────────────────────────────────────────────────────

const userSchema = new mongoose.Schema({
  username:     { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  role:         { type: String, enum: ['admin', 'user'], default: 'user' },
  email:        String,
  createdAt:    { type: Date, default: Date.now },
  lastLogin:    Date,
});

const messageSchema = new mongoose.Schema({
  role:        { type: String, enum: ['user', 'assistant'], required: true },
  content:     { type: String, required: true },
  model:       String,
  latency:     String,
  attachments: [{ kind: String, name: String, ext: String, size: String }],
  createdAt:   { type: Date, default: Date.now },
});

const conversationSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title:     { type: String, default: 'New conversation' },
  model:     { type: String, default: 'llama3:8b' },
  messages:  [messageSchema],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const otpSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  email:     { type: String, required: true },
  code:      { type: String, required: true },
  expiresAt: { type: Date,   required: true },
  used:      { type: Boolean, default: false },
});
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const User         = mongoose.model('User', userSchema);
const Conversation = mongoose.model('Conversation', conversationSchema);
const OtpToken     = mongoose.model('OtpToken', otpSchema);

// ─── Auth Middleware ──────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid token' });
  }
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token expired or invalid' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function extractText(filePath, mimeType) {
  if (mimeType === 'application/pdf') {
    const data = await pdf(fs.readFileSync(filePath));
    return data.text;
  } else if (mimeType.startsWith('text/')) {
    return fs.readFileSync(filePath, 'utf8');
  }
  return '';
}

// ─── Kubernetes In-Cluster API ────────────────────────────────────────────────

const K8S_API    = 'https://kubernetes.default.svc.cluster.local';
const SA_TOKEN   = '/var/run/secrets/kubernetes.io/serviceaccount/token';
const SA_CA      = '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt';

function k8sClient() {
  try {
    const token = fs.readFileSync(SA_TOKEN, 'utf8').trim();
    const ca    = fs.readFileSync(SA_CA);
    return axios.create({
      baseURL: K8S_API,
      headers: { Authorization: `Bearer ${token}` },
      httpsAgent: new https.Agent({ ca }),
      timeout: 8000,
    });
  } catch {
    return null;
  }
}

function parseCpu(str) {
  if (!str) return 0;
  if (str.endsWith('n'))  return parseInt(str);
  if (str.endsWith('m'))  return parseInt(str) * 1_000_000;
  return parseInt(str) * 1_000_000_000;
}

function parseMem(str) {
  if (!str) return 0;
  if (str.endsWith('Ki')) return parseInt(str) * 1024;
  if (str.endsWith('Mi')) return parseInt(str) * 1024 ** 2;
  if (str.endsWith('Gi')) return parseInt(str) * 1024 ** 3;
  return parseInt(str);
}

// ─── Mailer ───────────────────────────────────────────────────────────────────

let mailTransporter = null;
let mailerStatus = 'not configured';

async function setupMailer() {
  if (!SMTP_HOST) {
    mailerStatus = 'no SMTP_HOST — OTPs printed to console';
    console.log(`\n[SMTP] No SMTP_HOST configured — OTP codes will be printed to console and returned in the API response (dev mode)\n`);
    return;
  }
  const config = {
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
  };
  if (SMTP_USER) {
    config.auth = { user: SMTP_USER, pass: SMTP_PASS };
  }
  mailTransporter = nodemailer.createTransport(config);
  try {
    await mailTransporter.verify();
    mailerStatus = `connected to ${SMTP_HOST}:${SMTP_PORT}`;
    console.log(`[SMTP] ✓ Connected to ${SMTP_HOST}:${SMTP_PORT}`);
  } catch (err) {
    mailerStatus = `connection failed: ${err.message}`;
    console.error(`[SMTP] ✗ Connection failed: ${err.message}`);
    console.error(`[SMTP] Will fall back to console-printed OTPs.`);
    mailTransporter = null;
  }
}

function otpEmailHtml(code) {
  return `
    <div style="font-family:ui-monospace,monospace;max-width:480px;margin:40px auto;padding:32px;border:1px solid #25252a;border-radius:12px;background:#0c0c0d;color:#ededed">
      <div style="font-size:28px;font-weight:700;color:#efe7d7;letter-spacing:-0.02em;margin-bottom:8px">Λ</div>
      <h2 style="margin:0 0 20px;font-size:16px;font-weight:500;color:#ededed">Password reset code</h2>
      <div style="font-size:36px;font-weight:700;letter-spacing:0.25em;color:#efe7d7;background:#18181b;border:1px solid #25252a;border-radius:8px;padding:18px 24px;text-align:center;margin-bottom:20px">${code}</div>
      <p style="margin:0;font-size:12px;color:#7a7a82;line-height:1.6">This code expires in <strong style="color:#ededed">10 minutes</strong>. If you didn't request a password reset, you can safely ignore this email.</p>
    </div>`;
}

async function sendOtpEmail(to, code) {
  // No SMTP configured — print loudly to console
  if (!mailTransporter) {
    console.log('');
    console.log('╔════════════════════════════════════════════════════╗');
    console.log(`║  PASSWORD RESET OTP`);
    console.log(`║  To:    ${to}`);
    console.log(`║  Code:  ${code}`);
    console.log(`║  Expires in 10 minutes`);
    console.log(`║  (Configure SMTP_HOST to send actual emails)`);
    console.log('╚════════════════════════════════════════════════════╝');
    console.log('');
    return { sent: false, devMode: true };
  }
  try {
    const info = await mailTransporter.sendMail({
      from: `"Ollama Chat" <${SMTP_FROM}>`,
      to,
      subject: 'Your password reset code',
      text: `Your one-time password reset code is: ${code}\n\nIt expires in 10 minutes. If you did not request this, ignore this email.`,
      html: otpEmailHtml(code),
    });
    console.log(`[SMTP] ✓ Sent OTP to ${to} (messageId=${info.messageId})`);
    return { sent: true };
  } catch (err) {
    console.error(`[SMTP] ✗ Failed to send OTP to ${to}: ${err.message}`);
    return { sent: false, error: err.message };
  }
}

// ─── Auth Routes ──────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     tags: [Authentication]
 *     summary: Log in with username and password
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password]
 *             properties:
 *               username: { type: string, example: admin }
 *               password: { type: string, example: admin123 }
 *     responses:
 *       200: { description: JWT token + user object }
 *       401: { description: Invalid credentials }
 */
app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    const user = await User.findOne({ username });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    user.lastLogin = new Date();
    await user.save();
    const token = jwt.sign(
      { id: user._id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY }
    );
    res.json({ token, user: { id: user._id, username: user.username, role: user.role, email: user.email } });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * @openapi
 * /api/auth/me:
 *   get:
 *     tags: [Authentication]
 *     summary: Get current user profile
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: User profile (without password hash) }
 *       401: { description: Not authenticated }
 */
app.get('/api/auth/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.user.id).select('-passwordHash');
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// ─── Password Reset Routes ────────────────────────────────────────────────────

/**
 * @openapi
 * /api/auth/forgot-password:
 *   post:
 *     tags: [Authentication]
 *     summary: Request password reset OTP
 *     description: |
 *       Sends a 6-digit OTP to the user's email. If SMTP is not configured,
 *       the OTP is returned in the response (dev mode) and printed to backend logs.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email }
 *     responses:
 *       200:
 *         description: Always returns ok (does not leak whether email exists)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean }
 *                 devMode: { type: boolean, description: "true if SMTP not configured" }
 *                 devCode: { type: string, description: "OTP code (only when devMode=true)" }
 */
app.post('/api/auth/forgot-password', otpLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });

    // Always return ok if user doesn't exist — don't leak which emails are registered
    if (!user) {
      console.log(`[OTP] Request for unknown email: ${normalizedEmail}`);
      return res.json({ ok: true });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await OtpToken.deleteMany({ userId: user._id });
    await OtpToken.create({ userId: user._id, email: user.email, code, expiresAt });

    const result = await sendOtpEmail(user.email, code);

    // Dev mode: SMTP not configured — return the OTP so the user can complete the flow
    if (result.devMode && DEV_OTP_IN_RESPONSE) {
      return res.json({
        ok: true,
        devMode: true,
        devCode: code,
        hint: 'SMTP is not configured. The OTP is shown here for testing. Configure SMTP_HOST to send real emails.',
      });
    }

    // SMTP configured but failed
    if (!result.sent && !result.devMode) {
      return res.status(500).json({
        error: 'Email could not be sent',
        detail: result.error,
        hint: `SMTP status: ${mailerStatus}`,
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Forgot-password error:', err);
    res.status(500).json({ error: 'Failed to send OTP', detail: err.message });
  }
});

/**
 * @openapi
 * /api/auth/verify-otp:
 *   post:
 *     tags: [Authentication]
 *     summary: Verify OTP and receive reset token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, code]
 *             properties:
 *               email: { type: string }
 *               code:  { type: string, example: "123456" }
 *     responses:
 *       200: { description: Returns short-lived resetToken (15 min) }
 *       400: { description: Invalid or expired code }
 */
app.post('/api/auth/verify-otp', authLimiter, async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: 'Email and code required' });

    const record = await OtpToken.findOne({
      email: email.toLowerCase().trim(),
      code,
      used: false,
      expiresAt: { $gt: new Date() },
    });
    if (!record) return res.status(400).json({ error: 'Invalid or expired code' });

    const resetToken = jwt.sign(
      { userId: record.userId.toString(), otpId: record._id.toString(), purpose: 'reset' },
      JWT_SECRET,
      { expiresIn: '15m' }
    );
    res.json({ ok: true, resetToken });
  } catch (err) {
    console.error('Verify-OTP error:', err.message);
    res.status(500).json({ error: 'Verification failed' });
  }
});

/**
 * @openapi
 * /api/auth/reset-password:
 *   post:
 *     tags: [Authentication]
 *     summary: Set a new password using the reset token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [resetToken, password]
 *             properties:
 *               resetToken: { type: string }
 *               password:   { type: string, minLength: 6 }
 *     responses:
 *       200: { description: Password updated }
 *       400: { description: Token expired or password too short }
 */
app.post('/api/auth/reset-password', authLimiter, async (req, res) => {
  try {
    const { resetToken, password } = req.body;
    if (!resetToken || !password) return res.status(400).json({ error: 'Token and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    let payload;
    try {
      payload = jwt.verify(resetToken, JWT_SECRET);
    } catch {
      return res.status(400).json({ error: 'Reset token expired or invalid' });
    }
    if (payload.purpose !== 'reset') return res.status(400).json({ error: 'Invalid token' });

    const record = await OtpToken.findById(payload.otpId);
    if (!record || record.used) return res.status(400).json({ error: 'Reset token already used' });

    const passwordHash = await bcrypt.hash(password, 12);
    await User.updateOne({ _id: payload.userId }, { passwordHash });
    await OtpToken.updateOne({ _id: record._id }, { used: true });

    res.json({ ok: true });
  } catch (err) {
    console.error('Reset-password error:', err.message);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

// ─── Conversation Routes ──────────────────────────────────────────────────────

/**
 * @openapi
 * /api/conversations:
 *   get:
 *     tags: [Conversations]
 *     summary: List conversations for the authenticated user
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Array of conversation metadata (sorted by updatedAt) }
 */
app.get('/api/conversations', requireAuth, async (req, res) => {
  try {
    const convs = await Conversation.find({ userId: req.user.id })
      .select('title model createdAt updatedAt')
      .sort({ updatedAt: -1 });
    res.json(convs);
  } catch {
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

/**
 * @openapi
 * /api/conversations:
 *   post:
 *     tags: [Conversations]
 *     summary: Create a new conversation
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string }
 *               model: { type: string }
 *     responses:
 *       200: { description: Created conversation }
 */
app.post('/api/conversations', requireAuth, async (req, res) => {
  try {
    const { title, model } = req.body;
    const conv = await Conversation.create({
      userId: req.user.id,
      title:  title || 'New conversation',
      model:  model || 'llama3:8b',
    });
    res.json(conv);
  } catch {
    res.status(500).json({ error: 'Failed to create conversation' });
  }
});

/**
 * @openapi
 * /api/conversations/{id}:
 *   get:
 *     tags: [Conversations]
 *     summary: Get a single conversation with all messages
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Full conversation document }
 *       404: { description: Not found }
 */
app.get('/api/conversations/:id', requireAuth, async (req, res) => {
  try {
    const conv = await Conversation.findOne({ _id: req.params.id, userId: req.user.id });
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    res.json(conv);
  } catch {
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
});

/**
 * @openapi
 * /api/conversations/{id}:
 *   delete:
 *     tags: [Conversations]
 *     summary: Delete a conversation
 *     security: [{ bearerAuth: [] }]
 */
app.delete('/api/conversations/:id', requireAuth, async (req, res) => {
  try {
    await Conversation.deleteOne({ _id: req.params.id, userId: req.user.id });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
});

/**
 * @openapi
 * /api/conversations/{id}/export:
 *   get:
 *     tags: [Conversations]
 *     summary: Export a conversation as JSON or Markdown
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path,  name: id,     required: true, schema: { type: string } }
 *       - { in: query, name: format, schema: { type: string, enum: [json, markdown] } }
 *     responses:
 *       200: { description: File download }
 */
app.get('/api/conversations/:id/export', requireAuth, async (req, res) => {
  try {
    const conv = await Conversation.findOne({ _id: req.params.id, userId: req.user.id });
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    const format = (req.query.format || 'json').toLowerCase();
    const safeTitle = (conv.title || 'conversation').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_').slice(0, 50) || 'conversation';

    if (format === 'markdown' || format === 'md') {
      let md = `# ${conv.title}\n\n`;
      md += `- **Model:** ${conv.model}\n`;
      md += `- **Created:** ${conv.createdAt.toISOString()}\n`;
      md += `- **Messages:** ${conv.messages.length}\n\n`;
      md += `---\n\n`;
      for (const m of conv.messages) {
        const speaker = m.role === 'user' ? 'User' : 'Assistant';
        md += `### ${speaker}`;
        if (m.model) md += ` _(${m.model}${m.latency ? ' · ' + m.latency : ''})_`;
        md += `\n\n${m.content}\n\n`;
        if (m.attachments?.length) {
          md += `**Attachments:** ` + m.attachments.map(a => `${a.name} (${a.size})`).join(', ') + `\n\n`;
        }
        md += `---\n\n`;
      }
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.md"`);
      return res.send(md);
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.json"`);
    res.send(JSON.stringify(conv, null, 2));
  } catch (err) {
    console.error('Export error:', err.message);
    res.status(500).json({ error: 'Export failed' });
  }
});

// ─── Chat: Send Message (with optional streaming) ─────────────────────────────

/**
 * @openapi
 * /api/conversations/{id}/messages:
 *   post:
 *     tags: [Messages]
 *     summary: Send a message; supports multipart (files) and streaming
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path,  name: id,     required: true, schema: { type: string } }
 *       - { in: query, name: stream, schema: { type: boolean }, description: "If true, returns SSE stream" }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               message:      { type: string }
 *               model:        { type: string }
 *               images:       { type: array, items: { type: string, description: "base64 data URL" } }
 *               system:       { type: string }
 *               temperature:  { type: number }
 *               top_p:        { type: number }
 *               max_tokens:   { type: integer }
 *     responses:
 *       200: { description: JSON reply, or SSE stream of tokens }
 */
app.post('/api/conversations/:id/messages', requireAuth, upload.array('files'), async (req, res) => {
  try {
    const conv = await Conversation.findOne({ _id: req.params.id, userId: req.user.id });
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    let { message, model, images = [], system, temperature, top_p, max_tokens } = req.body;
    const wantsStream = req.query.stream === 'true' || req.body.stream === 'true' || req.body.stream === true;

    let contextText = '';
    if (req.files?.length > 0) {
      for (const file of req.files) {
        const text = await extractText(file.path, file.mimetype);
        contextText += `\n[File: ${file.originalname}]\n${text}\n`;
        fs.unlinkSync(file.path);
      }
    }

    const fullPrompt = contextText
      ? `Context from files:\n${contextText}\n\nUser Question: ${message}`
      : message;

    const usedModel = model || conv.model;
    const t0 = Date.now();

    const historyMessages = conv.messages.map(m => ({ role: m.role, content: m.content }));
    historyMessages.push({ role: 'user', content: fullPrompt });

    const payload = {
      model:    usedModel,
      messages: historyMessages,
      stream:   wantsStream,
    };

    if (system && system.trim()) payload.system = system.trim();

    const opts = {};
    if (temperature !== undefined && !isNaN(parseFloat(temperature))) opts.temperature = parseFloat(temperature);
    if (top_p       !== undefined && !isNaN(parseFloat(top_p)))       opts.top_p       = parseFloat(top_p);
    if (max_tokens  !== undefined && !isNaN(parseInt(max_tokens)))     opts.num_predict = parseInt(max_tokens);
    if (Object.keys(opts).length > 0) payload.options = opts;

    const imagesArr = Array.isArray(images) ? images : (images ? [images] : []);
    if (imagesArr.length > 0) {
      const lastMsg = payload.messages[payload.messages.length - 1];
      lastMsg.images = imagesArr.map(img => img.split(',')[1] || img);
    }

    const attachments = req.files?.map(f => ({
      kind: f.mimetype.startsWith('image/') ? 'image' : 'file',
      name: f.originalname,
      ext:  f.originalname.split('.').pop()?.toUpperCase() || 'FILE',
      size: `${(f.size / 1024).toFixed(1)} KB`,
    })) || [];

    // ── Streaming path ──
    if (wantsStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();

      let fullReply = '';
      let finished = false;

      const finish = async (err) => {
        if (finished) return;
        finished = true;
        const latency = `${Date.now() - t0}ms`;
        try {
          if (fullReply.trim()) {
            conv.messages.push({ role: 'user',      content: message, model: usedModel, attachments });
            conv.messages.push({ role: 'assistant', content: fullReply, model: usedModel, latency });
            if (conv.title === 'New conversation' && message.trim().length > 3) {
              conv.title = message.trim().slice(0, 60);
            }
            conv.updatedAt = new Date();
            await conv.save();
          }
        } catch (e) {
          console.error('Save error during stream:', e.message);
        }
        if (err) {
          res.write(`data: ${JSON.stringify({ error: err.message || String(err) })}\n\n`);
        } else {
          res.write(`data: ${JSON.stringify({ done: true, latency, conversationId: conv._id, model: usedModel })}\n\n`);
        }
        res.end();
      };

      try {
        const ollamaRes = await ollamaAxios.post(OLLAMA_URL, payload, {
          responseType: 'stream',
          timeout: 0,
        });

        let buffer = '';
        ollamaRes.data.on('data', chunk => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const obj = JSON.parse(line);
              const token = obj.message?.content || '';
              if (token) {
                fullReply += token;
                res.write(`data: ${JSON.stringify({ token })}\n\n`);
              }
              if (obj.done) {
                finish();
              }
            } catch {}
          }
        });

        ollamaRes.data.on('end',   () => finish());
        ollamaRes.data.on('error', (e) => finish(e));
        req.on('close', () => { if (!finished) ollamaRes.data.destroy(); });
      } catch (err) {
        finish(err.response?.data || err);
      }
      return;
    }

    // ── Non-streaming path (legacy) ──
    const aiRes   = await ollamaAxios.post(OLLAMA_URL, payload, { timeout: 120000 });
    const latency = `${Date.now() - t0}ms`;
    const reply   = aiRes.data.message?.content || 'No response';

    conv.messages.push({ role: 'user',      content: message,  model: usedModel, attachments });
    conv.messages.push({ role: 'assistant', content: reply,    model: usedModel, latency });

    if (conv.title === 'New conversation' && message.trim().length > 3) {
      conv.title = message.trim().slice(0, 60);
    }
    conv.updatedAt = new Date();
    await conv.save();

    res.json({ reply, model: usedModel, latency, conversationId: conv._id });
  } catch (err) {
    console.error('Chat error:', err.message);
    const msg = err.response?.data?.error || err.message || 'Failed to process request';
    if (!res.headersSent) res.status(500).json({ error: msg });
  }
});

// ─── Admin: User Management ───────────────────────────────────────────────────

/**
 * @openapi
 * /api/admin/users:
 *   get:
 *     tags: [Admin]
 *     summary: List all users (admin only)
 *     security: [{ bearerAuth: [] }]
 */
app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const users = await User.find().select('-passwordHash').sort({ createdAt: -1 });
  res.json(users);
});

/**
 * @openapi
 * /api/admin/users:
 *   post:
 *     tags: [Admin]
 *     summary: Create a new user (admin only)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password]
 *             properties:
 *               username: { type: string }
 *               password: { type: string }
 *               role:     { type: string, enum: [admin, user] }
 *               email:    { type: string, format: email }
 */
app.post('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { username, password, role, email } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    if (await User.findOne({ username })) {
      return res.status(409).json({ error: 'Username already exists' });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ username, passwordHash, role: role || 'user', email });
    res.json({ id: user._id, username: user.username, role: user.role, email: user.email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @openapi
 * /api/admin/users/{id}:
 *   delete:
 *     tags: [Admin]
 *     summary: Delete a user and their conversations (admin only)
 *     security: [{ bearerAuth: [] }]
 */
app.delete('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (String(req.user.id) === String(req.params.id)) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    await User.deleteOne({ _id: req.params.id });
    await Conversation.deleteMany({ userId: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @openapi
 * /api/admin/users/{id}/password:
 *   patch:
 *     tags: [Admin]
 *     summary: Reset a user's password (admin only)
 *     security: [{ bearerAuth: [] }]
 */
app.patch('/api/admin/users/:id/password', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password required' });
    const passwordHash = await bcrypt.hash(password, 12);
    await User.updateOne({ _id: req.params.id }, { passwordHash });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Cluster & Model Info ─────────────────────────────────────────────────────

/**
 * @openapi
 * /api/cluster/status:
 *   get:
 *     tags: [Cluster]
 *     summary: Cluster nodes, pods, models, and resource usage
 *     security: [{ bearerAuth: [] }]
 */
app.get('/api/cluster/status', requireAuth, async (req, res) => {
  try {
    const k8s = k8sClient();
    const modelsRes = await ollamaAxios.get(`${OLLAMA_BASE}/api/tags`, { timeout: 5000 })
      .then(r => r.data.models || []).catch(() => []);

    if (!k8s) {
      return res.json({ nodes: [], pods: [], models: modelsRes.map(m => ({ name: m.name, size: m.size })) });
    }

    const [nodesRes, podsRes, metricsRes] = await Promise.allSettled([
      k8s.get('/api/v1/nodes'),
      k8s.get('/api/v1/pods?limit=500'),
      k8s.get('/apis/metrics.k8s.io/v1beta1/nodes'),
    ]);

    const nodeList    = nodesRes.status    === 'fulfilled' ? nodesRes.value.data.items    : [];
    const podList     = podsRes.status     === 'fulfilled' ? podsRes.value.data.items     : [];
    const metricsList = metricsRes.status  === 'fulfilled' ? metricsRes.value.data.items  : [];

    const metricsByNode = {};
    for (const m of metricsList) {
      metricsByNode[m.metadata.name] = m.usage;
    }

    const podsByNode = {};
    for (const p of podList) {
      const node = p.spec?.nodeName;
      if (node) podsByNode[node] = (podsByNode[node] || 0) + 1;
    }

    const nodes = nodeList.map(n => {
      const nodeName = n.metadata.name;
      const capacity = n.status?.capacity || {};
      const labels   = n.metadata?.labels || {};
      const usage    = metricsByNode[nodeName] || {};

      const cpuCap  = parseCpu(capacity.cpu);
      const memCap  = parseMem(capacity.memory);
      const cpuUse  = parseCpu(usage.cpu);
      const memUse  = parseMem(usage.memory);

      const ip = n.status?.addresses?.find(a => a.type === 'InternalIP')?.address || '';
      const role = labels['node-role.kubernetes.io/master'] !== undefined ||
                   labels['node-role.kubernetes.io/control-plane'] !== undefined
        ? 'master' : 'worker';

      return {
        name: nodeName,
        role,
        ip,
        cpu:  cpuCap  > 0 ? Math.round((cpuUse  / cpuCap)  * 100) : 0,
        mem:  memCap  > 0 ? Math.round((memUse  / memCap)  * 100) : 0,
        pods: podsByNode[nodeName] || 0,
      };
    });

    const pods = podList.map(p => ({
      name:      p.metadata.name,
      namespace: p.metadata.namespace,
      status:    p.status?.phase,
      ready:     `${p.status?.containerStatuses?.filter(c => c.ready).length || 0}/${p.spec?.containers?.length || 0}`,
      restarts:  p.status?.containerStatuses?.[0]?.restartCount || 0,
      age:       p.metadata.creationTimestamp,
    }));

    res.json({ nodes, pods, models: modelsRes.map(m => ({ name: m.name, size: m.size })) });
  } catch (err) {
    console.error('Cluster status error:', err.message);
    res.status(500).json({ error: 'Failed to fetch cluster status' });
  }
});

/**
 * @openapi
 * /api/models:
 *   get:
 *     tags: [Models]
 *     summary: List installed models
 *     security: [{ bearerAuth: [] }]
 */
app.get('/api/models', requireAuth, async (req, res) => {
  try {
    const r = await ollamaAxios.get(`${OLLAMA_BASE}/api/tags`, { timeout: 5000 });
    res.json(r.data.models || []);
  } catch {
    res.json([]);
  }
});

/**
 * @openapi
 * /api/models/pull:
 *   get:
 *     tags: [Models]
 *     summary: Pull a model (SSE stream of progress events from Ollama)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: model, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: SSE stream — each event is JSON {status, digest, total, completed} or {error}
 */
app.get('/api/models/pull', requireAuth, requireAdmin, async (req, res) => {
  const model = req.query.model;
  if (!model) return res.status(400).json({ error: 'model parameter required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  let ended = false;
  const send = (obj) => { if (!ended) res.write(`data: ${JSON.stringify(obj)}\n\n`); };

  try {
    const pullRes = await ollamaAxios.post(`${OLLAMA_BASE}/api/pull`, { name: model, stream: true }, {
      responseType: 'stream',
      timeout: 0,
    });

    let buffer = '';
    pullRes.data.on('data', chunk => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          send(obj);
          if (obj.error) { ended = true; res.end(); }
        } catch {}
      }
    });
    pullRes.data.on('end', () => { if (!ended) { ended = true; res.end(); } });
    pullRes.data.on('error', err => { send({ error: err.message }); if (!ended) { ended = true; res.end(); } });
    req.on('close', () => { if (!ended) pullRes.data.destroy(); });
  } catch (err) {
    send({ error: err.message });
    res.end();
  }
});

/**
 * @openapi
 * /api/models/{name}:
 *   delete:
 *     tags: [Models]
 *     summary: Delete an installed model
 *     security: [{ bearerAuth: [] }]
 */
app.delete('/api/models/:name', requireAuth, requireAdmin, async (req, res) => {
  try {
    await ollamaAxios.delete(`${OLLAMA_BASE}/api/delete`, { data: { name: req.params.name } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.error || err.message });
  }
});

// ─── Health & Docs ────────────────────────────────────────────────────────────

/**
 * @openapi
 * /health:
 *   get:
 *     tags: [Health]
 *     summary: Backend health check
 *     responses:
 *       200: { description: status, mongo, ollama, smtp }
 */
app.get('/health', async (req, res) => {
  const mongoOk = mongoose.connection.readyState === 1;
  let ollamaOk = false;
  try {
    await ollamaAxios.get(`${OLLAMA_BASE}/api/tags`, { timeout: 3000 });
    ollamaOk = true;
  } catch {}
  res.json({ status: 'ok', mongo: mongoOk, ollama: ollamaOk, smtp: mailerStatus });
});

// ─── OpenAPI spec ─────────────────────────────────────────────────────────────

const apiSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Ollama Chat API',
      version: '2.1.0',
      description: 'Self-hosted Ollama chat platform with JWT auth, MongoDB persistence, and streaming responses.',
    },
    servers: [{ url: '/' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
  },
  apis: [__filename],
});

app.get('/api/docs.json', (req, res) => res.json(apiSpec));

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function start() {
  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    console.log('MongoDB connected');
  } catch (err) {
    console.warn('MongoDB unavailable:', err.message, '— chat history disabled');
  }
  await setupMailer();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Ollama backend running on port ${PORT}`);
    console.log(`OpenAPI spec at /api/docs.json`);
  });
}

start();
