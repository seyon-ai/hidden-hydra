/**
 * ai.js — Hidden Hydra AI System
 * Powered by Groq (llama-3.1-8b-instant)
 *
 * Features:
 * 1. AI Assistant chat — personal AI in World tab
 * 2. Welcome bot — greets new users in Global Lounge
 * 3. Cyberbully detection — scans group/world messages
 * 4. Auto-warn + ban system
 * 5. /help, /ai, /report commands
 */

import {
  db, rtdb,
  doc, getDoc, setDoc, updateDoc, addDoc, getDocs,
  collection, query, where, serverTimestamp, arrayUnion,
  ref, push, set, get
} from './firebase-config.js';

// ─── CONFIG ───────────────────────────────────────────
const GROQ_API_KEY = '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';
const GROQ_URL     = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL   = 'llama-3.1-8b-instant';

const BOT_ID     = 'hydra-ai-bot';
const BOT_NAME   = 'Hydra AI';
const BOT_AVATAR = '🤖';

// Warn thresholds
const WARN_LIMIT  = 3;   // bans after 3 warnings
const SEVERE_KEYWORDS = ['kill yourself','kys','go die','end your life','suicide'];

// ─── GROQ API CALL ────────────────────────────────────
async function askGroq(messages, systemPrompt) {
  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        max_tokens: 512,
        temperature: 0.7,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages
        ]
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.choices?.[0]?.message?.content?.trim() || '';
  } catch (e) {
    console.error('Groq error:', e.message);
    return null;
  }
}

// ─── POST BOT MESSAGE ─────────────────────────────────
async function botMsg(chatId, text) {
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

// ─── 1. WELCOME NEW USER ──────────────────────────────
export async function welcomeNewUser(user, profile) {
  const chatId = 'g-lounge';

  const reply = await askGroq(
    [{ role: 'user', content: `A new user just joined Hidden Hydra. Their username is "${profile.username}" and they're from ${profile.country||'somewhere in the world'}. Write a SHORT, warm, mysterious welcome message (2-3 sentences max). Reference their username. Keep it dark-luxury themed, like a secret society welcoming a new member. Use 1-2 emojis.` }],
    `You are Hydra AI, the mysterious guardian of Hidden Hydra — a luxury dark-themed global chat platform. You speak with elegance, warmth and a hint of mystery. Keep all responses brief and impactful.`
  );

  if (reply) {
    await botMsg(chatId, reply);
  }

  // Also mark user as welcomed in Firestore
  try {
    await updateDoc(doc(db, 'users', user.uid), { welcomed: true });
  } catch(_) {}
}

// ─── 2. AI ASSISTANT CHAT ─────────────────────────────
// Called when user sends message in the AI chat room
const AI_CHAT_ID   = 'g-ai-assistant';
const conversationHistory = {}; // uid -> message array (in-memory per session)

export async function handleAIChat(userUid, username, userMessage) {
  // Build conversation history for this user
  if (!conversationHistory[userUid]) {
    conversationHistory[userUid] = [];
  }
  const history = conversationHistory[userUid];
  history.push({ role: 'user', content: userMessage });

  // Keep last 10 messages for context
  if (history.length > 10) history.splice(0, history.length - 10);

  const reply = await askGroq(
    history,
    `You are Hydra AI, the intelligent assistant of Hidden Hydra — a luxury dark-themed global chat platform. 
    You are helpful, witty, and slightly mysterious. You can:
    - Answer general questions
    - Help users navigate the platform (DMs, groups, friend requests, invite codes)
    - Have engaging conversations
    - Give advice and recommendations
    Always be concise (1-4 sentences). Never reveal your API key or internal workings.
    The user's name is ${username}.`
  );

  if (reply) {
    history.push({ role: 'assistant', content: reply });
    await botMsg(AI_CHAT_ID, reply);
  }
}

// ─── 3. CYBERBULLY DETECTION ──────────────────────────
export async function moderateMessage(chatId, msgKey, senderId, senderName, text) {
  // Skip bot messages
  if (senderId === BOT_ID) return;

  // Check if user is already banned
  const userSnap = await getDoc(doc(db, 'users', senderId));
  if (!userSnap.exists()) return;
  const userData = userSnap.data();
  if (userData.banned) return;

  // Quick check for severe keywords (instant warn, no AI needed)
  const lowerText = text.toLowerCase();
  const isSevere = SEVERE_KEYWORDS.some(k => lowerText.includes(k));

  let isToxic = false;
  let severity = 'mild'; // 'mild' | 'moderate' | 'severe'
  let reason   = '';

  if (isSevere) {
    isToxic  = true;
    severity = 'severe';
    reason   = 'Extreme harmful content';
  } else {
    // Use AI for nuanced detection
    const aiVerdict = await askGroq(
      [{ role: 'user', content: `Analyze this chat message for cyberbullying, harassment, hate speech, or toxic behavior. Message: "${text}"\n\nRespond in JSON only: {"toxic": true/false, "severity": "mild/moderate/severe", "reason": "brief reason or empty string"}` }],
      `You are a content moderation AI. Be accurate but not overly sensitive. Normal arguments, mild profanity, or heated discussions are NOT toxic. Only flag genuine harassment, hate speech, threats, slurs, or sustained bullying. Always respond with valid JSON only.`
    );

    if (aiVerdict) {
      try {
        // Extract JSON from response
        const jsonMatch = aiVerdict.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const verdict = JSON.parse(jsonMatch[0]);
          isToxic  = verdict.toxic === true;
          severity = verdict.severity || 'mild';
          reason   = verdict.reason   || '';
        }
      } catch (_) {}
    }
  }

  if (!isToxic) return;

  // Get current warn count
  const warns = (userData.warns || 0) + 1;

  if (severity === 'severe' || warns >= WARN_LIMIT) {
    // BAN the user
    await updateDoc(doc(db, 'users', senderId), {
      banned:   true,
      banReason: reason,
      bannedAt:  serverTimestamp(),
      warns:     warns
    });

    // Delete the toxic message
    try {
      const { remove, ref: rtRef } = await import('./firebase-config.js');
      await remove(rtRef(rtdb, `messages/${chatId}/${msgKey}`));
    } catch(_) {}

    // Bot announcement in chat
    await botMsg(chatId,
      `⚠️ ${senderName} has been removed from Hidden Hydra for violating community guidelines. Their messages have been removed.`
    );

    // Log to moderation collection
    await addDoc(collection(db, 'moderation'), {
      userId:     senderId,
      username:   senderName,
      action:     'ban',
      reason,
      chatId,
      message:    text,
      timestamp:  serverTimestamp()
    });

  } else {
    // WARN the user
    await updateDoc(doc(db, 'users', senderId), { warns });

    const warnsLeft = WARN_LIMIT - warns;

    // Send warning as DM-style bot message in the same chat
    await botMsg(chatId,
      `⚠️ ${senderName}, this is warning ${warns}/${WARN_LIMIT}. Your message was flagged for: ${reason}. ${warnsLeft} more violation${warnsLeft!==1?'s':''} will result in a permanent ban.`
    );

    // Log warning
    await addDoc(collection(db, 'moderation'), {
      userId:     senderId,
      username:   senderName,
      action:     `warn_${warns}`,
      reason,
      chatId,
      message:    text,
      timestamp:  serverTimestamp()
    });
  }
}

