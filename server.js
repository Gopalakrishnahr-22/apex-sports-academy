const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cors = require('cors');
const nodemailer = require('nodemailer');
const Razorpay = require('razorpay');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const compression = require('compression');
const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(compression());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// File paths
const CONFIG_FILE = path.join(__dirname, 'config.json');
const CREDENTIALS_FILE = path.join(__dirname, 'credentials.json');
const DATABASE_FILE = path.join(__dirname, 'database.json');
const AUDIT_LOG_FILE = path.join(__dirname, 'admin_audit.log');

// Active admin session tokens: Map<token, expiresAt>
// Active session tokens: Map<token, { role: 'admin'|'user', username, name, email, phone, expiresAt }>
const ACTIVE_TOKENS = new Map();
const SESSION_EXPIRY_MS = parseInt(process.env.SESSION_EXPIRY_HOURS || '8', 10) * 60 * 60 * 1000;

// --- Helper Functions ---

function getTokenData(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.split(' ')[1];
  if (!ACTIVE_TOKENS.has(token)) return null;
  const session = ACTIVE_TOKENS.get(token);
  if (Date.now() > session.expiresAt) {
    ACTIVE_TOKENS.delete(token);
    return null;
  }
  return { token, ...session };
}

function isAuthorized(req) {
  const session = getTokenData(req);
  return session && session.role === 'admin';
}

// Middleware: require valid authenticated session (user or admin)
function requireAuth(req, res, next) {
  const session = getTokenData(req);
  if (!session) {
    return res.status(401).json({ success: false, error: 'Authentication required. Please log in.' });
  }
  req.user = session;
  next();
}

// Middleware: require valid admin role on protected routes
function requireAdmin(req, res, next) {
  const session = getTokenData(req);
  if (!session) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Authentication required.' });
  }
  if (session.role !== 'admin') {
    auditLog('UNAUTHORIZED_ADMIN_ACCESS_ATTEMPT', `user=${session.username || 'unknown'} role=${session.role} ip=${req.ip}`);
    return res.status(403).json({ success: false, error: 'Forbidden: Administrator privileges required.' });
  }
  req.user = session;
  next();
}

// Brute-force protection: 5 attempts per 15 minutes on /api/login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    auditLog('BRUTE_FORCE_BLOCKED', `ip=${req.ip}`);
    res.status(429).json({ success: false, error: 'Too many login attempts. Please wait 15 minutes.' });
  }
});

// Audit log helper
function auditLog(action, details = '') {
  const entry = `[${new Date().toISOString()}] ${action} | ${details}\n`;
  try { fs.appendFileSync(AUDIT_LOG_FILE, entry); } catch (e) { /* ignore */ }
  console.log(`[AUDIT] ${entry.trim()}`);
}

function loadCredentials() {
  const envUser = process.env.ADMIN_USERNAME;
  const envPass = process.env.ADMIN_PASSWORD;
  const envHash = process.env.ADMIN_PASSWORD_HASH;

  if (envUser && envUser.trim().toLowerCase() !== 'admin') {
    return { username: envUser.trim(), password: (envPass || '').trim(), passwordHash: (envHash || '').trim() };
  }

  // Check config.json for saved hash
  const configData = readConfigFile();
  if (configData.ADMIN_USERNAME && configData.ADMIN_USERNAME.toLowerCase() !== 'admin') {
    return {
      username: configData.ADMIN_USERNAME,
      password: configData.ADMIN_PASSWORD || '',
      passwordHash: configData.ADMIN_PASSWORD_HASH || ''
    };
  }

  if (fs.existsSync(CREDENTIALS_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
      if (data && data.username && data.username.toLowerCase() !== 'admin') {
        return data;
      }
    } catch (e) {
      console.error('Error reading credentials.json:', e.message);
    }
  }
  return { username: 'apexsportsacademy', password: 'Asa08@2026', passwordHash: '' };
}

function readConfigFile() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (e) {
      console.error('Error reading config.json:', e.message);
    }
  }
  return {};
}

function writeConfigFile(data) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Error writing config.json:', e.message);
  }
}

// Razorpay Keys & Client
function loadRazorpayKeys() {
  let keyId = (process.env.RAZORPAY_KEY_ID || '').trim();
  let keySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();

  if (!keyId || !keySecret) {
    const configData = readConfigFile();
    if (!keyId && configData.RAZORPAY_KEY_ID) keyId = configData.RAZORPAY_KEY_ID.trim();
    if (!keySecret && configData.RAZORPAY_KEY_SECRET) keySecret = configData.RAZORPAY_KEY_SECRET.trim();
  }

  if (!keyId) keyId = 'rzp_test_placeholder_key_id';
  if (!keySecret) keySecret = 'rzp_test_placeholder_key_secret';

  return { keyId, keySecret };
}

function getRazorpayClient() {
  const { keyId, keySecret } = loadRazorpayKeys();
  if (keyId.includes('placeholder') || !keyId || !keySecret) {
    return { client: null, keyId, keySecret };
  }
  try {
    const client = new Razorpay({
      key_id: keyId,
      key_secret: keySecret
    });
    return { client, keyId, keySecret };
  } catch (e) {
    console.error('Error initializing Razorpay Client:', e.message);
    return { client: null, keyId, keySecret };
  }
}

// Supabase Client
function getSupabaseClient() {
  let supabaseUrl = (process.env.SUPABASE_URL || '').trim();
  let supabaseKey = (process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!supabaseUrl || !supabaseKey) {
    const configData = readConfigFile();
    if (!supabaseUrl && configData.SUPABASE_URL) supabaseUrl = configData.SUPABASE_URL.trim();
    if (!supabaseKey && configData.SUPABASE_KEY) supabaseKey = configData.SUPABASE_KEY.trim();
  }

  if (!supabaseUrl) {
    supabaseUrl = 'https://igfzsyslvzdlelgtarkq.supabase.co';
  }

  if (!supabaseKey || supabaseKey.includes('placeholder')) {
    return null;
  }

  try {
    return createClient(supabaseUrl, supabaseKey);
  } catch (e) {
    console.error('Error creating Supabase client:', e.message);
    return null;
  }
}

// Local Database (database.json)
// Local Database (database.json)
function loadDbLocal() {
  if (!fs.existsSync(DATABASE_FILE)) {
    return { venues: [], venue_pricing: {}, bookings: [], blocked_slots: [], registrations: [], enquiries: [], users: [], newsletter_subscribers: [] };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(DATABASE_FILE, 'utf8'));
    return {
      venues: raw.venues || [],
      venue_pricing: raw.venue_pricing || {},
      bookings: raw.bookings || [],
      blocked_slots: raw.blocked_slots || [],
      registrations: raw.registrations || [],
      coachingSubscriptions: raw.coachingSubscriptions || [],
      enquiries: raw.enquiries || [],
      users: raw.users || [],
      newsletter_subscribers: raw.newsletter_subscribers || []
    };
  } catch (e) {
    return { venues: [], venue_pricing: {}, bookings: [], blocked_slots: [], registrations: [], enquiries: [], users: [], newsletter_subscribers: [] };
  }
}

function saveDbLocal(db) {
  try {
    fs.writeFileSync(DATABASE_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving local database:', e.message);
  }
}

function withTimeout(promise, ms = 2500) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Database query timed out')), ms))
  ]);
}

async function loadDb() {
  const localData = loadDbLocal();
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const regPromise = supabase.from('registrations').select('*').order('id', { ascending: false });
      const enqPromise = supabase.from('enquiries').select('*').order('id', { ascending: false });
      const userPromise = supabase.from('users').select('*').order('id', { ascending: false });
      const bookingPromise = supabase.from('bookings').select('*').order('id', { ascending: false });
      const blockedPromise = supabase.from('blocked_slots').select('*');

      const [regRes, enqRes, userRes, bookingRes, blockedRes] = await withTimeout(
        Promise.all([
          Promise.resolve(regPromise).catch(() => ({ data: [] })),
          Promise.resolve(enqPromise).catch(() => ({ data: [] })),
          Promise.resolve(userPromise).catch(() => ({ data: [] })),
          Promise.resolve(bookingPromise).catch(() => ({ data: [] })),
          Promise.resolve(blockedPromise).catch(() => ({ data: [] }))
        ]),
        2500
      );

      const remoteRegs = (regRes && !regRes.error && Array.isArray(regRes.data)) ? regRes.data : [];
      const remoteEnqs = (enqRes && !enqRes.error && Array.isArray(enqRes.data)) ? enqRes.data : [];
      const remoteUsers = (userRes && !userRes.error && Array.isArray(userRes.data)) ? userRes.data : [];
      const remoteBookings = (bookingRes && !bookingRes.error && Array.isArray(bookingRes.data)) ? bookingRes.data : [];
      const remoteBlocked = (blockedRes && !blockedRes.error && Array.isArray(blockedRes.data)) ? blockedRes.data : [];

      // Combine remote and local records without duplicates
      const mergedRegistrations = [...remoteRegs];
      for (const r of (localData.registrations || [])) {
        if (!mergedRegistrations.some(mr => mr.id === r.id || (mr.txnId && mr.txnId === r.txnId))) {
          mergedRegistrations.push(r);
        }
      }

      const mergedEnquiries = [...remoteEnqs];
      for (const e of (localData.enquiries || [])) {
        if (!mergedEnquiries.some(me => me.id === e.id)) {
          mergedEnquiries.push(e);
        }
      }

      const mergedUsers = [...remoteUsers];
      for (const u of (localData.users || [])) {
        if (!mergedUsers.some(mu => mu.id === u.id || (mu.email && mu.email === u.email) || (mu.phone && mu.phone === u.phone))) {
          mergedUsers.push(u);
        }
      }

      const mergedBookings = [...remoteBookings];
      for (const b of (localData.bookings || [])) {
        if (!mergedBookings.some(mb => mb.id === b.id)) {
          mergedBookings.push(b);
        }
      }

      const mergedBlocked = [...remoteBlocked];
      for (const bs of (localData.blocked_slots || [])) {
        if (!mergedBlocked.some(mbs => mbs.id === bs.id || (mbs.date === bs.date && mbs.timeSlot === bs.timeSlot && mbs.sportId === bs.sportId))) {
          mergedBlocked.push(bs);
        }
      }

      return {
        venues: localData.venues || [],
        venue_pricing: localData.venue_pricing || {},
        bookings: mergedBookings,
        blocked_slots: mergedBlocked,
        registrations: mergedRegistrations,
        enquiries: mergedEnquiries,
        users: mergedUsers,
        newsletter_subscribers: localData.newsletter_subscribers || []
      };
    } catch (e) {
      console.warn('Supabase load error/timeout, falling back to local database:', e.message);
    }
  }
  return localData;
}

async function saveUserToDb(userRecord) {
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { error } = await supabase.from('users').insert([userRecord]);
      if (!error) {
        console.log('[Supabase] User account saved to Supabase:', userRecord.id);
      } else {
        console.warn('Supabase insert error (users):', error.message);
      }
    } catch (e) {
      console.warn('Supabase insert exception (users):', e.message);
    }
  }

  const db = loadDbLocal();
  db.users = db.users || [];
  db.users.push(userRecord);
  saveDbLocal(db);
}

async function saveRegistrationToDb(record) {
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { error } = await supabase.from('registrations').insert([record]);
      if (!error) return;
      console.warn('Supabase insert error (registrations):', error.message);
    } catch (e) {
      console.warn('Supabase insert exception (registrations):', e.message);
    }
  }

  const db = loadDbLocal();
  db.registrations = db.registrations || [];
  db.registrations.unshift(record);
  saveDbLocal(db);
}

async function saveCoachingRegistrationToDb(record) {
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { error } = await supabase.from('coaching_registrations').insert([record]);
      if (error) {
        console.warn('Supabase insert error (coaching_registrations):', error.message);
      }
    } catch (e) {
      console.warn('Supabase insert exception (coaching_registrations):', e.message);
    }
  }

  const db = loadDbLocal();
  db.coachingRegistrations = db.coachingRegistrations || db.coachingSubscriptions || [];
  
  const existingIdx = db.coachingRegistrations.findIndex(item => item.id === record.id);
  if (existingIdx >= 0) {
    db.coachingRegistrations[existingIdx] = { ...db.coachingRegistrations[existingIdx], ...record };
  } else {
    db.coachingRegistrations.unshift(record);
  }

  db.coachingSubscriptions = db.coachingRegistrations;
  saveDbLocal(db);
}

async function saveSubscriptionToDb(record) {
  return saveCoachingRegistrationToDb(record);
}

async function getCoachingRegistrationsFromDb() {
  let list = [];
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('coaching_registrations')
        .select('*')
        .order('created_at', { ascending: false });
      if (!error && Array.isArray(data)) {
        list = data;
      }
    } catch (e) {
      console.warn('Supabase fetch exception (coaching_registrations):', e.message);
    }
  }

  const db = loadDbLocal();
  const localList = db.coachingRegistrations || db.coachingSubscriptions || [];

  const map = new Map();
  [...list, ...localList].forEach(item => {
    if (item && item.id) map.set(item.id, item);
  });

  return Array.from(map.values());
}

async function getSubscriptionsFromDb() {
  return getCoachingRegistrationsFromDb();
}

async function updateCoachingRegistrationInDb(id, updates) {
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { error } = await supabase
        .from('coaching_registrations')
        .update(updates)
        .eq('id', id);
      if (error) {
        console.warn('Supabase update error (coaching_registrations):', error.message);
      }
    } catch (e) {
      console.warn('Supabase update exception (coaching_registrations):', e.message);
    }
  }

  const db = loadDbLocal();
  db.coachingRegistrations = db.coachingRegistrations || db.coachingSubscriptions || [];
  const idx = db.coachingRegistrations.findIndex(item => item.id === id);
  if (idx >= 0) {
    db.coachingRegistrations[idx] = { ...db.coachingRegistrations[idx], ...updates, updated_at: new Date().toISOString() };
    db.coachingSubscriptions = db.coachingRegistrations;
    saveDbLocal(db);
    return db.coachingRegistrations[idx];
  }
  return null;
}

async function saveEnquiryToDb(data) {
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { error } = await supabase.from('enquiries').insert([data]);
      if (!error) return;
      console.warn('Supabase insert error (enquiries):', error.message);
    } catch (e) {
      console.warn('Supabase insert exception (enquiries):', e.message);
    }
  }

  const db = loadDbLocal();
  db.enquiries = db.enquiries || [];
  db.enquiries.unshift(data);
  saveDbLocal(db);
}

async function toggleEnquiryInDb(enqId) {
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('enquiries')
        .select('status')
        .eq('id', enqId)
        .single();

      if (!error && data) {
        const newStatus = data.status === 'Resolved' ? 'Pending Callback' : 'Resolved';
        await supabase.from('enquiries').update({ status: newStatus }).eq('id', enqId);
        return;
      }
    } catch (e) {
      console.warn('Supabase update error (enquiries):', e.message);
    }
  }

  const db = loadDbLocal();
  if (db.enquiries) {
    for (const enq of db.enquiries) {
      if (enq.id === enqId) {
        enq.status = enq.status === 'Resolved' ? 'Pending Callback' : 'Resolved';
        break;
      }
    }
    saveDbLocal(db);
  }
}

async function deleteEnquiryFromDb(enqId) {
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      await supabase.from('enquiries').delete().eq('id', enqId);
      return;
    } catch (e) {
      console.warn('Supabase delete error (enquiries):', e.message);
    }
  }

  const db = loadDbLocal();
  if (db.enquiries) {
    db.enquiries = db.enquiries.filter(e => e.id !== enqId);
    saveDbLocal(db);
  }
}

async function clearAllDataFromDb() {
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      await supabase.from('registrations').delete().neq('id', '');
      await supabase.from('enquiries').delete().neq('id', '');
      await supabase.from('bookings').delete().neq('id', '');
      return;
    } catch (e) {
      console.warn('Supabase clear error:', e.message);
    }
  }

  const local = loadDbLocal();
  saveDbLocal({
    venues: local.venues || [],
    venue_pricing: local.venue_pricing || {},
    bookings: [],
    blocked_slots: [],
    registrations: [],
    enquiries: [],
    users: local.users || [],
    newsletter_subscribers: local.newsletter_subscribers || []
  });
}

// --- Venue Bookings, Slot Management & Pricing Database Operations ---

