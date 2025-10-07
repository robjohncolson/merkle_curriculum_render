// Simple Railway server for AP Stats Turbo Mode
// No build step required - just plain Node.js

const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

const {
  buildSyncIndexFromAnswers,
  normalizeTimestamp,
  parseUnitLesson,
  computeUnitHash
} = require('./sync_utils');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL || 'https://bzqbhtrurzzavhqbgqrs.supabase.co',
  process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ6cWJodHJ1cnp6YXZocWJncXJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkxOTc1NDMsImV4cCI6MjA3NDc3MzU0M30.xDHsAxOlv0uprE9epz-M_Emn6q3mRegtTpFt0sl9uBo'
);

// In-memory cache with TTL
const cache = {
  peerData: null,
  questionStats: new Map(),
  lastUpdate: 0,
  TTL: 30000 // 30 seconds cache
};

const syncCache = {
  units: new Map(),
  lessonToUnit: new Map(),
  lastBuilt: 0,
  ttl: 60000
};

// Track connected WebSocket clients
const wsClients = new Set();

// Presence tracking (in-memory)
const presence = new Map(); // username -> { lastSeen: number, connections: Set<WebSocket> }
const wsToUser = new Map(); // ws -> username
const PRESENCE_TTL_MS = parseInt(process.env.PRESENCE_TTL_MS || '45000', 10);

// Helper to check cache validity
function isCacheValid(lastUpdate, ttl = cache.TTL) {
  return Date.now() - lastUpdate < ttl;
}

function getUnitIdFromLessonId(lessonId) {
  if (typeof lessonId !== 'string') return null;
  const match = lessonId.match(/U(\d+)-L/i);
  if (!match) return null;
  return `unit${parseInt(match[1], 10)}`;
}

async function rebuildFullSyncCache() {
  const { data, error } = await supabase
    .from('answers')
    .select('*');

  if (error) throw error;

  const normalizedData = (data || []).map((answer) => ({
    ...answer,
    timestamp: normalizeTimestamp(answer.timestamp)
  }));

  cache.peerData = normalizedData;
  cache.lastUpdate = Date.now();

  const { units } = buildSyncIndexFromAnswers(normalizedData);
  syncCache.units = units;
  syncCache.lessonToUnit = new Map();
  units.forEach((unitData, unitId) => {
    if (unitData?.lessons) {
      unitData.lessons.forEach((_, lessonId) => {
        syncCache.lessonToUnit.set(lessonId, unitId);
      });
    }
  });
  syncCache.lastBuilt = Date.now();
}

function isSyncCacheFresh() {
  if (!syncCache.lastBuilt) {
    return false;
  }
  return (Date.now() - syncCache.lastBuilt) < syncCache.ttl;
}

async function ensureSyncCache(force = false) {
  if (!force && isSyncCacheFresh()) {
    return;
  }
  await rebuildFullSyncCache();
}

function updateLessonMappingsForUnit(unitId, unitData) {
  const activeLessons = new Set();
  if (unitData?.lessons) {
    unitData.lessons.forEach((_, lessonId) => {
      activeLessons.add(lessonId);
      syncCache.lessonToUnit.set(lessonId, unitId);
    });
  }

  Array.from(syncCache.lessonToUnit.entries()).forEach(([lessonId, mappedUnit]) => {
    if (mappedUnit === unitId && !activeLessons.has(lessonId)) {
      syncCache.lessonToUnit.delete(lessonId);
    }
  });
}

async function refreshUnitCache(unitId) {
  if (!unitId) return null;
  const match = unitId.match(/unit(\d+)/i);
  if (!match) return null;
  const unitNumber = parseInt(match[1], 10);
  const prefix = `U${unitNumber}-`;

  const { data, error } = await supabase
    .from('answers')
    .select('*')
    .ilike('question_id', `${prefix}%`);

  if (error) throw error;

  const normalized = (data || []).map((answer) => ({
    ...answer,
    timestamp: normalizeTimestamp(answer.timestamp)
  }));

  const { units } = buildSyncIndexFromAnswers(normalized);
  const unitData = units.get(unitId) || {
    hash: computeUnitHash(new Map()),
    lessons: new Map(),
    lastUpdated: Date.now()
  };

  syncCache.units.set(unitId, unitData);
  updateLessonMappingsForUnit(unitId, unitData);
  syncCache.lastBuilt = Date.now();

  return unitData;
}