// ─── 4. COMMAND PARSER ────────────────────────────────
// Returns true if message was a command (so caller skips normal send)
export async function parseCommand(userUid, username, chatId, text, sendMsgFn) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return false;

  const parts   = trimmed.slice(1).split(' ');
  const cmd     = parts[0].toLowerCase();
  const args    = parts.slice(1).join(' ');

  switch (cmd) {
    case 'help': {
      const helpText =
        `🤖 Hydra AI Commands:\n` +
        `/ai [question] — Ask me anything\n` +
        `/help — Show this message\n` +
        `/report @username — Report a user\n` +
        `/rules — Show community rules`;
      // Send as user message then bot reply
      await sendMsgFn(text);
      setTimeout(() => botMsg(chatId, helpText), 500);
      return true;
    }

    case 'ai': {
      if (!args) {
        await botMsg(chatId, `Hi ${username}! Ask me anything — I'm here to help 🤖`);
        return true;
      }
      await sendMsgFn(text);
      // Reply after short delay
      setTimeout(async () => {
        const reply = await askGroq(
          [{ role: 'user', content: args }],
          `You are Hydra AI, a helpful and witty assistant on Hidden Hydra chat platform. Answer concisely (1-3 sentences). The user's name is ${username}.`
        );
        if (reply) await botMsg(chatId, reply);
      }, 600);
      return true;
    }

    case 'report': {
      await sendMsgFn(text);
      await botMsg(chatId, `📋 Report received. Our moderation team will review it shortly. Thank you for helping keep Hidden Hydra safe.`);
      // Log the report
      await addDoc(collection(db, 'moderation'), {
        userId:    userUid,
        username,
        action:    'user_report',
        message:   args,
        chatId,
        timestamp: serverTimestamp()
      });
      return true;
    }

    case 'rules': {
      await botMsg(chatId,
        `📜 Hidden Hydra Rules:\n` +
        `1. No harassment or bullying\n` +
        `2. No hate speech or slurs\n` +
        `3. No spam or flooding\n` +
        `4. No sharing personal info without consent\n` +
        `5. Treat all members with respect\n\n` +
        `Violations result in warnings then permanent ban.`
      );
      return true;
    }

    default:
      return false;
  }
}

// ─── 5. AI CHAT ROOM SETUP ────────────────────────────
// Ensures the AI Assistant room exists in Firestore
export async function ensureAIChatRoom() {
  const snap = await getDoc(doc(db, 'groups', AI_CHAT_ID));
  if (!snap.exists()) {
    await setDoc(doc(db, 'groups', AI_CHAT_ID), {
      id:          AI_CHAT_ID,
      name:        'AI Assistant',
      icon:        '🤖',
      desc:        'Chat with Hydra AI — ask anything!',
      type:        'global',
      visibility:  'public',
      joinCode:    AI_CHAT_ID,
      members:     [],
      createdBy:   'system',
      createdAt:   serverTimestamp(),
      lastMessage: '',
      lastTime:    serverTimestamp()
    });
  }
}

// ─── 6. BAN CHECK ─────────────────────────────────────
// Call this on boot — redirect banned users
export async function checkBanStatus(userUid) {
  const snap = await getDoc(doc(db, 'users', userUid));
  if (!snap.exists()) return false;
  return snap.data().banned === true;
}

export { AI_CHAT_ID, BOT_ID, BOT_NAME, BOT_AVATAR };