async function saveBookingToDb(bookingRecord) {
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { error } = await supabase.from('bookings').insert([bookingRecord]);
      if (!error) {
        console.log('[Supabase] Venue booking saved to Supabase:', bookingRecord.id);
      } else {
        console.warn('Supabase insert error (bookings):', error.message);
      }
    } catch (e) {
      console.warn('Supabase insert exception (bookings):', e.message);
    }
  }

  const db = loadDbLocal();
  db.bookings = db.bookings || [];
  db.bookings.unshift(bookingRecord);
  saveDbLocal(db);
}

async function updateBookingInDb(bookingId, updates) {
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      await supabase.from('bookings').update(updates).eq('id', bookingId);
    } catch (e) {
      console.warn('Supabase update exception (bookings):', e.message);
    }
  }

  const db = loadDbLocal();
  if (db.bookings) {
    const b = db.bookings.find(item => item.id === bookingId);
    if (b) {
      Object.assign(b, updates);
      saveDbLocal(db);
      return b;
    }
  }
  return null;
}

async function saveBlockedSlotToDb(blockRecord) {
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      await supabase.from('blocked_slots').insert([blockRecord]);
    } catch (e) {
      console.warn('Supabase insert exception (blocked_slots):', e.message);
    }
  }

  const db = loadDbLocal();
  db.blocked_slots = db.blocked_slots || [];
  db.blocked_slots.push(blockRecord);
  saveDbLocal(db);
  return blockRecord;
}

async function deleteBlockedSlotFromDb(id) {
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      await supabase.from('blocked_slots').delete().eq('id', id);
    } catch (e) {
      console.warn('Supabase delete exception (blocked_slots):', e.message);
    }
  }

  const db = loadDbLocal();
  if (db.blocked_slots) {
    db.blocked_slots = db.blocked_slots.filter(b => b.id !== id);
    saveDbLocal(db);
  }
}

async function updateVenuePricingInDb(newPricing) {
  const db = loadDbLocal();
  db.venue_pricing = { ...(db.venue_pricing || {}), ...newPricing };
  saveDbLocal(db);
  return db.venue_pricing;
}

// Server-side Dynamic Price Calculation Engine
function calculateSlotPrice(sportId, dateStr, timeSlots, duration = null) {
  const db = loadDbLocal();
  const pricingConfig = db.venue_pricing || {};

  const sKey = (sportId || 'football').toLowerCase().replace(/\s+/g, '-');
  const sportConfig = pricingConfig[sKey] || {
    name: sportId || 'Sport',
    weekdayHourlyRate: 500,
    weekendHourlyRate: 500,
    peakHourMultiplier: 1.0,
    peakSlots: []
  };

  const dateObj = new Date(dateStr + 'T12:00:00Z');
  const dayOfWeek = isNaN(dateObj.getTime()) ? 1 : dateObj.getUTCDay();
  const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6); // Sun=0, Sat=6

  const baseRate = isWeekend ? Number(sportConfig.weekendHourlyRate || 500) : Number(sportConfig.weekdayHourlyRate || 500);
  const peakMultiplier = Number(sportConfig.peakHourMultiplier || 1.0);
  const peakSlots = Array.isArray(sportConfig.peakSlots) ? sportConfig.peakSlots : [];

  const slots = Array.isArray(timeSlots) ? timeSlots : [timeSlots];
  let totalAmount = 0;
  const breakdown = [];

  const numDuration = duration ? Number(duration) : null;
  if (numDuration && numDuration === 1.5 && slots.length >= 1) {
    const firstSlot = slots[0];
    const isPeak = peakSlots.some(p => p.trim() === firstSlot.trim());
    const slotRate = isPeak ? Math.round(baseRate * peakMultiplier) : baseRate;
    totalAmount = Math.round(slotRate * 1.5);
    breakdown.push({
      slot: firstSlot + ' (1.5h)',
      baseRate,
      isWeekend,
      isPeak,
      multiplier: isPeak ? peakMultiplier : 1.0,
      durationHours: 1.5,
      slotPrice: totalAmount
    });
  } else {
    for (const slot of slots) {
      if (!slot) continue;
      const isPeak = peakSlots.some(p => p.trim() === slot.trim());
      const slotRate = isPeak ? Math.round(baseRate * peakMultiplier) : baseRate;
      totalAmount += slotRate;
      breakdown.push({
        slot,
        baseRate,
        isWeekend,
        isPeak,
        multiplier: isPeak ? peakMultiplier : 1.0,
        slotPrice: slotRate
      });
    }
  }

  return {
    sportId: sKey,
    sportName: sportConfig.name || sportId,
    date: dateStr,
    isWeekend,
    slotsCount: slots.length,
    durationHours: numDuration || slots.length,
    baseHourlyRate: baseRate,
    totalAmount,
    breakdown
  };
}

// --- Nodemailer Gmail SMTP Configuration & Email Helpers ---

function getEmailCredentials() {
  const config = readConfigFile();
  const user = (process.env.GMAIL_USER || process.env.SMTP_USER || process.env.EMAIL_USER || config.GMAIL_USER || config.SMTP_USER || '').trim();
  const pass = (process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS || process.env.EMAIL_PASS || config.GMAIL_APP_PASSWORD || config.SMTP_PASS || '').trim();
  const adminEmail = (process.env.ADMIN_NOTIFICATION_EMAIL || config.ADMIN_NOTIFICATION_EMAIL || user || 'info@apexsports.in').trim();

  return { user, pass, adminEmail };
}

function createMailTransporter() {
  const { user, pass } = getEmailCredentials();

  if (!user || !pass || user.includes('example.com') || pass.includes('placeholder')) {
    return null;
  }

  // Gmail SMTP Transporter
  return nodemailer.createTransport({
    service: 'gmail',
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // SSL
    auth: {
      user: user,
      pass: pass // Gmail 16-character App Password
    }
  });
}

// 1. Send Registration Confirmation & Receipt Email
async function sendRegistrationConfirmationEmail(record) {
  const { user, adminEmail } = getEmailCredentials();
  const transporter = createMailTransporter();

  const isTournament = record.type && record.type.toLowerCase().includes('tournament');
  const typeLabel = isTournament ? 'Tournament Entry' : 'Academy Coaching';

  const htmlContent = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Registration Confirmation - Apex Sports Academy</title>
  </head>
  <body style="margin: 0; padding: 0; background-color: #0f172a; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #f8fafc;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #0f172a; padding: 30px 10px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background: #1e293b; border-radius: 16px; overflow: hidden; border: 1px solid #334155; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
            <!-- Header -->
            <tr>
              <td style="background: linear-gradient(135deg, #00b4d8 0%, #0077b6 100%); padding: 30px; text-align: center;">
                <h1 style="margin: 0; color: #ffffff; font-size: 26px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase;">Apex Sports Academy</h1>
                <p style="margin: 6px 0 0 0; color: #e0f2fe; font-size: 14px; font-weight: 500;">Official Registration & Payment Confirmation</p>
              </td>
            </tr>
            <!-- Content -->
            <tr>
              <td style="padding: 30px;">
                <div style="text-align: center; margin-bottom: 24px;">
                  <span style="display: inline-block; background-color: #10b981; color: #ffffff; padding: 6px 16px; border-radius: 20px; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">Payment Confirmed & Verified</span>
                </div>
                
                <p style="font-size: 16px; line-height: 1.6; color: #cbd5e1; margin-bottom: 20px;">
                  Dear <strong>${record.contactPerson || record.entityName || 'Athlete'}</strong>,
                </p>
                <p style="font-size: 15px; line-height: 1.6; color: #94a3b8; margin-bottom: 24px;">
                  Thank you for registering with Apex Sports Academy. We have successfully received your payment for the <strong>${record.type}</strong>. Below is your official registration receipt.
                </p>

                <!-- Receipt Table -->
                <table width="100%" cellspacing="0" cellpadding="10" style="background-color: #0f172a; border-radius: 10px; border: 1px solid #334155; margin-bottom: 24px; font-size: 14px;">
                  <tr>
                    <td style="color: #94a3b8; border-bottom: 1px solid #1e293b; width: 40%;">Registration ID:</td>
                    <td style="color: #38bdf8; font-weight: 700; border-bottom: 1px solid #1e293b;">${record.id}</td>
                  </tr>
                  <tr>
                    <td style="color: #94a3b8; border-bottom: 1px solid #1e293b;">Date & Time:</td>
                    <td style="color: #f8fafc; font-weight: 600; border-bottom: 1px solid #1e293b;">${record.date}</td>
                  </tr>
                  <tr>
                    <td style="color: #94a3b8; border-bottom: 1px solid #1e293b;">${isTournament ? 'Team / Entity Name:' : 'Student Name:'}</td>
                    <td style="color: #f8fafc; font-weight: 600; border-bottom: 1px solid #1e293b;">${record.entityName}</td>
                  </tr>
                  <tr>
                    <td style="color: #94a3b8; border-bottom: 1px solid #1e293b;">Category / Plan:</td>
                    <td style="color: #f8fafc; font-weight: 600; border-bottom: 1px solid #1e293b;">${record.type}</td>
                  </tr>
                  <tr>
                    <td style="color: #94a3b8; border-bottom: 1px solid #1e293b;">Details:</td>
                    <td style="color: #f8fafc; border-bottom: 1px solid #1e293b;">${record.details || 'N/A'}</td>
                  </tr>
                  <tr>
                    <td style="color: #94a3b8; border-bottom: 1px solid #1e293b;">Transaction ID:</td>
                    <td style="color: #f8fafc; font-family: monospace; border-bottom: 1px solid #1e293b;">${record.txnId || 'Razorpay Verified'}</td>
                  </tr>
                  <tr>
                    <td style="color: #94a3b8; font-size: 16px; font-weight: 700;">Amount Paid:</td>
                    <td style="color: #10b981; font-size: 18px; font-weight: 800;">₹${record.amount} INR</td>
                  </tr>
                </table>

                <!-- Venue & Instructions -->
                <div style="background-color: #1e293b; border-left: 4px solid #00b4d8; padding: 16px; border-radius: 4px; margin-bottom: 24px;">
                  <h4 style="margin: 0 0 8px 0; color: #00b4d8; font-size: 15px;">Venue & Instructions</h4>
                  <p style="margin: 0; color: #cbd5e1; font-size: 13px; line-height: 1.5;">
                    📍 <strong>Apex Sports Academy</strong>, Main Indoor Volleyball Complex.<br>
                    Please arrive 15 minutes before scheduled session/match. Bring a digital or printed copy of this confirmation ID (<strong>${record.id}</strong>).
                  </p>
                </div>

                <p style="font-size: 13px; color: #64748b; text-align: center; margin: 0;">
                  If you have questions, please reach out at <a href="mailto:${adminEmail}" style="color: #00b4d8; text-decoration: none;">${adminEmail}</a> or call us at <strong>+91 98765 43210</strong>.
                </p>
              </td>
            </tr>
            <!-- Footer -->
            <tr>
              <td style="background-color: #0f172a; padding: 20px; text-align: center; border-top: 1px solid #334155;">
                <p style="margin: 0; font-size: 12px; color: #64748b;">
                  © ${new Date().getFullYear()} Apex Sports Academy. All rights reserved.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
  </html>
  `;

  if (!transporter) {
    console.log(`\n[Nodemailer Notice] Gmail SMTP is not configured yet in .env.`);
    console.log(`[Email Preview - Registration Confirmation] Would send to: ${record.email}`);
    console.log(`  Registration ID: ${record.id} | Name: ${record.entityName} | Amount: ₹${record.amount}\n`);
    return { success: false, reason: 'SMTP not configured' };
  }

  try {
    // 1. Send confirmation to the registrant
    const mailOptions = {
      from: `"Apex Sports Academy" <${user}>`,
      to: record.email,
      subject: `Registration Confirmed - ${record.id} | Apex Sports Academy`,
      html: htmlContent
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[Nodemailer] Registration confirmation email sent to ${record.email}: ${info.messageId}`);

    // 2. Send notification to admin if different from recipient
    if (adminEmail && adminEmail !== record.email) {
      try {
        await transporter.sendMail({
          from: `"Apex Sports System" <${user}>`,
          to: adminEmail,
          subject: `[New Registration] ${record.entityName} - ₹${record.amount} (${record.id})`,
          html: `<p>A new registration has been received and payment confirmed:</p>
                 <ul>
                   <li><strong>ID:</strong> ${record.id}</li>
                   <li><strong>Name:</strong> ${record.entityName}</li>
                   <li><strong>Contact Person:</strong> ${record.contactPerson}</li>
                   <li><strong>Phone:</strong> ${record.phone}</li>
                   <li><strong>Email:</strong> ${record.email}</li>
                   <li><strong>Type:</strong> ${record.type}</li>
                   <li><strong>Amount:</strong> ₹${record.amount}</li>
                   <li><strong>Txn ID:</strong> ${record.txnId}</li>
                   <li><strong>Details:</strong> ${record.details}</li>
                 </ul>`
        });
      } catch (adminErr) {
        console.warn('[Nodemailer] Admin notification failed:', adminErr.message);
      }
    }

    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error('[Nodemailer] Failed to send registration email:', err.message);
    return { success: false, error: err.message };
  }
}