async function refreshUnitCacheByQuestion(questionId) {
  const mapping = parseUnitLesson(questionId);
  if (!mapping) return null;
  const unitData = await refreshUnitCache(mapping.unitId);
  const lessonData = unitData?.lessons?.get(mapping.lessonId) || null;
  return {
    unitId: mapping.unitId,
    lessonId: mapping.lessonId,
    unitHash: unitData?.hash || null,
    lessonHash: lessonData?.hash || null,
    lessonAnswerCount: lessonData?.answerCount || 0
  };
}

async function ensureLessonCache(lessonId) {
  if (!lessonId) return null;
  let unitId = syncCache.lessonToUnit.get(lessonId);
  if (!unitId) {
    unitId = getUnitIdFromLessonId(lessonId);
  }
  if (!unitId) return null;

  let unitData = syncCache.units.get(unitId);
  if (!unitData || !unitData.lessons?.has(lessonId)) {
    unitData = await refreshUnitCache(unitId);
  }

  if (!unitData) return null;
  const lessonData = unitData.lessons?.get(lessonId);
  if (!lessonData) {
    return null;
  }

  return { unitId, unitData, lessonData };
}

// ============================
// REST API ENDPOINTS
// ============================

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    connections: wsClients.size,
    cache: isCacheValid(cache.lastUpdate) ? 'warm' : 'cold',
    timestamp: new Date().toISOString()
  });
});

