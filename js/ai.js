/**
 * ai.js — Hidden Hydra AI system (client side)
 *
 * NO API KEYS HERE ANYMORE. All Groq calls go through the Vercel serverless
 * function /api/ai which reads GROQ_API_KEY from environment variables.
 *
 * Features:
 *  1. Private AI assistant — each user gets their OWN room `ai-{uid}`
 *     (previously everyone shared one public room and could read each
 *     other's AI conversations — fixed).
 *  2. Welcome bot — greets new users in Global Lounge.
 *  3. Cyberbully detection — verdict comes from /api/ai (server-side model
 *     call), enforcement still applies to the sender's own profile doc.
 *  4. /help, /ai, /report, /rules commands.
 */

import {
  db, rtdb,
  doc, getDoc, setDoc, updateDoc, addDoc,
  collection, serverTimestamp,
  ref, push
} from './firebase-config.js';

import { aiChat, aiWelcome, aiModerate } from './api.js';

export const BOT_ID     = 'hydra-ai-bot';
export const BOT_NAME   = 'Hydra AI';
export const BOT_AVATAR = 'sparkles';

/** every user's private AI room id */
export const AI_ROOM = uid => 'ai-' + uid;
export const isAIRoom  = cid => typeof cid === 'string' && cid.startsWith('ai-');

const WARN_LIMIT = 3;
const SEVERE_KEYWORDS = ['kill yourself', 'kys', 'go die', 'end your life', 'suicide'];

/* ── post a bot message (plain text — bot rooms are not E2EE) ── */
export async function botMsg(chatId, text) {
  await push(ref(rtdb, `messages/${chatId}`), {
    text,
    senderId:     BOT_ID,
    senderName:   BOT_NAME,
    senderAvatar: BOT_AVATAR,
    senderPhoto:  '',
    timestamp:    Date.now(),
    reactions:    null,
    isBot:        true
  });
}

/* ── 1. welcome new user in Global Lounge ── */
export async function welcomeNewUser(user, profile) {
  try {
    const reply = await aiWelcome(profile.username, profile.country || 'somewhere in the world');
    if (reply) await botMsg('g-lounge', reply);
  } catch (_) { /* AI optional — never block onboarding */ }
  try { await updateDoc(doc(db, 'users', user.uid), { welcomed: true }); } catch (_) {}
}

/* ── 2. private AI assistant chat ── */
const conversationHistory = {}; // uid -> messages[]

export async function handleAIChat(userUid, username, userMessage) {
  const history = (conversationHistory[userUid] ||= []);
  history.push({ role: 'user', content: userMessage });
  if (history.length > 12) history.splice(0, history.length - 12);
  try {
    const reply = await aiChat(history, username);
    if (reply) {
      history.push({ role: 'assistant', content: reply });
      await botMsg(AI_ROOM(userUid), reply);
      return reply;
    }
  } catch (e) {
    const why = String(e.message || '').slice(0, 200);
    await botMsg(AI_ROOM(userUid),
      'Hydra AI could not answer right now. Server says: ' + why +
      ' — check GROQ_API_KEY on Vercel (and redeploy after changing env vars), or POST /api/ai {"action":"ping"} to diagnose.');
  }
  return null;
}

/* ── 3. moderation (verdict from server, enforcement on own doc) ── */
export async function moderateMessage(chatId, msgKey, senderId, senderName, text) {
  if (senderId === BOT_ID) return;
  const userSnap = await getDoc(doc(db, 'users', senderId));
  if (!userSnap.exists()) return;
  const userData = userSnap.data();
  if (userData.banned) return;

  const lower = text.toLowerCase();
  let isToxic = false, severity = 'mild', reason = '';

  if (SEVERE_KEYWORDS.some(k => lower.includes(k))) {
    isToxic = true; severity = 'severe'; reason = 'Extreme harmful content';
  } else {
    try {
      const v = await aiModerate(text);
      if (v) { isToxic = v.toxic === true; severity = v.severity || 'mild'; reason = v.reason || ''; }
    } catch (_) { return; } // AI offline → skip moderation, don't break chat
  }
  if (!isToxic) return;

  const warns = (userData.warns || 0) + 1;

  if (severity === 'severe' || warns >= WARN_LIMIT) {
    await updateDoc(doc(db, 'users', senderId), {
      banned: true, banReason: reason, bannedAt: serverTimestamp(), warns
    });
    try {
      const { remove, ref: rtRef } = await import('./firebase-config.js');
      await remove(rtRef(rtdb, `messages/${chatId}/${msgKey}`));
    } catch (_) {}
    await botMsg(chatId,
      `${senderName} has been removed from Hidden Hydra for violating community guidelines. Their message has been removed.`);
    await addDoc(collection(db, 'moderation'), {
      userId: senderId, username: senderName, action: 'ban', reason, chatId, message: text, timestamp: serverTimestamp()
    });
  } else {
    await updateDoc(doc(db, 'users', senderId), { warns });
    const left = WARN_LIMIT - warns;
    await botMsg(chatId,
      `${senderName}, this is warning ${warns}/${WARN_LIMIT}. Your message was flagged for: ${reason}. ` +
      `${left} more violation${left !== 1 ? 's' : ''} will result in a permanent ban.`);
    await addDoc(collection(db, 'moderation'), {
      userId: senderId, username: senderName, action: `warn_${warns}`, reason, chatId, message: text, timestamp: serverTimestamp()
    });
  }
}

/* ── 4. command parser ── */
export async function parseCommand(userUid, username, chatId, text, sendMsgFn) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return false;
  const parts = trimmed.slice(1).split(' ');
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1).join(' ');

  switch (cmd) {
    case 'help':
      await sendMsgFn(text);
      setTimeout(() => botMsg(chatId,
        'Hydra AI commands:\n/ai [question] — ask me anything\n/help — show this message\n/report @username — report a user\n/rules — community rules'), 500);
      return true;

    case 'ai':
      if (!args) { await botMsg(chatId, `Hi ${username}! Ask me anything — I'm here to help.`); return true; }
      await sendMsgFn(text);
      setTimeout(async () => {
        try {
          const reply = await aiChat([{ role: 'user', content: args }], username);
          if (reply) await botMsg(chatId, reply);
        } catch (e) { await botMsg(chatId, 'Hydra AI error: ' + String(e.message || 'unreachable').slice(0, 180)); }
      }, 400);
      return true;

    case 'report':
      await sendMsgFn(text);
      await botMsg(chatId, 'Report received. Our moderation team will review it shortly. Thank you for helping keep Hidden Hydra safe.');
      await addDoc(collection(db, 'moderation'), {
        userId: userUid, username, action: 'user_report', message: args, chatId, timestamp: serverTimestamp()
      });
      return true;

    case 'rules':
      await botMsg(chatId,
        'Hidden Hydra rules:\n1. No harassment or bullying\n2. No hate speech or slurs\n3. No spam or flooding\n4. No sharing personal info without consent\n5. Treat all members with respect\n\nViolations result in warnings, then a permanent ban.');
      return true;

    default:
      return false;
  }
}

/* ── 5. ban check (boot + live) ── */
export async function checkBanStatus(userUid) {
  const snap = await getDoc(doc(db, 'users', userUid));
  if (!snap.exists()) return false;
  return snap.data().banned === true;
}

export { setDoc };