// 1B. Send Venue Booking Confirmation & Receipt Email
async function sendVenueBookingConfirmationEmail(booking) {
  const { user, adminEmail } = getEmailCredentials();
  const transporter = createMailTransporter();

  if (!transporter) {
    console.log(`[Email] Mock/Dev Mode: Venue booking email logged for ${booking.email}`);
    return { success: true, mock: true };
  }

  const slotStr = Array.isArray(booking.timeSlots) ? booking.timeSlots.join(', ') : (booking.timeSlots || 'N/A');

  const htmlContent = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Venue Slot Booking Confirmed - Apex Sports Academy</title>
  </head>
  <body style="margin: 0; padding: 0; background-color: #0b0f19; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #f8fafc;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #0b0f19; padding: 30px 10px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background: #111827; border-radius: 16px; overflow: hidden; border: 1px solid #1f2937; box-shadow: 0 12px 40px rgba(0,0,0,0.6);">
            <!-- Header -->
            <tr>
              <td style="background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%); padding: 32px 24px; text-align: center;">
                <div style="font-size: 32px; margin-bottom: 8px;">🏟️</div>
                <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase;">Apex Sports Academy</h1>
                <p style="margin: 6px 0 0 0; color: #e0f2fe; font-size: 14px; font-weight: 500;">Official Venue Slot Booking Confirmation</p>
              </td>
            </tr>
            <!-- Content -->
            <tr>
              <td style="padding: 28px 24px;">
                <div style="text-align: center; margin-bottom: 20px;">
                  <span style="display: inline-block; background-color: #059669; color: #ffffff; padding: 6px 18px; border-radius: 20px; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">✓ Slot Confirmed & Paid</span>
                </div>
                
                <p style="font-size: 16px; line-height: 1.5; color: #f1f5f9; margin-bottom: 12px;">
                  Hello <strong>${booking.customerName || 'Athlete'}</strong>,
                </p>
                <p style="font-size: 14px; line-height: 1.6; color: #94a3b8; margin-bottom: 22px;">
                  Your slot booking at <strong>Apex Sports Academy</strong> is confirmed. Please arrive 10 minutes prior to your scheduled time slot.
                </p>

                <!-- Booking Details Table -->
                <table width="100%" cellspacing="0" cellpadding="12" style="background-color: #0a0e17; border-radius: 12px; border: 1px solid #1f2937; margin-bottom: 24px; font-size: 14px;">
                  <tr>
                    <td style="color: #94a3b8; border-bottom: 1px solid #1e293b; width: 40%;">Booking ID:</td>
                    <td style="color: #38bdf8; font-weight: 700; border-bottom: 1px solid #1e293b;">${booking.id}</td>
                  </tr>
                  <tr>
                    <td style="color: #94a3b8; border-bottom: 1px solid #1e293b;">Venue:</td>
                    <td style="color: #f8fafc; font-weight: 600; border-bottom: 1px solid #1e293b;">Apex Sports Academy, Electronic City</td>
                  </tr>
                  <tr>
                    <td style="color: #94a3b8; border-bottom: 1px solid #1e293b;">Sport:</td>
                    <td style="color: #f8fafc; font-weight: 700; border-bottom: 1px solid #1e293b;">${booking.sport}</td>
                  </tr>
                  <tr>
                    <td style="color: #94a3b8; border-bottom: 1px solid #1e293b;">Court / Ground:</td>
                    <td style="color: #38bdf8; font-weight: 700; border-bottom: 1px solid #1e293b;">${booking.court || 'Main Arena'}</td>
                  </tr>
                  <tr>
                    <td style="color: #94a3b8; border-bottom: 1px solid #1e293b;">Booking Date:</td>
                    <td style="color: #f8fafc; font-weight: 600; border-bottom: 1px solid #1e293b;">${booking.date}</td>
                  </tr>
                  <tr>
                    <td style="color: #94a3b8; border-bottom: 1px solid #1e293b;">Time Slot(s):</td>
                    <td style="color: #34d399; font-weight: 700; border-bottom: 1px solid #1e293b;">${slotStr}</td>
                  </tr>
                  <tr>
                    <td style="color: #94a3b8; border-bottom: 1px solid #1e293b;">Duration:</td>
                    <td style="color: #f8fafc; font-weight: 600; border-bottom: 1px solid #1e293b;">${booking.durationHours || 1} Hour(s)</td>
                  </tr>
                  <tr>
                    <td style="color: #94a3b8; border-bottom: 1px solid #1e293b;">Team / Player:</td>
                    <td style="color: #f8fafc; font-weight: 600; border-bottom: 1px solid #1e293b;">${booking.teamName || booking.customerName || 'N/A'}</td>
                  </tr>
                  <tr>
                    <td style="color: #94a3b8; border-bottom: 1px solid #1e293b;">Total Amount Paid:</td>
                    <td style="color: #f59e0b; font-weight: 800; font-size: 16px; border-bottom: 1px solid #1e293b;">₹${booking.amount}</td>
                  </tr>
                  <tr>
                    <td style="color: #94a3b8;">Razorpay Payment ID:</td>
                    <td style="color: #cbd5e1; font-family: monospace; font-size: 12px;">${booking.razorpayPaymentId || 'N/A'}</td>
                  </tr>
                </table>

                <!-- Venue Location Notice -->
                <div style="background-color: #1e293b; border-left: 4px solid #38bdf8; padding: 14px; border-radius: 6px; margin-bottom: 24px;">
                  <p style="margin: 0 0 6px 0; color: #f8fafc; font-weight: 600; font-size: 13px;">📍 Venue Location:</p>
                  <p style="margin: 0; color: #94a3b8; font-size: 12px; line-height: 1.5;">
                    VM77+WGJ, Doddanagamangala Rd, Konappana Agrahara, Electronic City, Bengaluru, Karnataka 560100
                  </p>
                </div>

                <div style="text-align: center; margin-top: 20px;">
                  <a href="https://maps.google.com/?q=VM77+WGJ,+Doddanagamangala+Rd,+Konappana+Agrahara,+Electronic+City,+Bengaluru,+Karnataka+560100" style="display: inline-block; background-color: #0284c7; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px; margin-right: 8px;">View on Google Maps</a>
                </div>
              </td>
            </tr>
            <!-- Footer -->
            <tr>
              <td style="background-color: #0f172a; padding: 20px; text-align: center; border-top: 1px solid #1e293b; font-size: 12px; color: #64748b;">
                <p style="margin: 0;">Apex Sports Academy • Electronic City, Bengaluru</p>
                <p style="margin: 4px 0 0 0;">Also listed on Playo: <a href="http://go.playo.app/PLAYOO/l51Ra" style="color: #38bdf8;">Apex Sports on Playo</a></p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
  </html>
  `;

  try {
    const mailOptions = {
      from: `"Apex Sports Academy" <${user}>`,
      to: booking.email,
      subject: `🏟️ Slot Confirmed: ${booking.sport} on ${booking.date} [${booking.id}]`,
      html: htmlContent
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[Nodemailer] Venue booking confirmation sent to ${booking.email}: ${info.messageId}`);

    if (adminEmail && adminEmail !== booking.email) {
      try {
        await transporter.sendMail({
          from: `"Apex Sports System" <${user}>`,
          to: adminEmail,
          subject: `[New Venue Booking] ${booking.sport} - ${booking.customerName} - ₹${booking.amount} (${booking.id})`,
          html: `<p>A new venue slot booking has been confirmed:</p>
                 <ul>
                   <li><strong>Booking ID:</strong> ${booking.id}</li>
                   <li><strong>Sport:</strong> ${booking.sport}</li>
                   <li><strong>Date:</strong> ${booking.date}</li>
                   <li><strong>Slots:</strong> ${slotStr}</li>
                   <li><strong>Customer:</strong> ${booking.customerName} (${booking.phone}, ${booking.email})</li>
                   <li><strong>Team:</strong> ${booking.teamName || 'N/A'}</li>
                   <li><strong>Amount:</strong> ₹${booking.amount}</li>
                   <li><strong>Payment ID:</strong> ${booking.razorpayPaymentId || 'N/A'}</li>
                 </ul>`
        });
      } catch (adminErr) {
        console.warn('[Nodemailer] Admin notification failed:', adminErr.message);
      }
    }

    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error('[Nodemailer] Failed to send venue booking email:', err.message);
    return { success: false, error: err.message };
  }
}

// 2. Send Enquiry Notification & Acknowledgment Email
async function sendEnquiryNotificationEmail(enquiry) {
  const { user, adminEmail } = getEmailCredentials();
  const transporter = createMailTransporter();

  if (!transporter) {
    console.log(`\n[Nodemailer Notice] Gmail SMTP is not configured yet in .env.`);
    console.log(`[Email Preview - Enquiry Alert] Would alert admin (${adminEmail}) for enquiry from: ${enquiry.name} (${enquiry.phone || 'No phone'})\n`);
    return { success: false, reason: 'SMTP not configured' };
  }

  try {
    const isQuickCallback = !enquiry.name && enquiry.phone;
    const emailSubject = isQuickCallback
      ? `⚡ [Quick Callback Request] Phone: ${enquiry.phone}`
      : `[New Website Enquiry] From ${enquiry.name || 'Visitor'}`;
    const headerTitle = isQuickCallback ? '⚡ New Quick Callback Request' : 'New Contact Enquiry Received';

    // 1. Alert Admin
    await transporter.sendMail({
      from: `"Apex Sports Enquiry" <${user}>`,
      to: adminEmail,
      subject: emailSubject,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; background: #f8fafc; color: #1e293b;">
          <h2 style="color: #e50914; margin-top: 0;">${headerTitle}</h2>
          <table cellpadding="8" style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; width: 100%; border-collapse: collapse;">
            <tr style="border-bottom: 1px solid #f1f5f9;"><td><strong>Phone / Mobile:</strong></td><td style="font-size: 16px; font-weight: bold; color: #e50914;">${enquiry.phone || 'N/A'}</td></tr>
            ${enquiry.name ? `<tr style="border-bottom: 1px solid #f1f5f9;"><td><strong>Name:</strong></td><td>${enquiry.name}</td></tr>` : ''}
            ${enquiry.email ? `<tr style="border-bottom: 1px solid #f1f5f9;"><td><strong>Email:</strong></td><td>${enquiry.email}</td></tr>` : ''}
            <tr style="border-bottom: 1px solid #f1f5f9;"><td><strong>Subject / Type:</strong></td><td>${enquiry.subject || enquiry.program || (isQuickCallback ? 'Quick Hero Callback Request' : 'General Inquiry')}</td></tr>
            ${enquiry.message ? `<tr style="border-bottom: 1px solid #f1f5f9;"><td><strong>Message:</strong></td><td>${enquiry.message}</td></tr>` : ''}
            <tr style="border-bottom: 1px solid #f1f5f9;"><td><strong>Date &amp; Time:</strong></td><td>${enquiry.date || new Date().toLocaleString('en-IN')}</td></tr>
            <tr><td><strong>Status:</strong></td><td><span style="background: #fef3c7; color: #b45309; padding: 3px 8px; border-radius: 4px; font-weight: bold;">${enquiry.status || 'Pending Callback'}</span></td></tr>
          </table>
        </div>
      `
    });
    console.log(`[Nodemailer] Admin enquiry alert sent to ${adminEmail}`);

    // 2. If visitor provided email, send automated acknowledgment
    if (enquiry.email && enquiry.email.includes('@')) {
      await transporter.sendMail({
        from: `"Apex Sports Academy" <${user}>`,
        to: enquiry.email,
        subject: `Thank you for contacting Apex Sports Academy`,
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; background: #0f172a; color: #f8fafc; border-radius: 12px;">
            <h2 style="color: #00b4d8;">Hello ${enquiry.name || 'Valued Visitor'},</h2>
            <p style="color: #cbd5e1; line-height: 1.6;">
              Thank you for reaching out to <strong>Apex Sports Academy</strong>! We have received your inquiry regarding our programs and our team will get back to you shortly.
            </p>
            <div style="background: #1e293b; padding: 15px; border-radius: 8px; border-left: 4px solid #00b4d8; margin: 15px 0;">
              <p style="margin: 0; color: #94a3b8; font-size: 14px;"><strong>Your Message:</strong></p>
              <p style="margin: 5px 0 0 0; color: #f8fafc; font-style: italic;">"${enquiry.message || 'General Callback Request'}"</p>
            </div>
            <p style="color: #64748b; font-size: 13px;">Apex Sports Academy • Bangalore, India</p>
          </div>
        `
      });
      console.log(`[Nodemailer] Enquiry acknowledgment sent to ${enquiry.email}`);
    }

    return { success: true };
  } catch (err) {
    console.error('[Nodemailer] Failed to send enquiry email:', err.message);
    return { success: false, error: err.message };
  }
}

// Helper: Get Base URL for Email Links
function getAppBaseUrl(req) {
  if (process.env.APP_BASE_URL && process.env.APP_BASE_URL.trim()) {
    return process.env.APP_BASE_URL.trim().replace(/\/+$/, '');
  }
  if (req) {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.get('host') || `localhost:${PORT}`;
    return `${protocol}://${host}`;
  }
  return `http://localhost:${PORT}`;
}

// 3. Send Newsletter Verification Email (Double-Opt-In)
async function sendNewsletterVerificationEmail(subscriberEmail, rawToken, baseUrl) {
  const { user } = getEmailCredentials();
  const transporter = createMailTransporter();

  const verifyUrl = `${baseUrl}/verify-newsletter?token=${encodeURIComponent(rawToken)}`;

  if (!transporter) {
    console.log(`[Email Preview - Newsletter Verification] Would send verification link to ${subscriberEmail}: ${verifyUrl}`);
    return { success: true, previewUrl: verifyUrl };
  }

  const htmlContent = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verify your Apex Sports Newsletter Subscription</title>
  </head>
  <body style="margin: 0; padding: 0; background-color: #0b0f19; font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif; color: #f8fafc;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #0b0f19; padding: 35px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="background: #131d31; border-radius: 16px; overflow: hidden; border: 1px solid #1e2e4a; box-shadow: 0 12px 36px rgba(0,0,0,0.55); max-width: 560px; width: 100%;">
            <!-- Header Banner -->
            <tr>
              <td style="background: linear-gradient(135deg, #00b4d8 0%, #0077b6 100%); padding: 28px 24px; text-align: center;">
                <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase;">Apex Sports</h1>
                <p style="margin: 6px 0 0 0; color: #e0f2fe; font-size: 13px; font-weight: 500; letter-spacing: 0.5px;">Official Newsletter Subscription</p>
              </td>
            </tr>
            <!-- Content -->
            <tr>
              <td style="padding: 32px 28px;">
                <p style="font-size: 16px; color: #f1f5f9; line-height: 1.6; margin: 0 0 16px 0;">
                  Hello,
                </p>
                <p style="font-size: 15px; color: #cbd5e1; line-height: 1.65; margin: 0 0 24px 0;">
                  Thank you for subscribing to the <strong>Apex Sports</strong> newsletter.
                </p>
                <p style="font-size: 14.5px; color: #94a3b8; line-height: 1.65; margin: 0 0 28px 0;">
                  Please click the button below to confirm your email address and receive tournament schedules, coaching camp dates, match fixtures, and exclusive athletic news.
                </p>

                <!-- Call to Action Button -->
                <div style="text-align: center; margin: 32px 0;">
                  <a href="${verifyUrl}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #00b4d8 0%, #0284c7 100%); color: #ffffff; text-decoration: none; font-size: 15px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; padding: 14px 34px; border-radius: 8px; box-shadow: 0 4px 18px rgba(0, 180, 216, 0.45);">
                    VERIFY MY EMAIL
                  </a>
                </div>

                <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid #1e293b; border-radius: 10px; padding: 16px; margin: 24px 0 20px 0;">
                  <p style="margin: 0 0 8px 0; font-size: 12px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Button not working? Copy &amp; paste this link:</p>
                  <p style="margin: 0; font-size: 12px; color: #38bdf8; word-break: break-all; font-family: monospace;">${verifyUrl}</p>
                </div>

                <p style="font-size: 13px; color: #64748b; line-height: 1.6; margin: 0 0 24px 0;">
                  <em>If you did not request this subscription, you can safely ignore this email. This verification link expires in 24 hours.</em>
                </p>

                <hr style="border: 0; border-top: 1px solid #1e293b; margin: 24px 0;">

                <p style="margin: 0; font-size: 14px; color: #cbd5e1; font-weight: 600;">
                  Regards,<br>
                  <span style="color: #00b4d8;">Apex Sports</span>
                </p>
              </td>
            </tr>
            <!-- Footer -->
            <tr>
              <td style="background: #0d1524; padding: 18px 24px; text-align: center; border-top: 1px solid #1a263d;">
                <p style="margin: 0; font-size: 12px; color: #475569;">
                  &copy; ${new Date().getFullYear()} Apex Sports Academy • Push Your Limit To Know Your Limits
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
  </html>
  `;

  const textContent = `
Hello,

Thank you for subscribing to Apex Sports newsletter.

Please click the link below to confirm your email address and receive schedules, camp dates, tournament updates, and other Apex Sports news:

${verifyUrl}

If you did not request this subscription, you can safely ignore this email.
This verification link expires in 24 hours.

Regards,
Apex Sports
  `.trim();

  try {
    const info = await transporter.sendMail({
      from: `"Apex Sports" <${user}>`,
      to: subscriberEmail,
      subject: "Verify your Apex Sports Newsletter Subscription",
      text: textContent,
      html: htmlContent
    });
    console.log(`[Nodemailer] Newsletter verification email sent to ${subscriberEmail} (msgId: ${info.messageId})`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error('[Nodemailer] Failed to send newsletter verification email:', err.message);
    return { success: false, error: err.message };
  }
}

// 4. Send Admin Notification for Verified Newsletter Subscriber
async function sendAdminVerifiedNewsletterNotification(subscriberEmail, verifiedAt) {
  const { user, adminEmail } = getEmailCredentials();
  const transporter = createMailTransporter();

  if (!transporter || !adminEmail) {
    console.log(`[Email Preview - Admin Newsletter Alert] Verified subscriber: ${subscriberEmail} at ${verifiedAt}`);
    return { success: true };
  }

  const formattedDate = new Date(verifiedAt || Date.now()).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'medium'
  });

  const htmlContent = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <title>New Verified Apex Sports Newsletter Subscriber</title>
  </head>
  <body style="font-family: Arial, sans-serif; background: #0f172a; color: #f8fafc; padding: 20px; margin: 0;">
    <div style="max-width: 520px; margin: 0 auto; background: #1e293b; border-radius: 12px; padding: 24px; border: 1px solid #334155;">
      <div style="background: #10b981; color: white; display: inline-block; padding: 4px 12px; border-radius: 16px; font-size: 12px; font-weight: 700; text-transform: uppercase; margin-bottom: 12px;">Verified Subscriber</div>
      <h2 style="color: #00b4d8; margin: 0 0 16px 0; font-size: 20px;">New Verified Newsletter Subscriber</h2>
      <p style="color: #cbd5e1; font-size: 14px; margin: 0 0 20px 0;">
        A new subscriber has verified their email address and joined the Apex Sports newsletter list.
      </p>
      <div style="background: #0f172a; border-radius: 8px; padding: 16px; border: 1px solid #334155; margin-bottom: 20px;">
        <p style="margin: 0 0 8px 0; font-size: 13px; color: #94a3b8;"><strong>Email Address:</strong></p>
        <p style="margin: 0 0 12px 0; font-size: 16px; color: #f8fafc; font-weight: 600;">${subscriberEmail}</p>
        
        <p style="margin: 0 0 6px 0; font-size: 13px; color: #94a3b8;"><strong>Verified:</strong> <span style="color: #10b981; font-weight: 700;">Yes</span></p>
        <p style="margin: 0; font-size: 13px; color: #94a3b8;"><strong>Verified At:</strong> <span style="color: #cbd5e1;">${formattedDate}</span></p>
      </div>
      <p style="margin: 0; font-size: 12px; color: #64748b;">Apex Sports Academy Automated System</p>
    </div>
  </body>
  </html>
  `;

  const textContent = `
A new newsletter subscriber has verified their email.

Email:
${subscriberEmail}

Verified:
Yes

Verified at:
${formattedDate}
  `.trim();

  try {
    await transporter.sendMail({
      from: `"Apex Sports System" <${user}>`,
      to: adminEmail,
      subject: "New Verified Apex Sports Newsletter Subscriber",
      text: textContent,
      html: htmlContent
    });
    console.log(`[Nodemailer] Admin verified newsletter notification sent to ${adminEmail} for ${subscriberEmail}`);
    return { success: true };
  } catch (err) {
    console.warn('[Nodemailer] Admin verified newsletter notification failed (non-critical):', err.message);
    return { success: false, error: err.message };
  }
}