// Get all peer data with optional delta
app.get('/api/peer-data', async (req, res) => {
  try {
    const since = req.query.since ? parseInt(req.query.since) : 0;

    // Use cache if valid
    if (isCacheValid(cache.lastUpdate) && cache.peerData) {
      const filteredData = since > 0
        ? cache.peerData.filter(a => a.timestamp > since)
        : cache.peerData;

      return res.json({
        data: filteredData,
        total: cache.peerData.length,
        filtered: filteredData.length,
        cached: true,
        lastUpdate: cache.lastUpdate
      });
    }

    // Fetch from Supabase
    const { data, error } = await supabase
      .from('answers')
      .select('*')
      .order('timestamp', { ascending: false });

    if (error) throw error;

    // Normalize timestamps
    const normalizedData = data.map(answer => ({
      ...answer,
      timestamp: normalizeTimestamp(answer.timestamp)
    }));

    // Update cache
    cache.peerData = normalizedData;
    cache.lastUpdate = Date.now();

    // Filter by timestamp if requested
    const filteredData = since > 0
      ? normalizedData.filter(a => a.timestamp > since)
      : normalizedData;

    res.json({
      data: filteredData,
      total: normalizedData.length,
      filtered: filteredData.length,
      cached: false,
      lastUpdate: cache.lastUpdate
    });

  } catch (error) {
    console.error('Error fetching peer data:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get question statistics
app.get('/api/question-stats/:questionId', async (req, res) => {
  try {
    const { questionId } = req.params;

    // Check cache
    const cached = cache.questionStats.get(questionId);
    if (cached && isCacheValid(cached.timestamp, 60000)) { // 1 minute cache for stats
      return res.json(cached.data);
    }

    // Calculate stats from Supabase
    const { data, error } = await supabase
      .from('answers')
      .select('answer_value, username')
      .eq('question_id', questionId);

    if (error) throw error;

    // Calculate distribution
    const distribution = {};
    const users = new Set();

    data.forEach(answer => {
      distribution[answer.answer_value] = (distribution[answer.answer_value] || 0) + 1;
      users.add(answer.username);
    });

    // Find consensus (most common answer)
    let consensus = null;
    let maxCount = 0;
    Object.entries(distribution).forEach(([value, count]) => {
      if (count > maxCount) {
        maxCount = count;
        consensus = value;
      }
    });

    // Convert to percentages
    const total = data.length;
    const percentages = {};
    Object.entries(distribution).forEach(([value, count]) => {
      percentages[value] = Math.round((count / total) * 100);
    });

    const stats = {
      questionId,
      consensus,
      distribution: percentages,
      totalResponses: total,
      uniqueUsers: users.size,
      timestamp: Date.now()
    };

    // Cache the results
    cache.questionStats.set(questionId, {
      data: stats,
      timestamp: Date.now()
    });

    res.json(stats);

  } catch (error) {
    console.error('Error calculating stats:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/sync/manifest', async (req, res) => {
  try {
    await ensureSyncCache();

    const units = {};
    syncCache.units.forEach((unitData, unitId) => {
      units[unitId] = {
        hash: unitData.hash,
        lessonCount: unitData.lessons?.size || 0,
        updatedAt: unitData.lastUpdated || syncCache.lastBuilt
      };
    });

    res.json({
      generatedAt: Date.now(),
      unitCount: Object.keys(units).length,
      units
    });
  } catch (error) {
    console.error('Error building sync manifest:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/sync/unit/:unitId', async (req, res) => {
  try {
    const { unitId } = req.params;
    await ensureSyncCache();

    let unitData = syncCache.units.get(unitId);
    if (!unitData) {
      unitData = await refreshUnitCache(unitId);
    }

    if (!unitData) {
      return res.status(404).json({ error: 'Unit not found' });
    }

    const lessons = {};
    unitData.lessons?.forEach((lessonData, lessonId) => {
      lessons[lessonId] = {
        hash: lessonData.hash,
        answerCount: lessonData.answerCount || (lessonData.answers?.length || 0),
        updatedAt: lessonData.lastUpdated || unitData.lastUpdated || syncCache.lastBuilt
      };
    });

    res.json({
      unitId,
      hash: unitData.hash,
      lessons,
      lessonCount: Object.keys(lessons).length,
      updatedAt: unitData.lastUpdated || syncCache.lastBuilt
    });
  } catch (error) {
    console.error('Error fetching unit manifest:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/data/lesson/:lessonId', async (req, res) => {
  try {
    const { lessonId } = req.params;
    const lessonInfo = await ensureLessonCache(lessonId);

    if (!lessonInfo) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    const { unitId, lessonData } = lessonInfo;

    res.json({
      unitId,
      lessonId,
      hash: lessonData.hash,
      answers: lessonData.answers || [],
      answerCount: lessonData.answerCount || (lessonData.answers?.length || 0),
      updatedAt: lessonData.lastUpdated || syncCache.lastBuilt
    });
  } catch (error) {
    console.error('Error fetching lesson data:', error);
    res.status(500).json({ error: error.message });
  }
});

// Submit answer (proxies to Supabase and broadcasts via WebSocket)
app.post('/api/submit-answer', async (req, res) => {
  try {
    const { username, question_id, answer_value, timestamp } = req.body;

    // Normalize timestamp
    const normalizedTimestamp = normalizeTimestamp(timestamp || Date.now());

    // Upsert to Supabase
    const { data, error } = await supabase
      .from('answers')
      .upsert([{
        username,
        question_id,
        answer_value,
        timestamp: normalizedTimestamp
      }], { onConflict: 'username,question_id' });

    if (error) throw error;

    // Invalidate cache
    cache.lastUpdate = 0;
    cache.questionStats.delete(question_id);

    const manifestUpdate = await refreshUnitCacheByQuestion(question_id);

    // Broadcast to WebSocket clients
    const update = {
      type: 'answer_submitted',
      username,
      question_id,
      answer_value,
      timestamp: normalizedTimestamp,
      unitId: manifestUpdate?.unitId || null,
      lessonId: manifestUpdate?.lessonId || null,
      unitHash: manifestUpdate?.unitHash || null,
      lessonHash: manifestUpdate?.lessonHash || null,
      lessonAnswerCount: manifestUpdate?.lessonAnswerCount || 0
    };

    broadcastToClients(update);

    res.json({
      success: true,
      timestamp: normalizedTimestamp,
      broadcast: wsClients.size,
      manifest: manifestUpdate
    });

  } catch (error) {
    console.error('Error submitting answer:', error);
    res.status(500).json({ error: error.message });
  }
});

// Batch submit answers
app.post('/api/batch-submit', async (req, res) => {
  try {
    const { answers } = req.body;

    if (!answers || !Array.isArray(answers)) {
      return res.status(400).json({ error: 'Invalid answers array' });
    }

    // Normalize all timestamps
    const normalizedAnswers = answers.map(answer => ({
      ...answer,
      timestamp: normalizeTimestamp(answer.timestamp || Date.now())
    }));

    // Batch upsert to Supabase
    const { data, error } = await supabase
      .from('answers')
      .upsert(normalizedAnswers, { onConflict: 'username,question_id' });

    if (error) throw error;

    // Invalidate cache
    cache.lastUpdate = 0;
    cache.questionStats.clear();

    const affectedUnits = new Set();
    normalizedAnswers.forEach((answer) => {
      const mapping = parseUnitLesson(answer.question_id);
      if (mapping) {
        affectedUnits.add(mapping.unitId);
      }
    });

    const manifestUpdates = [];
    for (const unitId of affectedUnits) {
      const unitData = await refreshUnitCache(unitId);
      const lessons = [];
      unitData?.lessons?.forEach((lessonData, lessonId) => {
        lessons.push({
          lessonId,
          hash: lessonData.hash,
          answerCount: lessonData.answerCount || (lessonData.answers?.length || 0)
        });
      });
      manifestUpdates.push({
        unitId,
        unitHash: unitData?.hash || null,
        lessons
      });
    }

    // Broadcast batch update
    const update = {
      type: 'batch_submitted',
      count: normalizedAnswers.length,
      timestamp: Date.now(),
      units: manifestUpdates
    };

    broadcastToClients(update);

    res.json({
      success: true,
      count: normalizedAnswers.length,
      broadcast: wsClients.size,
      units: manifestUpdates
    });

  } catch (error) {
    console.error('Error batch submitting:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get server statistics
app.get('/api/stats', async (req, res) => {
  try {
    // Get counts from Supabase
    const { count: totalAnswers } = await supabase
      .from('answers')
      .select('*', { count: 'exact', head: true });

    const { data: users } = await supabase
      .from('answers')
      .select('username')
      .limit(1000);

    const uniqueUsers = new Set(users?.map(u => u.username) || []);

    res.json({
      totalAnswers,
      uniqueUsers: uniqueUsers.size,
      connectedClients: wsClients.size,
      cacheStatus: isCacheValid(cache.lastUpdate) ? 'warm' : 'cold',
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024 + ' MB'
    });

  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================
// WEBSOCKET SERVER
// ============================

const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 WebSocket ready for connections`);
  console.log(`🗄️ Connected to Supabase`);
});

const wss = new WebSocketServer({ server });

ensureSyncCache(true).catch((error) => {
  console.error('Initial sync cache warmup failed:', error);
});

wss.on('connection', (ws) => {
  console.log('New WebSocket client connected');
  wsClients.add(ws);

  // Send welcome message
  ws.send(JSON.stringify({
    type: 'connected',
    message: 'Connected to AP Stats Turbo Server',
    clients: wsClients.size
  }));

  // Send initial presence snapshot
  sendPresenceSnapshot(ws);

  // Handle client messages
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      switch (data.type) {
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          break;

        case 'identify': {
          const username = (data.username || '').trim();
          if (!username) break;
          wsToUser.set(ws, username);
          let info = presence.get(username);
          if (!info) {
            info = { lastSeen: Date.now(), connections: new Set() };
            presence.set(username, info);
          }
          info.connections.add(ws);
          info.lastSeen = Date.now();
          // Broadcast user online
          broadcastToClients({ type: 'user_online', username, timestamp: Date.now() });
          break;
        }

        case 'heartbeat': {
          const username = (data.username || wsToUser.get(ws) || '').trim();
          if (!username) break;
          let info = presence.get(username);
          if (!info) {
            info = { lastSeen: Date.now(), connections: new Set([ws]) };
            presence.set(username, info);
          }
          info.lastSeen = Date.now();
          break;
        }

        case 'subscribe':
          // Client wants to subscribe to a specific question
          ws.questionId = data.questionId;
          ws.send(JSON.stringify({
            type: 'subscribed',
            questionId: data.questionId
          }));
          break;

        default:
          console.log('Unknown message type:', data.type);
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  });

  // Handle disconnect
  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    wsClients.delete(ws);
    // Remove from presence map
    const username = wsToUser.get(ws);
    if (username) {
      const info = presence.get(username);
      if (info) {
        info.connections.delete(ws);
        if (info.connections.size === 0) {
          // Defer offline broadcast to allow quick reconnects; rely on TTL cleanup
          info.lastSeen = Date.now();
        }
      }
      wsToUser.delete(ws);
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    wsClients.delete(ws);
    wsToUser.delete(ws);
  });
});

// Broadcast to all connected clients
function broadcastToClients(data) {
  const message = JSON.stringify(data);

  wsClients.forEach(client => {
    if (client.readyState === 1) { // WebSocket.OPEN
      try {
        client.send(message);
      } catch (error) {
        console.error('Error broadcasting to client:', error);
      }
    }
  });
}

// Presence helpers
function getOnlineUsernames() {
  const now = Date.now();
  const users = [];
  presence.forEach((info, username) => {
    if (info.connections && info.connections.size > 0 && (now - info.lastSeen) < PRESENCE_TTL_MS) {
      users.push(username);
    }
  });
  return users;
}

function sendPresenceSnapshot(ws) {
  try {
    const users = getOnlineUsernames();
    ws.send(JSON.stringify({ type: 'presence_snapshot', users, timestamp: Date.now() }));
  } catch (e) {
    console.error('Failed to send presence snapshot:', e);
  }
}

// Set up Supabase real-time subscription
const subscription = supabase
  .channel('answers_changes')
  .on('postgres_changes',
    { event: '*', schema: 'public', table: 'answers' },
    (payload) => {
      console.log('Real-time update from Supabase:', payload);

      // Invalidate cache
      cache.lastUpdate = 0;

      const questionId = payload.new?.question_id || payload.old?.question_id;
      if (questionId) {
        refreshUnitCacheByQuestion(questionId).catch((error) => {
          console.error('Failed to refresh unit cache from realtime update:', error);
        });
      }

      // Broadcast to all WebSocket clients
      broadcastToClients({
        type: 'realtime_update',
        event: payload.eventType,
        data: payload.new || payload.old,
        timestamp: Date.now()
      });
    }
  )
  .subscribe();

console.log('📊 Subscribed to Supabase real-time updates');

// Periodic presence cleanup and offline broadcast
setInterval(() => {
  const now = Date.now();
  const toOffline = [];
  presence.forEach((info, username) => {
    const isConnected = info.connections && info.connections.size > 0;
    if (!isConnected && (now - info.lastSeen) > PRESENCE_TTL_MS) {
      toOffline.push(username);
    }
  });
  toOffline.forEach((username) => {
    presence.delete(username);
    broadcastToClients({ type: 'user_offline', username, timestamp: Date.now() });
  });
}, Math.max(5000, Math.floor(PRESENCE_TTL_MS / 3)));

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});