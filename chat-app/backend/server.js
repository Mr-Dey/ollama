const express = require('express');
const axios = require('axios');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const pdf = require('pdf-parse');
const fs = require('fs');
const https = require('https');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
const PORT        = process.env.PORT       || 5000;
const OLLAMA_URL  = process.env.OLLAMA_URL || 'http://localhost:31434/api/chat';
const OLLAMA_BASE = process.env.OLLAMA_BASE || 'http://localhost:31434';
const MONGO_URI   = process.env.MONGO_URI  ||
  `mongodb://${process.env.MONGO_USER||'ollamaadmin'}:${process.env.MONGO_PASS||'mongopass123'}` +
  `@localhost:${process.env.MONGO_PORT||'30017'}/${process.env.MONGO_DB||'ollama_chat'}?authSource=admin`;
const JWT_SECRET  = process.env.JWT_SECRET || 'change-this-in-production-use-a-long-random-string-32chars';
const JWT_EXPIRY  = process.env.JWT_EXPIRY || '24h';

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

const upload = multer({ dest: 'uploads/' });

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

const User         = mongoose.model('User', userSchema);
const Conversation = mongoose.model('Conversation', conversationSchema);

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
    return null; // running outside cluster (dev mode)
  }
}

function parseCpu(str) {
  if (!str) return 0;
  if (str.endsWith('n'))  return parseInt(str);                    // nanocores
  if (str.endsWith('m'))  return parseInt(str) * 1_000_000;        // millicores → nano
  return parseInt(str) * 1_000_000_000;                            // cores → nano
}

function parseMem(str) {
  if (!str) return 0;
  if (str.endsWith('Ki')) return parseInt(str) * 1024;
  if (str.endsWith('Mi')) return parseInt(str) * 1024 ** 2;
  if (str.endsWith('Gi')) return parseInt(str) * 1024 ** 3;
  return parseInt(str);
}

// ─── Auth Routes ──────────────────────────────────────────────────────────────

app.post('/api/auth/login', async (req, res) => {
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

app.get('/api/auth/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.user.id).select('-passwordHash');
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// ─── Conversation Routes ──────────────────────────────────────────────────────

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

app.get('/api/conversations/:id', requireAuth, async (req, res) => {
  try {
    const conv = await Conversation.findOne({ _id: req.params.id, userId: req.user.id });
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    res.json(conv);
  } catch {
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
});

app.delete('/api/conversations/:id', requireAuth, async (req, res) => {
  try {
    await Conversation.deleteOne({ _id: req.params.id, userId: req.user.id });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
});

// ─── Chat: Send Message ───────────────────────────────────────────────────────

app.post('/api/conversations/:id/messages', requireAuth, upload.array('files'), async (req, res) => {
  try {
    const conv = await Conversation.findOne({ _id: req.params.id, userId: req.user.id });
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    let { message, model, images = [] } = req.body;
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

    const payload = {
      model:    usedModel,
      messages: [{ role: 'user', content: fullPrompt }],
      stream:   false,
    };

    const imagesArr = Array.isArray(images) ? images : (images ? [images] : []);
    if (imagesArr.length > 0) {
      payload.messages[0].images = imagesArr.map(img => img.split(',')[1] || img);
      payload.model = 'llava:7b';
    }

    const aiRes   = await axios.post(OLLAMA_URL, payload, { timeout: 120000 });
    const latency = `${Date.now() - t0}ms`;
    const reply   = aiRes.data.message?.content || 'No response';

    const attachments = req.files?.map(f => ({
      kind: f.mimetype.startsWith('image/') ? 'image' : 'file',
      name: f.originalname,
      ext:  f.originalname.split('.').pop()?.toUpperCase() || 'FILE',
      size: `${(f.size / 1024).toFixed(1)} KB`,
    })) || [];

    conv.messages.push({ role: 'user',      content: message,  model: usedModel, attachments });
    conv.messages.push({ role: 'assistant', content: reply,    model: payload.model, latency });

    if (conv.title === 'New conversation' && message.trim().length > 3) {
      conv.title = message.trim().slice(0, 60);
    }
    conv.updatedAt = new Date();
    await conv.save();

    res.json({ reply, model: payload.model, latency, conversationId: conv._id });
  } catch (err) {
    console.error('Chat error:', err.message);
    const msg = err.response?.data?.error || err.message || 'Failed to process request';
    res.status(500).json({ error: msg });
  }
});

// ─── Admin: User Management ───────────────────────────────────────────────────

app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const users = await User.find().select('-passwordHash').sort({ createdAt: -1 });
  res.json(users);
});

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

app.get('/api/cluster/status', requireAuth, async (req, res) => {
  try {
    const k8s = k8sClient();
    const modelsRes = await axios.get(`${OLLAMA_BASE}/api/tags`, { timeout: 5000 })
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

app.get('/api/models', requireAuth, async (req, res) => {
  try {
    const r = await axios.get(`${OLLAMA_BASE}/api/tags`, { timeout: 5000 });
    res.json(r.data.models || []);
  } catch {
    res.json([]);
  }
});

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/health', async (req, res) => {
  const mongoOk = mongoose.connection.readyState === 1;
  let ollamaOk = false;
  try {
    await axios.get(`${OLLAMA_BASE}/api/tags`, { timeout: 3000 });
    ollamaOk = true;
  } catch {}
  res.json({ status: 'ok', mongo: mongoOk, ollama: ollamaOk });
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function start() {
  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    console.log('MongoDB connected');
  } catch (err) {
    console.warn('MongoDB unavailable:', err.message, '— chat history disabled');
  }
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Ollama backend running on port ${PORT}`);
  });
}

start();