// Local Newsletter Token Cache Files (to ensure double-opt-in works seamlessly before/after Supabase table migrations)
const NEWSLETTER_TOKENS_FILE = path.join(__dirname, 'newsletter_tokens.json');
const VERIFIED_TOKENS_FILE = path.join(__dirname, 'verified_tokens.json');

function loadLocalNewsletterTokens() {
  if (!fs.existsSync(NEWSLETTER_TOKENS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(NEWSLETTER_TOKENS_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveLocalNewsletterToken(email, tokenHash, expiresAt) {
  try {
    const tokens = loadLocalNewsletterTokens();
    tokens[tokenHash] = {
      email,
      expiresAt: expiresAt instanceof Date ? expiresAt.toISOString() : expiresAt,
      createdAt: new Date().toISOString()
    };
    fs.writeFileSync(NEWSLETTER_TOKENS_FILE, JSON.stringify(tokens, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving local newsletter token:', e.message);
  }
}

function removeLocalNewsletterToken(tokenHash) {
  try {
    const tokens = loadLocalNewsletterTokens();
    if (tokens[tokenHash]) {
      delete tokens[tokenHash];
      fs.writeFileSync(NEWSLETTER_TOKENS_FILE, JSON.stringify(tokens, null, 2), 'utf8');
    }
  } catch (e) {
    console.error('Error removing local newsletter token:', e.message);
  }
}

function loadVerifiedTokenHistory() {
  if (!fs.existsSync(VERIFIED_TOKENS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(VERIFIED_TOKENS_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveVerifiedTokenHistory(tokenHash, email) {
  try {
    const history = loadVerifiedTokenHistory();
    history[tokenHash] = {
      email,
      verifiedAt: new Date().toISOString()
    };
    fs.writeFileSync(VERIFIED_TOKENS_FILE, JSON.stringify(history, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving verified token history:', e.message);
  }
}

// --- Venue Booking System API Endpoints ---

// 0A. Get Venues (Modular multi-venue support)
app.get('/api/venues', async (req, res) => {
  try {
    const db = await loadDb();
    const venues = db.venues && db.venues.length ? db.venues : [
      {
        id: "apex-sports-academy",
        name: "Apex Sports Academy",
        tagline: "Premier Multi-Sport Arena in Electronic City",
        shortLocation: "Electronic City, Bengaluru",
        address: "VM77+WGJ, Doddanagamangala Rd, Konappana Agrahara, Electronic City, Bengaluru, Karnataka 560100",
        sports: [
          { id: "football", name: "Football", icon: "⚽", badge: "AstroTurf Pitch", capacity: "10-14 Players" },
          { id: "box-cricket", name: "Box Cricket", icon: "🏏", badge: "Enclosed Box Pitch", capacity: "12-16 Players" },
          { id: "volleyball", name: "Volleyball", icon: "🏐", badge: "Pro Volleyball Court", capacity: "12 Players" }
        ],
        amenities: [
          { name: "Spacious Parking", icon: "🚗" },
          { name: "Clean Washrooms & Showers", icon: "🚿" },
          { name: "High-Intensity Floodlights", icon: "💡" },
          { name: "Drinking Water Station", icon: "💧" },
          { name: "Covered Dugouts", icon: "🪑" },
          { name: "First Aid Support", icon: "🩹" }
        ],
        timings: {
          weekday: { start: "06:00", end: "15:00", label: "Monday–Friday: 6:00 AM–3:00 PM" },
          weekend: { start: "06:00", end: "18:00", label: "Saturday–Sunday: 6:00 AM–6:00 PM" }
        },
        playoUrl: "http://go.playo.app/PLAYOO/l51Ra"
      }
    ];
    return res.json({ success: true, venues });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// 0B. Get Venue Availability & Slots
app.get('/api/venues/:venueId/availability', async (req, res) => {
  try {
    const { venueId } = req.params;
    const sportParam = (req.query.sport || 'football').toLowerCase().replace(/\s+/g, '-');
    const dateStr = req.query.date || new Date().toISOString().split('T')[0];

    const db = await loadDb();
    const venue = (db.venues || []).find(v => v.id === venueId) || (db.venues || [])[0] || {};
    const timings = venue.timings || {
      weekday: {
        start: "06:00", end: "15:00", label: "Monday–Friday: 6:00 AM–3:00 PM",
        slots: ["06:00 - 07:00", "07:00 - 08:00", "08:00 - 09:00", "09:00 - 10:00", "10:00 - 11:00", "11:00 - 12:00", "12:00 - 13:00", "13:00 - 14:00", "14:00 - 15:00"]
      },
      weekend: {
        start: "06:00", end: "18:00", label: "Saturday–Sunday: 6:00 AM–6:00 PM",
        slots: ["06:00 - 07:00", "07:00 - 08:00", "08:00 - 09:00", "09:00 - 10:00", "10:00 - 11:00", "11:00 - 12:00", "12:00 - 13:00", "13:00 - 14:00", "14:00 - 15:00", "15:00 - 16:00", "16:00 - 17:00", "17:00 - 18:00"]
      }
    };

    const dateObj = new Date(dateStr + 'T12:00:00Z');
    const dayOfWeek = isNaN(dateObj.getTime()) ? 1 : dateObj.getUTCDay();
    const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
    const schedule = isWeekend ? timings.weekend : timings.weekday;
    const allSlots = schedule.slots || [];

    // Find all confirmed or paid bookings for this date and sport
    const bookings = (db.bookings || []).filter(b => {
      const bSport = (b.sportId || b.sport || '').toLowerCase().replace(/\s+/g, '-');
      const bStatus = (b.status || '').toLowerCase();
      const isPaid = bStatus === 'paid' || bStatus === 'booking confirmed' || bStatus === 'payment processing';
      return b.date === dateStr && (bSport === sportParam || bSport === 'all') && isPaid;
    });

    const bookedSlots = [];
    bookings.forEach(b => {
      if (Array.isArray(b.timeSlots)) {
        b.timeSlots.forEach(s => bookedSlots.push(s.trim()));
      } else if (b.timeSlots) {
        bookedSlots.push(String(b.timeSlots).trim());
      }
    });

    // Find all blocked slots for this date and sport
    const blockedSlots = [];
    (db.blocked_slots || []).forEach(blk => {
      const blkSport = (blk.sportId || blk.sport || '').toLowerCase().replace(/\s+/g, '-');
      if (blk.date === dateStr && (blkSport === sportParam || blkSport === 'all')) {
        if (Array.isArray(blk.timeSlots)) {
          blk.timeSlots.forEach(s => blockedSlots.push(s.trim()));
        } else if (blk.timeSlot) {
          blockedSlots.push(String(blk.timeSlot).trim());
        }
      }
    });

    // Pricing preview for this date & sport
    const pricing = (db.venue_pricing && db.venue_pricing[sportParam]) || {
      name: sportParam,
      weekdayHourlyRate: 1000,
      weekendHourlyRate: 1200,
      peakHourMultiplier: 1.2,
      peakSlots: ["06:00 - 07:00", "07:00 - 08:00", "08:00 - 09:00", "16:00 - 17:00", "17:00 - 18:00"]
    };

    return res.json({
      success: true,
      venueId: venue.id || venueId,
      sport: sportParam,
      date: dateStr,
      isWeekend,
      dayLabel: isWeekend ? 'Weekend Schedule' : 'Weekday Schedule',
      operatingHours: schedule.label,
      allSlots,
      bookedSlots: [...new Set(bookedSlots)],
      blockedSlots: [...new Set(blockedSlots)],
      pricing: {
        baseRate: isWeekend ? pricing.weekendHourlyRate : pricing.weekdayHourlyRate,
        peakMultiplier: pricing.peakHourMultiplier,
        peakSlots: pricing.peakSlots || []
      }
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// 0C. Get Pricing Configuration
app.get('/api/venues/:venueId/pricing', async (req, res) => {
  try {
    const db = await loadDb();
    return res.json({ success: true, pricing: db.venue_pricing || {} });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// 0D. Calculate Slot Price (Server-Authoritative)
app.post('/api/venues/calculate-price', (req, res) => {
  try {
    const { sport, date, timeSlots, duration } = req.body;
    if (!sport || !date || !timeSlots || (Array.isArray(timeSlots) && timeSlots.length === 0)) {
      return res.status(400).json({ success: false, error: 'Sport, date, and at least one time slot are required.' });
    }

    const calc = calculateSlotPrice(sport, date, timeSlots, duration);
    return res.json({ success: true, calculation: calc });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// 0E. Create Venue Booking Razorpay Order (with double-booking check & server price calculation)
app.post('/api/venue-booking/create-order', async (req, res) => {
  try {
    const {
      venueId = 'apex-sports-academy',
      sport,
      date,
      timeSlots,
      duration,
      customerName,
      phone,
      email,
      teamName,
      playerCount,
      notes
    } = req.body;

    // 1. Mandatory Fields Validation
    if (!customerName || !phone || !email) {
      return res.status(400).json({ success: false, error: 'Full Name, Mobile Number, and Email are required.' });
    }
    if (!sport || !date || !timeSlots || (Array.isArray(timeSlots) && timeSlots.length === 0)) {
      return res.status(400).json({ success: false, error: 'Sport, Date, and Time Slot are required.' });
    }

    const requestedSlots = Array.isArray(timeSlots) ? timeSlots : [timeSlots];
    const sportKey = (sport || '').toLowerCase().replace(/\s+/g, '-');

    // 2. Server-side Double Booking & Slot Conflict Prevention
    const db = await loadDb();
    const activeBookings = (db.bookings || []).filter(b => {
      const bSport = (b.sportId || b.sport || '').toLowerCase().replace(/\s+/g, '-');
      const bStatus = (b.status || '').toLowerCase();
      const isBooked = bStatus === 'paid' || bStatus === 'booking confirmed' || bStatus === 'payment processing';
      return b.date === date && bSport === sportKey && isBooked;
    });

    const alreadyBookedSlots = [];
    activeBookings.forEach(b => {
      if (Array.isArray(b.timeSlots)) b.timeSlots.forEach(s => alreadyBookedSlots.push(s.trim()));
      else if (b.timeSlots) alreadyBookedSlots.push(String(b.timeSlots).trim());
    });

    const activeBlocked = (db.blocked_slots || []).filter(blk => {
      const blkSport = (blk.sportId || blk.sport || '').toLowerCase().replace(/\s+/g, '-');
      return blk.date === date && (blkSport === sportKey || blkSport === 'all');
    });
    activeBlocked.forEach(blk => {
      if (Array.isArray(blk.timeSlots)) blk.timeSlots.forEach(s => alreadyBookedSlots.push(s.trim()));
      else if (blk.timeSlot) alreadyBookedSlots.push(String(blk.timeSlot).trim());
    });

    const conflictingSlot = requestedSlots.find(reqSlot => alreadyBookedSlots.includes(reqSlot.trim()));
    if (conflictingSlot) {
      return res.status(409).json({
        success: false,
        error: `Slot "${conflictingSlot}" is no longer available. Please select an alternate time slot.`
      });
    }

    // 3. Server-authoritative Price Calculation (Never trust frontend amount)
    const calculation = calculateSlotPrice(sport, date, requestedSlots, duration);
    const amount = calculation.totalAmount;
    const amountPaise = amount * 100;
    const receiptId = `rcpt_vb_${crypto.randomBytes(4).toString('hex')}`;

    const { client, keyId } = getRazorpayClient();

    // If mock/placeholder keys, provide seamless sandbox testing
    if (!client) {
      const mockOrderId = `order_vb_${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
      console.log(`Mock Mode: Created venue order ${mockOrderId} for ₹${amount}`);
      return res.json({
        success: true,
        order_id: mockOrderId,
        key_id: 'rzp_test_placeholder_key_id',
        amount: amount,
        calculation,
        mock: true
      });
    }

    const order = await client.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: receiptId,
      notes: {
        venueId,
        sport,
        date,
        timeSlots: requestedSlots.join(','),
        customerName,
        phone
      },
      payment_capture: 1
    });

    return res.json({
      success: true,
      order_id: order.id,
      key_id: keyId,
      amount: amount,
      calculation,
      mock: false
    });
  } catch (e) {
    console.error('Error in /api/venue-booking/create-order:', e.message);
    return res.status(400).json({ success: false, error: e.message });
  }
});

// 0F. Verify Venue Booking Razorpay Payment & Confirm Booking
app.post('/api/venue-booking/verify-payment', async (req, res) => {
  try {
    const {
      razorpay_payment_id: paymentId,
      razorpay_order_id: orderId,
      razorpay_signature: signature,
      booking_data: bookingData = {},
      is_mock: isMock = false
    } = req.body;

    let verified = false;
    const { client, keySecret } = getRazorpayClient();

    if (!client) {
      verified = true;
      console.log('Mock Mode: Venue booking payment verified locally.');
    } else {
      try {
        const text = `${orderId}|${paymentId}`;
        const generatedSignature = crypto
          .createHmac('sha256', keySecret)
          .update(text)
          .digest('hex');

        if (generatedSignature === signature) {
          verified = true;
        } else {
          console.warn('Razorpay signature mismatch for venue booking.');
          verified = false;
        }
      } catch (e) {
        console.error('Razorpay signature verification error:', e.message);
        verified = false;
      }
    }

    if (!verified) {
      return res.status(400).json({
        success: false,
        error: 'Signature verification failed. Venue booking payment could not be authenticated.'
      });
    }

    // Secondary atomic check against race-condition double bookings
    const db = await loadDb();
    const requestedSlots = Array.isArray(bookingData.timeSlots) ? bookingData.timeSlots : [bookingData.timeSlots];
    const sportKey = (bookingData.sport || '').toLowerCase().replace(/\s+/g, '-');

    const activeBookings = (db.bookings || []).filter(b => {
      const bSport = (b.sportId || b.sport || '').toLowerCase().replace(/\s+/g, '-');
      const bStatus = (b.status || '').toLowerCase();
      const isBooked = bStatus === 'paid' || bStatus === 'booking confirmed';
      return b.date === bookingData.date && bSport === sportKey && isBooked;
    });

    const alreadyBookedSlots = [];
    activeBookings.forEach(b => {
      if (Array.isArray(b.timeSlots)) b.timeSlots.forEach(s => alreadyBookedSlots.push(s.trim()));
      else if (b.timeSlots) alreadyBookedSlots.push(String(b.timeSlots).trim());
    });

    const hasConflict = requestedSlots.some(s => alreadyBookedSlots.includes(s.trim()));
    if (hasConflict) {
      console.warn(`Double-booking collision detected during verification for date: ${bookingData.date}, slots: ${requestedSlots.join(',')}`);
      // Record refund pending status
      const refundRecord = {
        id: `ASA-BKG-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
        venueId: bookingData.venueId || 'apex-sports-academy',
        venueName: 'Apex Sports Academy',
        sport: bookingData.sport,
        sportId: sportKey,
        date: bookingData.date,
        timeSlots: requestedSlots,
        customerName: bookingData.customerName,
        phone: bookingData.phone,
        email: bookingData.email,
        amount: bookingData.amount || 0,
        status: 'Refund Pending',
        bookingStatus: 'Conflict - Refund Initiated',
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        createdAt: new Date().toISOString()
      };
      await saveBookingToDb(refundRecord);
      return res.status(409).json({
        success: false,
        error: 'Slot collision detected. The slot was booked just before your transaction completed. A full refund has been initiated to your original payment method.'
      });
    }

    // Recompute actual server amount
    const calculation = calculateSlotPrice(bookingData.sport, bookingData.date, requestedSlots);
    const bookingId = `ASA-BKG-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    const dateToday = new Date().toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });

    const bookingRecord = {
      id: bookingId,
      venueId: bookingData.venueId || 'apex-sports-academy',
      venueName: 'Apex Sports Academy',
      sport: bookingData.sport,
      sportId: sportKey,
      court: bookingData.court || (sportKey === 'volleyball' ? 'Volleyball Court 1' : (sportKey === 'box-cricket' ? 'Box Cricket Arena 1' : 'AstroTurf Ground 1')),
      date: bookingData.date,
      timeSlots: requestedSlots,
      durationHours: Number(bookingData.duration || requestedSlots.length || 1),
      customerName: bookingData.customerName,
      phone: bookingData.phone,
      email: bookingData.email,
      teamName: bookingData.teamName || '',
      playerCount: Number(bookingData.playerCount || 1),
      notes: bookingData.notes || '',
      amount: calculation.totalAmount,
      baseRate: calculation.baseHourlyRate,
      isWeekend: calculation.isWeekend,
      paymentMethod: 'Razorpay UPI/Card/NetBanking',
      razorpayOrderId: orderId,
      razorpayPaymentId: paymentId || `TXN_${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
      status: 'Paid',
      bookingStatus: 'Booking Confirmed',
      bookingDate: dateToday,
      createdAt: new Date().toISOString()
    };

    // Save to Database
    await saveBookingToDb(bookingRecord);

    // Send confirmation email asynchronously
    sendVenueBookingConfirmationEmail(bookingRecord).catch(err => {
      console.error('Async venue booking confirmation email error:', err);
    });

    return res.json({
      success: true,
      booking: bookingRecord
    });
  } catch (e) {
    console.error('Error in /api/venue-booking/verify-payment:', e.message);
    return res.status(400).json({ success: false, error: e.message });
  }
});

// --- Legacy Registration Endpoints ---

// 1. Create Order Endpoint
app.post('/api/create-order', async (req, res) => {
  try {
    const rawAmount = req.body.amount;
    if (rawAmount !== undefined && rawAmount !== null) {
      const parsed = Number(rawAmount);
      if (isNaN(parsed) || parsed <= 0) {
        return res.status(400).json({ success: false, error: 'Payment amount must be a positive number.' });
      }
    }

    const amount = parseInt(req.body.amount || 1200, 10);
    const amountPaise = amount * 100;
    const receiptId = `rcpt_${crypto.randomBytes(4).toString('hex')}`;

    const { client, keyId } = getRazorpayClient();

    // If placeholder or no valid keys, return mock order
    if (!client) {
      const mockOrderId = `order_${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
      console.log(`Mock Mode: Created simulated order ID: ${mockOrderId} for amount ₹${amount}`);
      return res.json({
        success: true,
        order_id: mockOrderId,
        key_id: 'rzp_test_placeholder_key_id',
        amount: amount,
        mock: true
      });
    }

    const order = await client.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: receiptId,
      payment_capture: 1
    });

    return res.json({
      success: true,
      order_id: order.id,
      key_id: keyId,
      amount: amount,
      mock: false
    });
  } catch (e) {
    console.error('Error in /api/create-order:', e.message);
    return res.status(400).json({ success: false, error: e.message });
  }
});

// 2. Verify Payment Endpoint
app.post('/api/verify-payment', async (req, res) => {
  try {
    const {
      razorpay_payment_id: paymentId,
      razorpay_order_id: orderId,
      razorpay_signature: signature,
      registration_data: regData = {},
      is_mock: isMock = false
    } = req.body;

    let verified = false;
    const { client, keySecret } = getRazorpayClient();

    if (!client) {
      verified = true;
      console.log('Mock Mode: payment signature verified locally.');
    } else {
      try {
        const text = `${orderId}|${paymentId}`;
        const generatedSignature = crypto
          .createHmac('sha256', keySecret)
          .update(text)
          .digest('hex');

        if (generatedSignature === signature) {
          verified = true;
        } else {
          console.warn('Razorpay signature mismatch.');
          verified = false;
        }
      } catch (e) {
        console.error('Razorpay signature verification exception:', e.message);
        verified = false;
      }
    }

    if (!verified) {
      return res.status(400).json({
        success: false,
        error: 'Signature verification failed. Payment not authenticated.'
      });
    }

    const regId = `ASA-REG-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const dateToday = new Date().toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });

    const record = {
      id: regId,
      date: dateToday,
      entityName: regData.entityName,
      type: regData.type,
      contactPerson: regData.contactPerson,
      phone: regData.phone,
      email: regData.email,
      details: regData.details,
      amount: regData.amount,
      method: 'Razorpay UPI/Card',
      txnId: paymentId || `TXN_${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
      status: 'Paid'
    };

    // Save to Database
    await saveRegistrationToDb(record);

    // Send confirmation email via Nodemailer asynchronously
    sendRegistrationConfirmationEmail(record).catch(err => {
      console.error('Async registration email error:', err);
    });

    return res.json({
      success: true,
      registration: record
    });
  } catch (e) {
    console.error('Error in /api/verify-payment:', e.message);
    return res.status(400).json({ success: false, error: e.message });
  }
});

// ============================================================
// COACHING SUBSCRIPTIONS ENDPOINTS
// ============================================================

// 1. Create Subscription Razorpay Order Endpoint
app.post('/api/subscribe/create-order', async (req, res) => {
  try {
    const rawAmount = req.body.amount;
    const amount = parseInt(rawAmount || 1600, 10);
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({ success: false, error: 'Valid subscription amount is required.' });
    }

    const amountPaise = amount * 100;
    const receiptId = `sub_rcpt_${crypto.randomBytes(4).toString('hex')}`;

    const { client, keyId } = getRazorpayClient();

    if (!client) {
      const mockOrderId = `order_sub_${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
      return res.json({
        success: true,
        order_id: mockOrderId,
        key_id: 'rzp_test_placeholder_key_id',
        amount: amount,
        mock: true
      });
    }

    const order = await client.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: receiptId,
      payment_capture: 1
    });

    return res.json({
      success: true,
      order_id: order.id,
      key_id: keyId,
      amount: amount,
      mock: false
    });
  } catch (e) {
    console.error('Error in /api/subscribe/create-order:', e.message);
    return res.status(400).json({ success: false, error: e.message });
  }
});

// 2. Verify Subscription Payment Endpoint
app.post('/api/subscribe/verify-payment', async (req, res) => {
  try {
    const {
      razorpay_payment_id: paymentId,
      razorpay_order_id: orderId,
      razorpay_signature: signature,
      subscription_data: subData = {},
      is_mock: isMock = false
    } = req.body;

    let verified = false;
    const { client, keySecret } = getRazorpayClient();

    if (!client || isMock) {
      verified = true;
    } else {
      try {
        const text = `${orderId}|${paymentId}`;
        const generatedSignature = crypto
          .createHmac('sha256', keySecret)
          .update(text)
          .digest('hex');

        if (generatedSignature === signature) {
          verified = true;
        } else {
          console.warn('Razorpay subscription signature mismatch.');
          verified = false;
        }
      } catch (e) {
        console.error('Razorpay signature verification exception:', e.message);
        verified = false;
      }
    }

    if (!verified) {
      const failId = `CR-FAIL-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const nowFail = new Date();
      const failedRecord = {
        id: failId,
        full_name: subData.studentName || subData.full_name || 'Student',
        studentName: subData.studentName || subData.full_name || 'Student',
        date_of_birth: subData.dob || subData.date_of_birth || 'N/A',
        dob: subData.dob || subData.date_of_birth || 'N/A',
        age: parseInt(subData.age || 0, 10),
        gender: subData.gender || 'Not Specified',
        phone: subData.phone || '',
        email: subData.email || '',
        sport: subData.sportName || subData.sport || 'Volleyball',
        sportName: subData.sportName || subData.sport || 'Volleyball',
        coaching_group: subData.coachingGroup || subData.coaching_group || subData.parentName || 'Beginner Camp',
        coachingGroup: subData.coachingGroup || subData.coaching_group || subData.parentName || 'Beginner Camp',
        parentName: subData.parentName || 'N/A',
        coaching_days: subData.coachingDays || subData.coaching_days || 'Scheduled Days',
        coachingDays: subData.coachingDays || subData.coaching_days || 'Scheduled Days',
        coaching_time: subData.coachingTime || subData.coaching_time || '4:00 PM – 6:00 PM',
        coachingTime: subData.coachingTime || subData.coaching_time || '4:00 PM – 6:00 PM',
        monthly_fee: parseInt(subData.monthlyFee || subData.amount || 1600, 10),
        monthlyFee: parseInt(subData.monthlyFee || subData.amount || 1600, 10),
        agreement_accepted: true,
        registration_date: nowFail.toISOString(),
        registrationDate: nowFail.toISOString(),
        created_at: nowFail.toISOString(),
        createdAt: nowFail.toISOString(),
        updated_at: nowFail.toISOString(),
        payment_status: 'Failed',
        paymentStatus: 'Failed',
        razorpay_payment_id: paymentId || '',
        razorpayPaymentId: paymentId || '',
        razorpay_order_id: orderId || '',
        razorpayOrderId: orderId || '',
        payment_date: '',
        paymentDate: '',
        subscription_start_date: '',
        startDate: '',
        subscription_end_date: '',
        endDate: '',
        subscription_status: 'Inactive',
        subscriptionStatus: 'Inactive'
      };
      await saveCoachingRegistrationToDb(failedRecord);

      return res.status(400).json({
        success: false,
        error: 'Signature verification failed. Payment not authenticated.'
      });
    }

    const subId = `CR-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const now = new Date();
    const startDate = now.toISOString().split('T')[0];
    const endDateObj = new Date(now);
    endDateObj.setDate(endDateObj.getDate() + 30);
    const endDate = endDateObj.toISOString().split('T')[0];

    const record = {
      id: subId,
      full_name: subData.studentName || subData.full_name || 'Student',
      studentName: subData.studentName || subData.full_name || 'Student',
      date_of_birth: subData.dob || subData.date_of_birth || 'N/A',
      dob: subData.dob || subData.date_of_birth || 'N/A',
      age: parseInt(subData.age || 0, 10),
      gender: subData.gender || 'Not Specified',
      phone: subData.phone || '',
      email: subData.email || '',
      sport: subData.sportName || subData.sport || 'Volleyball',
      sportName: subData.sportName || subData.sport || 'Volleyball',
      coaching_group: subData.coachingGroup || subData.coaching_group || subData.parentName || 'Beginner Camp',
      coachingGroup: subData.coachingGroup || subData.coaching_group || subData.parentName || 'Beginner Camp',
      parentName: subData.parentName || 'N/A',
      coaching_days: subData.coachingDays || subData.coaching_days || 'Scheduled Days',
      coachingDays: subData.coachingDays || subData.coaching_days || 'Scheduled Days',
      coaching_time: subData.coachingTime || subData.coaching_time || '4:00 PM – 6:00 PM',
      coachingTime: subData.coachingTime || subData.coaching_time || '4:00 PM – 6:00 PM',
      monthly_fee: parseInt(subData.monthlyFee || subData.amount || 1600, 10),
      monthlyFee: parseInt(subData.monthlyFee || subData.amount || 1600, 10),
      agreement_accepted: true,
      registration_date: now.toISOString(),
      registrationDate: now.toISOString(),
      created_at: now.toISOString(),
      createdAt: now.toISOString(),
      updated_at: now.toISOString(),
      payment_status: 'Paid',
      paymentStatus: 'Paid',
      razorpay_payment_id: paymentId || `TXN_SUB_${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
      razorpayPaymentId: paymentId || `TXN_SUB_${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
      razorpay_order_id: orderId || '',
      razorpayOrderId: orderId || '',
      payment_date: now.toISOString(),
      paymentDate: now.toISOString(),
      subscription_start_date: startDate,
      startDate: startDate,
      subscription_end_date: endDate,
      endDate: endDate,
      subscription_status: 'Active',
      subscriptionStatus: 'Active'
    };

    await saveCoachingRegistrationToDb(record);

    return res.json({
      success: true,
      subscription: record
    });
  } catch (e) {
    console.error('Error in /api/subscribe/verify-payment:', e.message);
    return res.status(400).json({ success: false, error: e.message });
  }
});

// 3. Save Enquiry Endpoint
app.post('/api/save-enquiry', async (req, res) => {
  try {
    const data = req.body;
    await saveEnquiryToDb(data);

    // Send alert email asynchronously
    sendEnquiryNotificationEmail(data).catch(err => {
      console.error('Async enquiry email error:', err);
    });

    return res.json({ success: true });
  } catch (e) {
    console.error('Error in /api/save-enquiry:', e.message);
    return res.status(400).json({ success: false, error: e.message });
  }
});

// 4. Toggle Enquiry Endpoint (Protected)
app.post('/api/toggle-enquiry', async (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  try {
    const enqId = req.body.id;
    await toggleEnquiryInDb(enqId);
    return res.json({ success: true });
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message });
  }
});

// 5. Delete Enquiry Endpoint (Protected)
app.post('/api/delete-enquiry', async (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  try {
    const enqId = req.body.id;
    await deleteEnquiryFromDb(enqId);
    return res.json({ success: true });
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message });
  }
});

// 6. Get Dashboard Data (Protected)
app.get('/api/dashboard-data', async (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  try {
    const data = await loadDb();
    return res.json(data);
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// 7. Clear Database (Protected)
app.post('/api/clear-db', async (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  try {
    await clearAllDataFromDb();
    return res.json({ success: true });
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message });
  }
});

// 8. Save Razorpay Keys (Protected)
app.post('/api/save-razorpay-keys', (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  try {
    const { key_id, key_secret } = req.body;
    const configData = readConfigFile();
    configData.RAZORPAY_KEY_ID = (key_id || '').trim();
    configData.RAZORPAY_KEY_SECRET = (key_secret || '').trim();
    writeConfigFile(configData);
    return res.json({ success: true });
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message });
  }
});

// 9. Get Razorpay Keys (Protected)
app.get('/api/get-razorpay-keys', (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  try {
    const { keyId, keySecret } = loadRazorpayKeys();
    const isMock = keyId.includes('placeholder') || !keyId;
    let maskedSecret = '';
    if (keySecret && !keySecret.includes('placeholder')) {
      maskedSecret = keySecret.slice(0, 4) + '••••••••••••';
    } else {
      maskedSecret = keySecret;
    }

    return res.json({
      success: true,
      key_id: isMock ? '' : keyId,
      key_secret: isMock ? '' : maskedSecret,
      is_mock: isMock
    });
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message });
  }
});

// 10. Save Supabase Keys (Protected)
app.post('/api/save-supabase-keys', (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  try {
    const { supabase_url, supabase_key } = req.body;
    const configData = readConfigFile();
    configData.SUPABASE_URL = (supabase_url || '').trim();
    configData.SUPABASE_KEY = (supabase_key || '').trim();
    writeConfigFile(configData);
    return res.json({ success: true });
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message });
  }
});

// 11. Get Supabase Keys (Protected)
app.get('/api/get-supabase-keys', (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  try {
    let supabaseUrl = (process.env.SUPABASE_URL || '').trim();
    let supabaseKey = (process.env.SUPABASE_KEY || '').trim();

    const configData = readConfigFile();
    if (configData.SUPABASE_URL) supabaseUrl = configData.SUPABASE_URL.trim();
    if (configData.SUPABASE_KEY) supabaseKey = configData.SUPABASE_KEY.trim();

    const isLocal = !supabaseUrl || !supabaseKey || supabaseUrl.includes('placeholder');
    let maskedKey = '';
    if (supabaseKey && !supabaseKey.includes('placeholder')) {
      maskedKey = supabaseKey.slice(0, 4) + '••••••••••••';
    } else {
      maskedKey = supabaseKey;
    }

    return res.json({
      success: true,
      supabase_url: isLocal ? '' : supabaseUrl,
      supabase_key: isLocal ? '' : maskedKey,
      is_local: isLocal
    });
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message });
  }
});

// 12. Email Settings (Protected)
app.get('/api/get-email-settings', (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  try {
    const { user, adminEmail } = getEmailCredentials();
    const isConfigured = Boolean(user && !user.includes('example.com'));
    return res.json({
      success: true,
      gmail_user: user,
      admin_notification_email: adminEmail,
      is_configured: isConfigured
    });
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message });
  }
});

app.post('/api/save-email-settings', (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  try {
    const { gmail_user, gmail_app_password, admin_notification_email } = req.body;
    const configData = readConfigFile();
    if (gmail_user !== undefined) configData.GMAIL_USER = gmail_user.trim();
    if (gmail_app_password !== undefined && gmail_app_password.trim() !== '') {
      configData.GMAIL_APP_PASSWORD = gmail_app_password.trim();
    }
    if (admin_notification_email !== undefined) {
      configData.ADMIN_NOTIFICATION_EMAIL = admin_notification_email.trim();
    }
    writeConfigFile(configData);
    return res.json({ success: true });
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message });
  }
});

// 13. Test Email Dispatch (Protected)
app.post('/api/test-email', async (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  try {
    const targetEmail = req.body.to || getEmailCredentials().adminEmail;
    const transporter = createMailTransporter();
    if (!transporter) {
      return res.status(400).json({
        success: false,
        error: 'Gmail SMTP is not configured. Please set GMAIL_USER and GMAIL_APP_PASSWORD in .env or settings.'
      });
    }

    const { user } = getEmailCredentials();
    const info = await transporter.sendMail({
      from: `"Apex Sports Academy" <${user}>`,
      to: targetEmail,
      subject: 'Test Email from Apex Sports Academy (Gmail SMTP)',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; background: #0f172a; color: #f8fafc; border-radius: 10px;">
          <h2 style="color: #00b4d8;">Gmail SMTP Connection Successful! 🎉</h2>
          <p>Your Node.js Express server with Nodemailer is successfully configured to send emails using Gmail SMTP.</p>
          <p style="color: #94a3b8; font-size: 13px;">Timestamp: ${new Date().toLocaleString()}</p>
        </div>
      `
    });

    return res.json({ success: true, messageId: info.messageId });
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message });
  }
});

// ============================================================
// NEWSLETTER SUBSCRIPTION & DOUBLE-OPT-IN VERIFICATION ENDPOINTS
// Supabase Table: "E-mail Newsletter"
// ============================================================

const newsletterLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ success: false, message: 'Too many subscription attempts. Please wait a few minutes.' });
  }
});

const EMAIL_VALIDATION_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

// 1. Subscribe to Newsletter (Generates verification token & sends verification email)
app.post('/api/subscribe-newsletter', newsletterLimiter, async (req, res) => {
  try {
    const { email } = req.body || {};

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
    }

    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail || !EMAIL_VALIDATION_REGEX.test(cleanEmail) || cleanEmail.length > 254) {
      return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
    }

    // Cryptographically secure verification token (32 random bytes = 64 hex characters)
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    const baseUrl = getAppBaseUrl(req);

    // 1. Try Supabase Operations on "E-mail Newsletter"
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        // Check if subscriber email already exists
        const { data: existingList, error: fetchErr } = await supabase
          .from('E-mail Newsletter')
          .select('*')
          .eq('email', cleanEmail)
          .limit(1);

        const existing = existingList && existingList.length > 0 ? existingList[0] : null;

        if (existing) {
          // CASE A: Email exists AND verified = true
          if (existing.verified === true) {
            return res.status(200).json({
              success: true,
              alreadySubscribed: true,
              message: 'This email is already subscribed.'
            });
          }

          // CASE B: Email exists AND verified = false -> Generate new token & resend verification email
          const updateData = {
            verified: false,
            verification_token_hash: tokenHash,
            verification_token_expires_at: expiresAt.toISOString()
          };

          const { error: updateErr } = await supabase
            .from('E-mail Newsletter')
            .update(updateData)
            .eq('email', cleanEmail);

          if (updateErr) {
            console.warn('Supabase token update warning (caching token locally):', updateErr.message);
            saveLocalNewsletterToken(cleanEmail, tokenHash, expiresAt);
          } else {
            saveLocalNewsletterToken(cleanEmail, tokenHash, expiresAt);
          }

          // Send verification email via Gmail SMTP
          const emailResult = await sendNewsletterVerificationEmail(cleanEmail, rawToken, baseUrl);
          auditLog('NEWSLETTER_RESEND_VERIFICATION', `email=${cleanEmail} sent=${emailResult.success} ip=${req.ip}`);

          return res.status(200).json({
            success: true,
            message: 'Please check your email for a new verification link.'
          });
        }

        // CASE C: Email does not exist -> Create subscription with verified = false & send verification email
        const insertPayload = {
          email: cleanEmail,
          verified: false,
          verification_token_hash: tokenHash,
          verification_token_expires_at: expiresAt.toISOString()
        };

        const { error: insertErr } = await supabase
          .from('E-mail Newsletter')
          .insert([insertPayload]);

        if (insertErr) {
          // Fallback if schema does not yet have verification_token_hash column
          console.warn('Supabase insert with token columns failed, inserting basic row:', insertErr.message);
          const baseInsert = await supabase
            .from('E-mail Newsletter')
            .insert([{ email: cleanEmail, verified: false }]);

          if (baseInsert.error && baseInsert.error.code !== '23505') {
            console.error('Supabase fallback insert error:', baseInsert.error.message);
            return res.status(500).json({ success: false, message: 'Unable to process your subscription right now. Please try again.' });
          }
          saveLocalNewsletterToken(cleanEmail, tokenHash, expiresAt);
        } else {
          saveLocalNewsletterToken(cleanEmail, tokenHash, expiresAt);
        }

        // Send verification email via Gmail SMTP
        const emailResult = await sendNewsletterVerificationEmail(cleanEmail, rawToken, baseUrl);
        auditLog('NEWSLETTER_SUBSCRIBE_PENDING', `email=${cleanEmail} sent=${emailResult.success} ip=${req.ip}`);

        return res.status(200).json({
          success: true,
          message: 'Please check your email to verify your subscription.'
        });

      } catch (err) {
        console.error('Supabase newsletter subscription exception:', err.message);
      }
    }

    // 2. Fallback to local DB if Supabase client is offline or unavailable
    const db = await loadDb();
    if (!db.newsletter_subscribers) db.newsletter_subscribers = [];

    const existingLocal = db.newsletter_subscribers.find(s => (s.email || '').toLowerCase() === cleanEmail);
    if (existingLocal) {
      if (existingLocal.verified === true) {
        return res.status(200).json({
          success: true,
          alreadySubscribed: true,
          message: 'This email is already subscribed.'
        });
      }

      existingLocal.verification_token_hash = tokenHash;
      existingLocal.verification_token_expires_at = expiresAt.toISOString();
      saveDbLocal(db);
      saveLocalNewsletterToken(cleanEmail, tokenHash, expiresAt);

      await sendNewsletterVerificationEmail(cleanEmail, rawToken, baseUrl);
      auditLog('NEWSLETTER_RESEND_LOCAL', `email=${cleanEmail} ip=${req.ip}`);

      return res.status(200).json({
        success: true,
        message: 'Please check your email for a new verification link.'
      });
    }

    db.newsletter_subscribers.push({
      id: Date.now(),
      email: cleanEmail,
      verified: false,
      verification_token_hash: tokenHash,
      verification_token_expires_at: expiresAt.toISOString(),
      created_at: new Date().toISOString()
    });
    saveDbLocal(db);
    saveLocalNewsletterToken(cleanEmail, tokenHash, expiresAt);

    await sendNewsletterVerificationEmail(cleanEmail, rawToken, baseUrl);
    auditLog('NEWSLETTER_SUBSCRIBE_LOCAL', `email=${cleanEmail} ip=${req.ip}`);

    return res.status(200).json({
      success: true,
      message: 'Please check your email to verify your subscription.'
    });

  } catch (e) {
    console.error('Newsletter subscription route error:', e.message);
    return res.status(500).json({ success: false, message: 'Unable to process your subscription right now. Please try again.' });
  }
});

// Helper: Verification Page Renderer
function renderVerificationPage({ status, title, message, email, canResubscribe }) {
  const isSuccess = status === 'success';
  const isAlready = status === 'already_verified';
  const isExpired = status === 'expired';

  const themeColor = isSuccess ? '#10b981' : isAlready ? '#00b4d8' : isExpired ? '#f59e0b' : '#ef4444';
  const badgeText = isSuccess ? 'Verified' : isAlready ? 'Notice' : isExpired ? 'Link Expired' : 'Invalid Link';

  let iconSvg = '';
  if (isSuccess) {
    iconSvg = `<svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
  } else if (isAlready) {
    iconSvg = `<svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#00b4d8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
  } else if (isExpired) {
    iconSvg = `<svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
  } else {
    iconSvg = `<svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
  }

  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} — Apex Sports Academy</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
    <style>
      :root {
        --bg-dark: #070b14;
        --card-bg: #111a2e;
        --border-color: #1e2e4a;
        --text-primary: #f8fafc;
        --text-secondary: #94a3b8;
        --accent-cyan: #00b4d8;
      }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: 'Inter', -apple-system, sans-serif;
        background-color: var(--bg-dark);
        color: var(--text-primary);
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px 16px;
        background-image: radial-gradient(circle at 50% 15%, rgba(0, 180, 216, 0.14) 0%, transparent 60%);
      }
      .card {
        background: var(--card-bg);
        border: 1px solid var(--border-color);
        border-radius: 20px;
        max-width: 480px;
        width: 100%;
        padding: 40px 32px;
        text-align: center;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
        position: relative;
        overflow: hidden;
      }
      .card::before {
        content: '';
        position: absolute;
        top: 0; left: 0; right: 0;
        height: 4px;
        background: linear-gradient(90deg, #00b4d8, ${themeColor});
      }
      .brand {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 28px;
        text-decoration: none;
      }
      .brand-title {
        font-family: 'Outfit', sans-serif;
        font-size: 1.4rem;
        font-weight: 800;
        letter-spacing: 1px;
        text-transform: uppercase;
        color: #ffffff;
      }
      .brand-title span { color: var(--accent-cyan); }
      .icon-box {
        width: 80px;
        height: 80px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.08);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        margin-bottom: 20px;
        box-shadow: 0 0 30px ${themeColor}33;
      }
      .badge {
        display: inline-block;
        font-size: 0.75rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 1px;
        padding: 4px 12px;
        border-radius: 20px;
        color: ${themeColor};
        background: ${themeColor}18;
        border: 1px solid ${themeColor}44;
        margin-bottom: 14px;
      }
      h1 {
        font-family: 'Outfit', sans-serif;
        font-size: 1.6rem;
        font-weight: 700;
        color: #ffffff;
        margin-bottom: 12px;
        line-height: 1.25;
      }
      p {
        font-size: 0.95rem;
        color: var(--text-secondary);
        line-height: 1.6;
        margin-bottom: 24px;
      }
      .email-pill {
        display: inline-block;
        background: #0b1220;
        border: 1px solid #1e293b;
        padding: 6px 14px;
        border-radius: 8px;
        font-size: 0.85rem;
        font-weight: 600;
        color: #38bdf8;
        margin-bottom: 24px;
        word-break: break-all;
      }
      .btn {
        display: inline-block;
        width: 100%;
        padding: 14px 24px;
        background: linear-gradient(135deg, #00b4d8 0%, #0284c7 100%);
        color: #ffffff;
        text-decoration: none;
        border-radius: 10px;
        font-family: 'Outfit', sans-serif;
        font-weight: 700;
        font-size: 0.95rem;
        letter-spacing: 0.5px;
        text-transform: uppercase;
        transition: all 0.2s ease;
        box-shadow: 0 4px 14px rgba(0, 180, 216, 0.4);
      }
      .btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(0, 180, 216, 0.6);
      }
      .timer {
        margin-top: 16px;
        font-size: 0.8rem;
        color: #64748b;
      }
      .footer-slogan {
        margin-top: 24px;
        font-size: 0.75rem;
        color: #475569;
        text-transform: uppercase;
        letter-spacing: 1px;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <a href="/" class="brand">
        <div class="brand-title">Apex <span>Sports</span></div>
      </a>
      
      <div class="icon-box">
        ${iconSvg}
      </div>

      <div>
        <span class="badge">${badgeText}</span>
      </div>

      <h1>${title}</h1>
      <p>${message}</p>

      ${email ? `<div class="email-pill">${email}</div>` : ''}

      <a href="${canResubscribe ? '/#newsletter-form' : '/'}" class="btn" id="action-btn">
        ${canResubscribe ? 'Subscribe Again' : 'Return to Apex Sports'}
      </a>

      ${isSuccess ? `
        <div class="timer" id="timer-text">Redirecting to homepage in <span id="countdown">6</span>s...</div>
        <script>
          let seconds = 6;
          const countEl = document.getElementById('countdown');
          const timer = setInterval(() => {
            seconds--;
            if (countEl) countEl.textContent = seconds;
            if (seconds <= 0) {
              clearInterval(timer);
              window.location.href = '/';
            }
          }, 1000);
        </script>
      ` : ''}

      <div class="footer-slogan">Push Your Limit To Know Your Limits</div>
    </div>
  </body>
  </html>
  `;
}

// 2. Core Newsletter Verification Processor
async function processNewsletterVerification(rawToken) {
  if (!rawToken || typeof rawToken !== 'string' || rawToken.trim().length < 16) {
    return {
      status: 'invalid',
      title: 'Invalid Verification Link',
      message: 'The verification link provided is invalid or missing.'
    };
  }

  const tokenHash = crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
  const supabase = getSupabaseClient();

  // Check 0: Already Verified Tokens History (e.g. user clicked the same verification link twice)
  const verifiedHistory = loadVerifiedTokenHistory();
  if (verifiedHistory[tokenHash]) {
    return {
      status: 'already_verified',
      title: 'Already Verified',
      message: 'Your email has already been verified.',
      email: verifiedHistory[tokenHash].email
    };
  }

  let subscriber = null;
  let targetEmail = null;
  let expiresAtStr = null;
  let isAlreadyVerified = false;

  // Check 1: Supabase Lookup by Token Hash
  if (supabase) {
    try {
      const { data: rows, error: qErr } = await supabase
        .from('E-mail Newsletter')
        .select('*')
        .eq('verification_token_hash', tokenHash)
        .limit(1);

      if (!qErr && rows && rows.length > 0) {
        subscriber = rows[0];
        targetEmail = subscriber.email;
        expiresAtStr = subscriber.verification_token_expires_at;
        isAlreadyVerified = subscriber.verified === true;
      }
    } catch (e) {
      console.warn('Supabase query by token hash failed:', e.message);
    }
  }

  // Check 2: Local Token Cache Lookup
  if (!subscriber) {
    const localTokens = loadLocalNewsletterTokens();
    const tokenEntry = localTokens[tokenHash];
    if (tokenEntry) {
      targetEmail = tokenEntry.email;
      expiresAtStr = tokenEntry.expiresAt;
      subscriber = {
        email: targetEmail,
        verified: false,
        verification_token_expires_at: expiresAtStr
      };
    }
  }

  // Check 3: Local database.json Lookup
  if (!subscriber) {
    const db = await loadDb();
    const match = (db.newsletter_subscribers || []).find(s => s.verification_token_hash === tokenHash);
    if (match) {
      subscriber = match;
      targetEmail = match.email;
      expiresAtStr = match.verification_token_expires_at;
      isAlreadyVerified = match.verified === true;
    }
  }

  // Check 4: If still not found, check if this email exists in Supabase and was already verified
  if (!subscriber && targetEmail) {
    if (supabase) {
      try {
        const { data: byEmail } = await supabase
          .from('E-mail Newsletter')
          .select('verified')
          .eq('email', targetEmail)
          .maybeSingle();
        if (byEmail && byEmail.verified === true) {
          isAlreadyVerified = true;
        }
      } catch (e) {}
    }
  }

  if (!subscriber) {
    return {
      status: 'invalid',
      title: 'Invalid Verification Link',
      message: 'Invalid verification link.'
    };
  }

  // Check if already verified
  if (isAlreadyVerified || subscriber.verified === true) {
    saveVerifiedTokenHistory(tokenHash, targetEmail);
    return {
      status: 'already_verified',
      title: 'Already Verified',
      message: 'Your email has already been verified.',
      email: targetEmail
    };
  }

  // Check expiration (24h)
  if (expiresAtStr && new Date(expiresAtStr) < new Date()) {
    return {
      status: 'expired',
      title: 'Verification Link Expired',
      message: 'This verification link has expired. Please subscribe again to receive a new verification email.',
      email: targetEmail,
      canResubscribe: true
    };
  }

  // Valid Token -> Mark as Verified
  const verifiedTimestamp = new Date().toISOString();

  // 1. Update/Insert in Supabase
  if (supabase) {
    try {
      const { data: existingInSupabase } = await supabase
        .from('E-mail Newsletter')
        .select('id, verified')
        .eq('email', targetEmail)
        .maybeSingle();

      if (existingInSupabase) {
        const updateData = {
          verified: true,
          verified_at: verifiedTimestamp,
          verification_token_hash: null,
          verification_token_expires_at: null
        };

        const { error: upErr } = await supabase
          .from('E-mail Newsletter')
          .update(updateData)
          .eq('email', targetEmail);

        if (upErr) {
          console.warn('Supabase mark verified error with token fields, trying verified only:', upErr.message);
          await supabase
            .from('E-mail Newsletter')
            .update({ verified: true })
            .eq('email', targetEmail);
        }
      } else {
        const insRes = await supabase
          .from('E-mail Newsletter')
          .insert([{
            email: targetEmail,
            verified: true,
            verified_at: verifiedTimestamp
          }]);

        if (insRes.error) {
          await supabase
            .from('E-mail Newsletter')
            .insert([{
              email: targetEmail,
              verified: true
            }]);
        }
      }
    } catch (e) {
      console.warn('Supabase update verification exception:', e.message);
    }
  }

  // 2. Update Local DB
  const db = await loadDb();
  if (!db.newsletter_subscribers) db.newsletter_subscribers = [];
  const localMatch = db.newsletter_subscribers.find(s => (s.email || '').toLowerCase() === targetEmail.toLowerCase());
  if (localMatch) {
    localMatch.verified = true;
    localMatch.verified_at = verifiedTimestamp;
    localMatch.verification_token_hash = null;
    localMatch.verification_token_expires_at = null;
  } else {
    db.newsletter_subscribers.push({
      id: Date.now(),
      email: targetEmail,
      verified: true,
      verified_at: verifiedTimestamp,
      created_at: verifiedTimestamp
    });
  }
  saveDbLocal(db);

  // 3. Save to verified tokens history & remove active pending token
  saveVerifiedTokenHistory(tokenHash, targetEmail);
  removeLocalNewsletterToken(tokenHash);

  // 4. Send Admin Notification Email Asynchronously
  sendAdminVerifiedNewsletterNotification(targetEmail, verifiedTimestamp)
    .catch(err => console.error('[Admin Notification Error]:', err.message));

  auditLog('NEWSLETTER_VERIFIED', `email=${targetEmail} timestamp=${verifiedTimestamp}`);

  return {
    status: 'success',
    title: 'Email Verified Successfully!',
    message: 'Thank you for confirming your Apex Sports newsletter subscription.',
    email: targetEmail
  };
}

// 3. HTML Verification Page Route: GET /verify-newsletter?token=...
app.get('/verify-newsletter', async (req, res) => {
  try {
    const rawToken = req.query.token;
    const result = await processNewsletterVerification(rawToken);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(renderVerificationPage(result));
  } catch (e) {
    console.error('Error rendering verification page:', e.message);
    return res.status(500).send(renderVerificationPage({
      status: 'error',
      title: 'Verification Error',
      message: 'Unable to process verification right now. Please try again later.'
    }));
  }
});

// 4. JSON Verification API Endpoint: GET /api/verify-newsletter?token=...
app.get('/api/verify-newsletter', async (req, res) => {
  try {
    const rawToken = req.query.token;
    const result = await processNewsletterVerification(rawToken);
    return res.json({
      success: result.status === 'success',
      ...result
    });
  } catch (e) {
    console.error('Error in /api/verify-newsletter:', e.message);
    return res.status(500).json({ success: false, message: 'Unable to process verification right now.' });
  }
});


// 14. Unified Login Endpoint (Supports Admin & Normal Users)
app.post('/api/login', loginLimiter, async (req, res) => {
  try {
    const { username = '', identifier = '', password = '' } = req.body;
    const loginId = (identifier || username).trim();

    if (!loginId || !password) {
      return res.status(400).json({ success: false, error: 'Please enter your username/email/phone and password.' });
    }

    // 1. Check Administrator Credentials
    const creds = loadCredentials();
    const isAdminUser = loginId.toLowerCase() === creds.username.toLowerCase();
    let isAdminPasswordValid = false;

    if (isAdminUser) {
      if (creds.passwordHash) {
        isAdminPasswordValid = await bcrypt.compare(password.trim(), creds.passwordHash);
      } else {
        isAdminPasswordValid = password.trim() === creds.password;
      }
    }

    if (isAdminUser && isAdminPasswordValid) {
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = Date.now() + SESSION_EXPIRY_MS;
      ACTIVE_TOKENS.set(token, {
        role: 'admin',
        username: creds.username,
        name: 'Administrator',
        email: 'admin@apex-sports.com',
        expiresAt
      });
      auditLog('ADMIN_LOGIN_SUCCESS', `user=${loginId} ip=${req.ip}`);
      return res.json({
        success: true,
        role: 'admin',
        token,
        user: { username: creds.username, name: 'Administrator', role: 'admin' },
        redirectUrl: '/admin/dashboard',
        expiresIn: SESSION_EXPIRY_MS
      });
    }

    // 2. Check Normal User in database.json
    const db = await loadDb();
    const users = db.users || [];
    const cleanId = loginId.replace(/\D/g, '');
    const user = users.find(u =>
      (u.username && u.username.toLowerCase() === loginId.toLowerCase()) ||
      (u.email && u.email.toLowerCase() === loginId.toLowerCase()) ||
      (cleanId.length >= 10 && u.phone && u.phone.replace(/\D/g, '').includes(cleanId))
    );

    if (user) {
      const isUserPasswordValid = user.passwordHash
        ? await bcrypt.compare(password.trim(), user.passwordHash)
        : (user.password === password.trim());

      if (isUserPasswordValid) {
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = Date.now() + SESSION_EXPIRY_MS;
        ACTIVE_TOKENS.set(token, {
          role: 'user',
          id: user.id,
          username: user.username || user.email || user.phone,
          name: user.name || 'Athlete',
          email: user.email || '',
          phone: user.phone || '',
          expiresAt
        });
        auditLog('USER_LOGIN_SUCCESS', `user=${loginId} ip=${req.ip}`);
        return res.json({
          success: true,
          role: 'user',
          token,
          user: { id: user.id, username: user.username, name: user.name, email: user.email, phone: user.phone, role: 'user' },
          redirectUrl: '/#user-portal',
          expiresIn: SESSION_EXPIRY_MS
        });
      }
    }

    // 3. Auto-link for existing registered athletes / teams if they provide their registration phone
    const cleanPhone = loginId.replace(/\D/g, '');
    if (cleanPhone.length >= 10 && password.length >= 4) {
      const matchingReg = (db.registrations || []).find(r =>
        (r.phone && r.phone.replace(/\D/g, '').includes(cleanPhone)) ||
        (r.email && r.email.toLowerCase() === loginId.toLowerCase())
      );

      if (matchingReg) {
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = Date.now() + SESSION_EXPIRY_MS;
        ACTIVE_TOKENS.set(token, {
          role: 'user',
          id: matchingReg.id,
          username: matchingReg.contactPerson || matchingReg.entityName,
          name: matchingReg.contactPerson || matchingReg.entityName,
          email: matchingReg.email || '',
          phone: matchingReg.phone || '',
          expiresAt
        });
        auditLog('USER_LOGIN_AUTOLINK_SUCCESS', `user=${loginId} ip=${req.ip}`);
        return res.json({
          success: true,
          role: 'user',
          token,
          user: { username: matchingReg.contactPerson, name: matchingReg.contactPerson, email: matchingReg.email, phone: matchingReg.phone, role: 'user' },
          redirectUrl: '/#user-portal',
          expiresIn: SESSION_EXPIRY_MS
        });
      }
    }

    auditLog('LOGIN_FAILED', `identifier=${loginId} ip=${req.ip}`);
    return res.status(401).json({ success: false, error: 'Invalid username, email, phone or password.' });
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message });
  }
});

// 15. User Self-Registration Endpoint
app.post('/api/register-user', async (req, res) => {
  try {
    const { name = '', email = '', phone = '', password = '' } = req.body;
    if (!name.trim() || !phone.trim() || !password.trim()) {
      return res.status(400).json({ success: false, error: 'Full name, phone number, and password are required.' });
    }

    const db = await loadDb();
    if (!db.users) db.users = [];

    const cleanPhone = phone.replace(/\D/g, '');
    const existing = db.users.find(u =>
      (cleanPhone.length >= 10 && u.phone && u.phone.replace(/\D/g, '').includes(cleanPhone)) ||
      (email && u.email && u.email.toLowerCase() === email.toLowerCase())
    );

    if (existing) {
      return res.status(400).json({ success: false, error: 'An account with this phone number or email already exists. Please log in.' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password.trim(), salt);
    const chosenUsername = (req.body.username || email || phone || name).trim().toLowerCase();
    const newUser = {
      id: 'USER-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
      username: chosenUsername,
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      passwordHash,
      role: 'user',
      createdAt: new Date().toISOString()
    };
    await saveUserToDb(newUser);

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + SESSION_EXPIRY_MS;
    ACTIVE_TOKENS.set(token, {
      role: 'user',
      id: newUser.id,
      username: newUser.email || newUser.phone,
      name: newUser.name,
      email: newUser.email,
      phone: newUser.phone,
      expiresAt
    });

    auditLog('USER_REGISTER_SUCCESS', `id=${newUser.id} name=${newUser.name}`);
    return res.json({
      success: true,
      role: 'user',
      token,
      user: { id: newUser.id, name: newUser.name, email: newUser.email, phone: newUser.phone, role: 'user' },
      redirectUrl: '/#user-portal',
      expiresIn: SESSION_EXPIRY_MS
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// 16. Current User Session Info
app.get('/api/auth/me', (req, res) => {
  const session = getTokenData(req);
  if (!session) {
    return res.json({ success: true, authenticated: false });
  }
  return res.json({
    success: true,
    authenticated: true,
    user: {
      id: session.id,
      username: session.username,
      name: session.name,
      email: session.email,
      phone: session.phone,
      role: session.role
    }
  });
});

// 17. User Portal Data Endpoint
app.get('/api/user/portal', requireAuth, async (req, res) => {
  try {
    const db = await loadDb();
    const userPhone = (req.user.phone || '').replace(/\D/g, '');
    const userEmail = (req.user.email || '').toLowerCase();

    const registrations = (db.registrations || []).filter(r => {
      const rPhone = (r.phone || '').replace(/\D/g, '');
      const rEmail = (r.email || '').toLowerCase();
      return (userPhone.length >= 10 && rPhone.includes(userPhone)) || (userEmail && rEmail === userEmail);
    });

    return res.json({
      success: true,
      user: {
        name: req.user.name,
        email: req.user.email,
        phone: req.user.phone,
        role: req.user.role
      },
      registrations
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// 18. Logout Endpoint
app.post('/api/logout', (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      ACTIVE_TOKENS.delete(token);
    }
    auditLog('LOGOUT', `ip=${req.ip}`);
    return res.json({ success: true });
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message });
  }
});

// ============================================================
// SPORT DEDICATED PAGES ROUTES & ASSETS
// ============================================================
app.get('/volleyball', (req, res) => res.sendFile(path.join(__dirname, 'volleyball.html')));
app.get('/throwball', (req, res) => res.sendFile(path.join(__dirname, 'throwball.html')));
app.get('/football', (req, res) => res.sendFile(path.join(__dirname, 'football.html')));
app.get('/khokho', (req, res) => res.sendFile(path.join(__dirname, 'khokho.html')));

app.get('/sport/style.css', (req, res) => res.sendFile(path.join(__dirname, 'style.css')));
app.get('/sport/logo.jpeg', (req, res) => res.sendFile(path.join(__dirname, 'logo.jpeg')));
app.get('/sport/app.js', (req, res) => res.sendFile(path.join(__dirname, 'app.js')));

app.get('/sport/volleyball', (req, res) => res.sendFile(path.join(__dirname, 'volleyball.html')));
app.get('/sport/throwball', (req, res) => res.sendFile(path.join(__dirname, 'throwball.html')));
app.get('/sport/football', (req, res) => res.sendFile(path.join(__dirname, 'football.html')));
app.get('/sport/khokho', (req, res) => res.sendFile(path.join(__dirname, 'khokho.html')));
app.get('/sport/:sportName', (req, res) => {
  const s = req.params.sportName.toLowerCase();
  if (s === 'volleyball') return res.sendFile(path.join(__dirname, 'volleyball.html'));
  if (s === 'throwball') return res.sendFile(path.join(__dirname, 'throwball.html'));
  if (s === 'football') return res.sendFile(path.join(__dirname, 'football.html'));
  if (s === 'khokho' || s === 'kho-kho') return res.sendFile(path.join(__dirname, 'khokho.html'));
  res.redirect('/#programs');
});

// ============================================================
// ADMIN PAGE ROUTES
// ============================================================
app.get('/admin', (req, res) => res.redirect('/admin/login'));
app.get('/admin/login', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'admin', 'login.html'));
});
app.get('/admin/dashboard', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'admin', 'dashboard.html'));
});

// GET /api/admin/stats
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const db = await loadDb();
    const regs = db.registrations || [];
    const enqs = db.enquiries || [];
    const bookings = db.bookings || [];

    const regRevenue = regs.filter(r => r.status === 'Paid').reduce((s, r) => s + (r.amount || 0), 0);
    const venueRevenue = bookings.filter(b => b.status === 'Paid' || b.status === 'Booking Confirmed').reduce((s, b) => s + (b.amount || 0), 0);
    const totalRevenue = regRevenue + venueRevenue;

    const paidRegsCount = regs.filter(r => r.status === 'Paid').length;
    const paidBookingsCount = bookings.filter(b => b.status === 'Paid' || b.status === 'Booking Confirmed').length;

    const todayStr = new Date().toISOString().split('T')[0];
    const todayBookings = bookings.filter(b => b.date === todayStr && (b.status === 'Paid' || b.status === 'Booking Confirmed'));

    return res.json({
      success: true,
      stats: {
        totalRegistrations: regs.length,
        totalPaid: paidRegsCount,
        totalPending: regs.length - paidRegsCount,
        totalRevenue,
        regRevenue,
        venueRevenue,
        totalVenueBookings: bookings.length,
        paidVenueBookings: paidBookingsCount,
        todayBookingsCount: todayBookings.length,
        tournamentCount: regs.filter(r => (r.type || '').toLowerCase().includes('tournament')).length,
        coachingCount: regs.filter(r => (r.type || '').toLowerCase().includes('coaching')).length,
        enquiryCount: enqs.length
      },
      recentRegistrations: regs.slice(0, 6),
      recentBookings: bookings.slice(0, 6)
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// --- ADMIN VENUE & SLOT MANAGEMENT ENDPOINTS ---

// GET /api/admin/venue-stats
app.get('/api/admin/venue-stats', requireAdmin, async (req, res) => {
  try {
    const db = await loadDb();
    const bookings = db.bookings || [];
    const blocked = db.blocked_slots || [];
    const todayStr = new Date().toISOString().split('T')[0];

    const paidBookings = bookings.filter(b => b.status === 'Paid' || b.status === 'Booking Confirmed');
    const totalRevenue = paidBookings.reduce((sum, b) => sum + (b.amount || 0), 0);
    const todayBookings = bookings.filter(b => b.date === todayStr);
    const upcomingBookings = bookings.filter(b => b.date >= todayStr);

    const sportBreakdown = {
      football: paidBookings.filter(b => (b.sportId || b.sport || '').toLowerCase().includes('football')).length,
      'box-cricket': paidBookings.filter(b => (b.sportId || b.sport || '').toLowerCase().includes('cricket')).length,
      volleyball: paidBookings.filter(b => (b.sportId || b.sport || '').toLowerCase().includes('volleyball')).length
    };

    return res.json({
      success: true,
      stats: {
        totalRevenue,
        totalBookings: bookings.length,
        paidBookings: paidBookings.length,
        todayBookingsCount: todayBookings.length,
        upcomingBookingsCount: upcomingBookings.length,
        blockedSlotsCount: blocked.length,
        sportBreakdown
      },
      todayBookings,
      recentBookings: bookings.slice(0, 10)
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/admin/venue-bookings (Search & Filters)
app.get('/api/admin/venue-bookings', requireAdmin, async (req, res) => {
  try {
    const db = await loadDb();
    let bookings = db.bookings || [];
    const { search, sport, status, date } = req.query;

    if (search) {
      const q = search.toLowerCase();
      bookings = bookings.filter(b =>
        [b.id, b.customerName, b.phone, b.email, b.teamName, b.razorpayPaymentId].some(v => (v || '').toLowerCase().includes(q))
      );
    }
    if (sport && sport !== 'all') {
      const sKey = sport.toLowerCase().replace(/\s+/g, '-');
      bookings = bookings.filter(b => (b.sportId || b.sport || '').toLowerCase().replace(/\s+/g, '-').includes(sKey));
    }
    if (status && status !== 'all') {
      bookings = bookings.filter(b => (b.status || '').toLowerCase() === status.toLowerCase());
    }
    if (date) {
      bookings = bookings.filter(b => b.date === date);
    }

    return res.json({
      success: true,
      bookings,
      total: bookings.length,
      blockedSlots: db.blocked_slots || []
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// PUT /api/admin/venue-bookings/:id (Update Booking Status)
app.put('/api/admin/venue-bookings/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const updated = await updateBookingInDb(id, updates);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Venue booking not found.' });
    }
    auditLog('VENUE_BOOKING_UPDATED', `id=${id} updates=${Object.keys(updates).join(',')}`);
    return res.json({ success: true, booking: updated });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/admin/block-slot (Block a Slot)
app.post('/api/admin/block-slot', requireAdmin, async (req, res) => {
  try {
    const { venueId = 'apex-sports-academy', sportId, sport, date, timeSlot, timeSlots, reason = 'Maintenance / Event' } = req.body;
    const targetSport = (sportId || sport || '').toLowerCase().replace(/\s+/g, '-');
    if (!targetSport || !date || (!timeSlot && (!timeSlots || !timeSlots.length))) {
      return res.status(400).json({ success: false, error: 'Sport, Date, and Slot are required to block.' });
    }

    const blockId = `BLK-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const blockRecord = {
      id: blockId,
      venueId,
      sportId: targetSport,
      date,
      timeSlot: timeSlot || (Array.isArray(timeSlots) ? timeSlots[0] : timeSlots),
      timeSlots: Array.isArray(timeSlots) ? timeSlots : [timeSlot],
      reason,
      blockedBy: req.user ? req.user.username : 'admin',
      createdAt: new Date().toISOString()
    };

    await saveBlockedSlotToDb(blockRecord);
    auditLog('SLOT_BLOCKED', `id=${blockId} sport=${targetSport} date=${date} slot=${blockRecord.timeSlot}`);
    return res.json({ success: true, blockedSlot: blockRecord });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// DELETE /api/admin/block-slot/:id (Unblock a Slot)
app.delete('/api/admin/block-slot/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await deleteBlockedSlotFromDb(id);
    auditLog('SLOT_UNBLOCKED', `id=${id}`);
    return res.json({ success: true, message: 'Slot unblocked successfully.' });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/admin/venue-pricing
app.get('/api/admin/venue-pricing', requireAdmin, async (req, res) => {
  try {
    const db = await loadDb();
    return res.json({
      success: true,
      pricing: db.venue_pricing || {}
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/admin/coaching-registrations (Search & Filter Coaching Registrations)
app.get('/api/admin/coaching-registrations', requireAdmin, async (req, res) => {
  try {
    let list = await getCoachingRegistrationsFromDb();
    const todayStr = new Date().toISOString().split('T')[0];

    list = list.map(item => {
      let subStatus = item.subscription_status || item.subscriptionStatus || 'Active';
      const endDate = item.subscription_end_date || item.endDate;
      const payStatus = item.payment_status || item.paymentStatus || 'Paid';

      if (payStatus !== 'Paid') {
        subStatus = payStatus === 'Failed' ? 'Inactive' : (payStatus === 'Cancelled' ? 'Cancelled' : 'Pending');
      } else if (endDate && endDate < todayStr && subStatus === 'Active') {
        subStatus = 'Expired';
      }

      return {
        ...item,
        id: item.id,
        full_name: item.full_name || item.studentName || 'Student',
        studentName: item.full_name || item.studentName || 'Student',
        date_of_birth: item.date_of_birth || item.dob || 'N/A',
        dob: item.date_of_birth || item.dob || 'N/A',
        age: item.age || 0,
        gender: item.gender || 'Not Specified',
        phone: item.phone || '',
        email: item.email || '',
        sport: item.sport || item.sportName || 'Volleyball',
        sportName: item.sport || item.sportName || 'Volleyball',
        coaching_group: item.coaching_group || item.coachingGroup || item.parentName || 'Beginner Camp',
        coachingGroup: item.coaching_group || item.coachingGroup || item.parentName || 'Beginner Camp',
        coaching_days: item.coaching_days || item.coachingDays || '',
        coachingDays: item.coaching_days || item.coachingDays || '',
        coaching_time: item.coaching_time || item.coachingTime || '',
        coachingTime: item.coaching_time || item.coachingTime || '',
        monthly_fee: item.monthly_fee || item.monthlyFee || 0,
        monthlyFee: item.monthly_fee || item.monthlyFee || 0,
        agreement_accepted: item.agreement_accepted !== undefined ? item.agreement_accepted : true,
        registration_date: item.registration_date || item.registrationDate || item.created_at || item.createdAt || new Date().toISOString(),
        registrationDate: item.registration_date || item.registrationDate || item.created_at || item.createdAt || new Date().toISOString(),
        payment_status: payStatus,
        paymentStatus: payStatus,
        razorpay_payment_id: item.razorpay_payment_id || item.razorpayPaymentId || '',
        razorpayPaymentId: item.razorpay_payment_id || item.razorpayPaymentId || '',
        razorpay_order_id: item.razorpay_order_id || item.razorpayOrderId || '',
        razorpayOrderId: item.razorpay_order_id || item.razorpayOrderId || '',
        payment_date: item.payment_date || item.paymentDate || item.created_at || item.createdAt || '',
        paymentDate: item.payment_date || item.paymentDate || item.created_at || item.createdAt || '',
        subscription_start_date: item.subscription_start_date || item.startDate || '',
        startDate: item.subscription_start_date || item.startDate || '',
        subscription_end_date: item.subscription_end_date || item.endDate || '',
        endDate: item.subscription_end_date || item.endDate || '',
        subscription_status: subStatus,
        subscriptionStatus: subStatus
      };
    });

    const q = (req.query.q || '').trim().toLowerCase();
    const sport = (req.query.sport || '').trim().toLowerCase();
    const paymentStatus = (req.query.paymentStatus || '').trim().toLowerCase();
    const subStatus = (req.query.subStatus || '').trim().toLowerCase();

    if (q) {
      list = list.filter(s =>
        [s.id, s.full_name, s.phone, s.email, s.razorpay_payment_id, s.razorpay_order_id, s.sport]
          .some(v => (v || '').toString().toLowerCase().includes(q))
      );
    }

    if (sport && sport !== 'all') {
      list = list.filter(s => (s.sport || '').toLowerCase().includes(sport));
    }

    if (paymentStatus && paymentStatus !== 'all') {
      list = list.filter(s => (s.payment_status || '').toLowerCase() === paymentStatus);
    }

    if (subStatus && subStatus !== 'all') {
      list = list.filter(s => (s.subscription_status || '').toLowerCase() === subStatus);
    }

    return res.json({
      success: true,
      registrations: list,
      subscriptions: list
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/admin/coaching-registrations/:id
app.get('/api/admin/coaching-registrations/:id', requireAdmin, async (req, res) => {
  try {
    const list = await getCoachingRegistrationsFromDb();
    const item = list.find(r => r.id === req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Registration record not found.' });
    }
    return res.json({ success: true, registration: item });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// PATCH /api/admin/coaching-registrations/:id (Update subscription_status or coaching_group)
app.patch('/api/admin/coaching-registrations/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { subscription_status, subscriptionStatus, coaching_group, coachingGroup } = req.body;

    const updates = {};
    const subStat = subscription_status || subscriptionStatus;
    if (subStat) {
      updates.subscription_status = subStat;
      updates.subscriptionStatus = subStat;
    }
    const cGroup = coaching_group || coachingGroup;
    if (cGroup) {
      updates.coaching_group = cGroup;
      updates.coachingGroup = cGroup;
    }

    const updated = await updateCoachingRegistrationInDb(id, updates);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Coaching registration not found.' });
    }

    auditLog('COACHING_REGISTRATION_UPDATED', `id=${id} updates=${Object.keys(updates).join(',')}`);
    return res.json({ success: true, registration: updated });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/admin/subscriptions (Legacy Alias)
app.get('/api/admin/subscriptions', requireAdmin, async (req, res) => {
  try {
    let list = await getSubscriptionsFromDb();
    const todayStr = new Date().toISOString().split('T')[0];

    list = list.map(item => {
      let subStatus = item.subscriptionStatus || item.subscription_status || 'Active';
      if (item.endDate && item.endDate < todayStr) {
        subStatus = 'Expired';
      }
      return { ...item, subscriptionStatus: subStatus };
    });

    return res.json({
      success: true,
      subscriptions: list
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/admin/update-venue-pricing
app.post('/api/admin/update-venue-pricing', requireAdmin, async (req, res) => {
  try {
    const newPricing = req.body.pricing || req.body;
    if (!newPricing || typeof newPricing !== 'object') {
      return res.status(400).json({ success: false, error: 'Valid pricing configuration required.' });
    }

    const updated = await updateVenuePricingInDb(newPricing);
    auditLog('VENUE_PRICING_UPDATED', `sports=${Object.keys(newPricing).join(',')}`);
    return res.json({ success: true, pricing: updated });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/admin/registrations (with search/filter)
app.get('/api/admin/registrations', requireAdmin, async (req, res) => {
  try {
    const db = await loadDb();
    let regs = db.registrations || [];
    const { search, type, status } = req.query;
    if (search) {
      const q = search.toLowerCase();
      regs = regs.filter(r => [r.id, r.entityName, r.contactPerson, r.phone, r.email].some(v => (v || '').toLowerCase().includes(q)));
    }
    if (type && type !== 'all') regs = regs.filter(r => (r.type || '').toLowerCase().includes(type.toLowerCase()));
    if (status && status !== 'all') regs = regs.filter(r => (r.status || '').toLowerCase() === status.toLowerCase());
    return res.json({ success: true, registrations: regs, total: regs.length });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// PUT /api/admin/registrations/:id
app.put('/api/admin/registrations/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const supabase = getSupabaseClient();
    if (supabase) {
      const { error } = await supabase.from('registrations').update(updates).eq('id', id);
      if (!error) { auditLog('REGISTRATION_UPDATED', `id=${id}`); return res.json({ success: true }); }
    }
    const db = loadDbLocal();
    const reg = (db.registrations || []).find(r => r.id === id);
    if (!reg) return res.status(404).json({ success: false, error: 'Not found' });
    Object.assign(reg, updates);
    saveDbLocal(db);
    auditLog('REGISTRATION_UPDATED', `id=${id}`);
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// DELETE /api/admin/registrations/:id
app.delete('/api/admin/registrations/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const supabase = getSupabaseClient();
    if (supabase) {
      await supabase.from('registrations').delete().eq('id', id);
      auditLog('REGISTRATION_DELETED', `id=${id}`);
      return res.json({ success: true });
    }
    const db = loadDbLocal();
    db.registrations = (db.registrations || []).filter(r => r.id !== id);
    saveDbLocal(db);
    auditLog('REGISTRATION_DELETED', `id=${id}`);
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/admin/payments
app.get('/api/admin/payments', requireAdmin, async (req, res) => {
  try {
    const db = await loadDb();
    let payments = (db.registrations || []).map(r => ({
      registrationId: r.id, playerName: r.entityName, contactPerson: r.contactPerson,
      phone: r.phone, email: r.email, type: r.type, amount: r.amount,
      txnId: r.txnId, method: r.method, status: r.status, date: r.date
    }));
    const { search, status } = req.query;
    if (search) { const q = search.toLowerCase(); payments = payments.filter(p => [p.registrationId, p.playerName, p.txnId].some(v => (v || '').toLowerCase().includes(q))); }
    if (status && status !== 'all') payments = payments.filter(p => (p.status || '').toLowerCase() === status.toLowerCase());
    return res.json({ success: true, payments });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/admin/receipt/:id
app.get('/api/admin/receipt/:id', requireAdmin, async (req, res) => {
  try {
    const db = await loadDb();
    const reg = (db.registrations || []).find(r => r.id === req.params.id);
    if (!reg) return res.status(404).json({ success: false, error: 'Registration not found' });
    return res.json({ success: true, receipt: reg });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/admin/audit-log
app.get('/api/admin/audit-log', requireAdmin, (req, res) => {
  try {
    if (!fs.existsSync(AUDIT_LOG_FILE)) return res.json({ success: true, log: [] });
    const lines = fs.readFileSync(AUDIT_LOG_FILE, 'utf8').trim().split('\n').filter(Boolean).reverse().slice(0, 100);
    return res.json({ success: true, log: lines });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/admin/change-password
app.post('/api/admin/change-password', requireAdmin, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const creds = loadCredentials();
    let currentMatch = false;
    if (creds.passwordHash) {
      currentMatch = await bcrypt.compare(currentPassword, creds.passwordHash);
    } else {
      currentMatch = currentPassword === creds.password;
    }
    if (!currentMatch) return res.status(401).json({ success: false, error: 'Current password is incorrect' });
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ success: false, error: 'New password must be at least 8 characters' });
    const hash = await bcrypt.hash(newPassword, 12);
    const configData = readConfigFile();
    configData.ADMIN_PASSWORD_HASH = hash;
    configData.ADMIN_USERNAME = creds.username;
    writeConfigFile(configData);
    auditLog('PASSWORD_CHANGED', `ip=${req.ip}`);
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/admin/content
app.get('/api/admin/content', requireAdmin, (req, res) => {
  try {
    const config = readConfigFile();
    return res.json({ success: true, content: config.siteContent || {} });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/admin/update-content
app.post('/api/admin/update-content', requireAdmin, (req, res) => {
  try {
    const configData = readConfigFile();
    configData.siteContent = { ...(configData.siteContent || {}), ...req.body };
    writeConfigFile(configData);
    auditLog('CONTENT_UPDATED', `fields=${Object.keys(req.body).join(',')}`);
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// Security middleware: block direct public access to sensitive server files (.env, *.json, *.log, node_modules, etc.)
const SENSITIVE_FILE_PATTERNS = [
  /^\/\.env/i,
  /\.json$/i,
  /\.log$/i,
  /^\/\.git/i,
  /^\/\.DS_Store/i,
  /^\/node_modules/i
];

app.use((req, res, next) => {
  const reqPath = req.path;
  if (SENSITIVE_FILE_PATTERNS.some(pattern => pattern.test(reqPath))) {
    return res.status(403).json({ success: false, error: 'Access denied: sensitive resource.' });
  }
  next();
});

app.use(express.static(__dirname, {
  etag: true,
  setHeaders: (res, filePath) => {
    if (filePath.match(/\.(html|css|js)$/i)) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    } else if (filePath.match(/\.(jpg|jpeg|png|gif|svg|webp|mp4|woff2|woff|ttf)$/i)) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  }
}));

// Dedicated Sport Page Routes & Assets
app.get('/sport/style.css', (req, res) => res.sendFile(path.join(__dirname, 'style.css')));
app.get('/sport/logo.jpeg', (req, res) => res.sendFile(path.join(__dirname, 'logo.jpeg')));
app.get('/sport/app.js', (req, res) => res.sendFile(path.join(__dirname, 'app.js')));

app.get(['/volleyball', '/sport/volleyball'], (req, res) => res.sendFile(path.join(__dirname, 'volleyball.html')));
app.get(['/throwball', '/sport/throwball'], (req, res) => res.sendFile(path.join(__dirname, 'throwball.html')));
app.get(['/football', '/sport/football'], (req, res) => res.sendFile(path.join(__dirname, 'football.html')));
app.get(['/khokho', '/sport/khokho'], (req, res) => res.sendFile(path.join(__dirname, 'khokho.html')));

// Serve index.html on root or fallback (do not intercept /admin paths)
app.get('*', (req, res) => {
  if (req.path.startsWith('/admin')) {
    return res.status(404).send('Admin page not found');
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`======================================================`);
  console.log(` ⚡ Apex Sports Academy Node Server Active`);
  console.log(` 🌐 Server URL: http://localhost:${PORT}`);
  console.log(` ✉️  Email Engine: Nodemailer (Gmail SMTP)`);
  console.log(`======================================================`);
});
