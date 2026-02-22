/* ═══════════════════════════════════════════════════════════
   ChatApp Logger — Application Logic
   Google Auth · Personal Chats · Smooth Refresh · Vanta.js
   ═══════════════════════════════════════════════════════════ */

// ── State ─────────────────────────────────────────────────
let authToken = '';
let currentUser = null;          // { email, name, avatar }
let currentChatType = 'global';  // 'global' | 'private'
let currentChatWith = '';        // email of DM recipient
let allUsers = [];
let messageMap = new Map();      // _id -> message object (prevents duplicates)
let renderedIds = new Set();     // IDs already in the DOM
let lastSeenTimestamp = 0;
let refreshInterval = null;
let queuePanelOpen = false;
let emojiPickerOpen = false;
let vantaEffect = null;

const EMOJIS = [
    '😀', '😂', '😍', '🥰', '😎', '🤔', '😅', '😊',
    '🔥', '❤️', '👍', '👏', '🎉', '💯', '✨', '🙌',
    '😢', '😡', '🤣', '😜', '🥺', '😴', '🤗', '🫡',
    '👀', '💀', '🤝', '✅', '❌', '💬', '📱', '🚀',
];

// ── Initialization ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    initVanta();
    initEmojiPicker();
    initScrollDetection();

    // Check for saved session
    const savedToken = sessionStorage.getItem('chatapp_token');
    const savedUser = sessionStorage.getItem('chatapp_user');

    if (savedToken && savedUser) {
        authToken = savedToken;
        currentUser = JSON.parse(savedUser);
        showChatScreen();
    } else {
        await initGoogleSignIn();
    }
});

// ── Vanta.js Background ──────────────────────────────────
function initVanta() {
    try {
        if (typeof VANTA !== 'undefined') {
            vantaEffect = VANTA.NET({
                el: '#vantaBg',
                mouseControls: true,
                touchControls: true,
                gyroControls: false,
                minHeight: 200.0,
                minWidth: 200.0,
                scale: 1.0,
                scaleMobile: 1.0,
                color: 0x7c6cf0,
                backgroundColor: 0x1a1a2e,
                points: 9,
                maxDistance: 22.0,
                spacing: 17.0,
            });
        }
    } catch (e) {
        console.log('Vanta.js not loaded, using fallback background');
    }
}

function destroyVanta() {
    if (vantaEffect) {
        vantaEffect.destroy();
        vantaEffect = null;
    }
}

// ── Google Sign-In ────────────────────────────────────────
async function initGoogleSignIn() {
    try {
        const res = await fetch('/api/config');
        const config = await res.json();

        if (!config.googleClientId) {
            console.warn('Google Client ID not configured');
            document.querySelector('.login-hint').textContent =
                'Google Client ID not configured. Add GOOGLE_CLIENT_ID to .env';
            return;
        }

        google.accounts.id.initialize({
            client_id: config.googleClientId,
            callback: handleGoogleResponse,
            auto_select: false,
        });

        google.accounts.id.renderButton(
            document.getElementById('googleSignInBtn'),
            {
                type: 'standard',
                theme: 'filled_black',
                size: 'large',
                text: 'signin_with',
                shape: 'pill',
                width: 280,
            }
        );
    } catch (e) {
        console.error('Google Sign-In init error:', e);
    }
}

async function handleGoogleResponse(response) {
    try {
        const res = await fetch('/api/auth/google', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credential: response.credential }),
        });

        const data = await res.json();

        if (data.success && data.token) {
            authToken = data.token;
            currentUser = data.user;
            sessionStorage.setItem('chatapp_token', authToken);
            sessionStorage.setItem('chatapp_user', JSON.stringify(currentUser));
            showChatScreen();
        } else {
            showToast('Authentication failed');
        }
    } catch (error) {
        console.error('Auth error:', error);
        showToast('Login failed. Please try again.');
    }
}

// ── Login / Logout ────────────────────────────────────────
function handleLogout() {
    authToken = '';
    currentUser = null;
    sessionStorage.removeItem('chatapp_token');
    sessionStorage.removeItem('chatapp_user');
    clearInterval(refreshInterval);
    messageMap.clear();
    renderedIds.clear();

    document.getElementById('chatScreen').style.display = 'none';
    document.getElementById('loginScreen').style.display = 'flex';
    initVanta();
    initGoogleSignIn();
}

function showChatScreen() {
    const loginScreen = document.getElementById('loginScreen');
    loginScreen.style.opacity = '0';
    loginScreen.style.transition = 'opacity 0.4s ease';

    setTimeout(() => {
        loginScreen.style.display = 'none';
        loginScreen.style.opacity = '';
        destroyVanta();

        const chatScreen = document.getElementById('chatScreen');
        chatScreen.style.display = 'flex';
        chatScreen.style.animation = 'fadeInScreen 0.5s forwards';

        // Update sidebar user info
        if (currentUser) {
            document.getElementById('sidebarUsername').textContent = currentUser.name;
            document.getElementById('sidebarEmail').textContent = currentUser.email;
            if (currentUser.avatar) {
                document.getElementById('sidebarAvatarImg').src = currentUser.avatar;
            }
        }

        loadUsers();
        switchChat('global');
        refreshInterval = setInterval(() => pollNewMessages(), 3500);

        setTimeout(() => document.getElementById('messageInput').focus(), 300);
    }, 400);
}

// ── API Helpers ───────────────────────────────────────────
function authHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
    };
}

async function apiFetch(url, options = {}) {
    options.headers = { ...authHeaders(), ...(options.headers || {}) };
    const res = await fetch(url, options);
    if (res.status === 401) {
        handleLogout();
        showToast('Session expired. Please login again.');
        throw new Error('Unauthorized');
    }
    return res;
}

// ── Users ─────────────────────────────────────────────────
async function loadUsers() {
    try {
        const res = await apiFetch('/api/users');
        const data = await res.json();
        allUsers = data.users || [];
        updateDmList();
        document.getElementById('onlineCount').textContent = allUsers.length + ' users';
    } catch (e) {
        console.error('Error loading users:', e);
    }
}

function updateDmList() {
    const dmList = document.getElementById('dmList');
    const searchTerm = (document.getElementById('searchUsers').value || '').toLowerCase();

    const otherUsers = allUsers.filter(u =>
        u.email !== currentUser?.email &&
        u.name.toLowerCase().includes(searchTerm)
    );

    if (otherUsers.length === 0) {
        dmList.innerHTML = `
            <div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 0.8rem;">
                No other users yet
            </div>
        `;
        return;
    }

    dmList.innerHTML = '';
    otherUsers.forEach(user => {
        const isActive = currentChatType === 'private' && currentChatWith === user.email;
        const item = document.createElement('div');
        item.className = 'chat-item' + (isActive ? ' active' : '');
        item.onclick = () => switchChat('private', user.email);

        item.innerHTML = `
            <div class="chat-item-avatar" style="background: var(--nm-surface);">
                <img src="${user.avatar || ''}" alt="${user.name}" referrerpolicy="no-referrer"
                     onerror="this.style.display='none'; this.parentElement.textContent='${user.name.charAt(0).toUpperCase()}'">
            </div>
            <div class="chat-item-info">
                <div class="chat-item-name">${escapeHtml(user.name)}</div>
                <div class="chat-item-preview">${escapeHtml(user.email)}</div>
            </div>
        `;
        dmList.appendChild(item);
    });
}

function filterChatList() {
    updateDmList();
}

// ── Chat Switching ────────────────────────────────────────
function switchChat(chatType, withEmail = '') {
    currentChatType = chatType;
    currentChatWith = withEmail;
    messageMap.clear();
    renderedIds.clear();
    lastSeenTimestamp = 0;

    const container = document.getElementById('messagesContainer');
    container.innerHTML = '';

    // Update header
    if (chatType === 'global') {
        document.getElementById('roomName').textContent = 'Global Chat Room';
        document.getElementById('roomAvatar').innerHTML = '<i class="fas fa-globe"></i>';
        document.getElementById('participantCount').textContent = allUsers.length + ' participants';
    } else {
        const dmUser = allUsers.find(u => u.email === withEmail);
        const name = dmUser ? dmUser.name : withEmail;
        document.getElementById('roomName').textContent = name;
        if (dmUser?.avatar) {
            document.getElementById('roomAvatar').innerHTML = `<img src="${dmUser.avatar}" referrerpolicy="no-referrer">`;
        } else {
            document.getElementById('roomAvatar').innerHTML = `<span style="font-weight:700;font-size:18px">${name.charAt(0).toUpperCase()}</span>`;
        }
        document.getElementById('participantCount').textContent = 'Private conversation';
    }

    // Update sidebar active state
    document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
    if (chatType === 'global') {
        document.getElementById('globalChatItem').classList.add('active');
    }
    updateDmList();

    // Load messages for this chat (full refresh)
    loadMessages(true);
}

// ── Message Loading (SMOOTH — no blink) ───────────────────
async function loadMessages(fullRefresh = false) {
    try {
        const params = new URLSearchParams({ chatType: currentChatType });
        if (currentChatType === 'private' && currentChatWith) {
            params.append('with', currentChatWith);
        }
        if (!fullRefresh && lastSeenTimestamp > 0) {
            params.append('since', lastSeenTimestamp);
        }

        const res = await apiFetch(`/api/messages?${params}`);
        const data = await res.json();
        const messages = data.messages || [];

        if (fullRefresh) {
            // Full render (on chat switch)
            const container = document.getElementById('messagesContainer');
            container.innerHTML = '';
            messageMap.clear();
            renderedIds.clear();

            if (messages.length === 0) {
                container.appendChild(createWelcomeState());
            } else {
                messages.forEach((msg, i) => {
                    messageMap.set(msg._id, msg);
                    appendMessageToDOM(msg, messages[i - 1], false); // no animate on full load
                });
                scrollToBottom(false);
            }
        } else {
            // Incremental append (polling — SMOOTH)
            let newCount = 0;
            messages.forEach(msg => {
                if (!messageMap.has(msg._id)) {
                    messageMap.set(msg._id, msg);
                    const prev = getLastRenderedMessage();
                    appendMessageToDOM(msg, prev, true); // animate new ones
                    newCount++;
                }
            });

            if (newCount > 0) {
                // Remove welcome state if present
                const welcome = document.getElementById('welcomeState');
                if (welcome) welcome.remove();

                // Auto-scroll if near bottom
                const container = document.getElementById('messagesContainer');
                const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 120;
                if (isNearBottom) {
                    scrollToBottom(true);
                }
            }
        }

        // Update last seen timestamp
        if (messages.length > 0) {
            lastSeenTimestamp = Math.max(...messages.map(m => m.timestamp));
        }

        updateQueueVisualization();

    } catch (error) {
        console.error('Error loading messages:', error);
    }
}

async function pollNewMessages() {
    await loadMessages(false);
    // Also refresh user list periodically
    if (Math.random() < 0.3) loadUsers();
}

function getLastRenderedMessage() {
    const ids = Array.from(messageMap.keys());
    if (ids.length < 2) return null;
    return messageMap.get(ids[ids.length - 2]);
}

// ── Render Single Message to DOM ──────────────────────────
function appendMessageToDOM(msg, prevMsg, animate = true) {
    const container = document.getElementById('messagesContainer');

    // Date separator
    const msgDate = formatDate(msg.timestamp);
    const prevDate = prevMsg ? formatDate(prevMsg.timestamp) : '';
    if (msgDate !== prevDate) {
        const sep = document.createElement('div');
        sep.className = 'date-separator';
        sep.innerHTML = `<span>${msgDate}</span>`;
        container.appendChild(sep);
    }

    const isSent = msg.from === currentUser?.email;
    const isConsecutive = prevMsg && prevMsg.from === msg.from && msgDate === prevDate;

    const row = document.createElement('div');
    row.className = `message-row ${isSent ? 'sent' : 'received'}${isConsecutive ? ' consecutive' : ''}`;
    row.dataset.id = msg._id;

    if (!animate) {
        row.classList.add('no-animate');
    }

    const avatarSrc = msg.fromAvatar || '';
    const avatarHtml = !isSent
        ? `<div class="msg-avatar">
               <img src="${avatarSrc}" alt="" referrerpolicy="no-referrer"
                    onerror="this.style.display='none'; this.parentElement.style.background='var(--accent)'; this.parentElement.textContent='${(msg.fromName || '?').charAt(0).toUpperCase()}'">
           </div>`
        : '';

    const senderHtml = (!isSent && !isConsecutive)
        ? `<div class="msg-sender">${escapeHtml(msg.fromName || msg.from)}</div>`
        : '';

    row.innerHTML = `
        ${avatarHtml}
        <div class="msg-bubble">
            ${senderHtml}
            <div class="msg-text">${escapeHtml(msg.content)}</div>
            <div class="msg-time">${formatTime(msg.timestamp)}</div>
        </div>
    `;

    container.appendChild(row);
    renderedIds.add(msg._id);
}

function createWelcomeState() {
    const div = document.createElement('div');
    div.className = 'welcome-state';
    div.id = 'welcomeState';
    div.innerHTML = `
        <div class="welcome-icon"><i class="fas fa-paper-plane"></i></div>
        <h2>Welcome to ChatApp Logger</h2>
        <p>Messages are encrypted & stored in a FIFO Queue (max 10 per conversation).<br>Start typing to begin!</p>
    `;
    return div;
}

// ── Send Message ──────────────────────────────────────────
async function sendMessage(event) {
    if (event) event.preventDefault();

    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    if (!message || !currentUser) return;

    // Optimistic UI
    const optimisticId = 'opt_' + Date.now();
    const optimisticMsg = {
        _id: optimisticId,
        from: currentUser.email,
        fromName: currentUser.name,
        fromAvatar: currentUser.avatar,
        to: currentChatType === 'global' ? 'global' : currentChatWith,
        content: message,
        chatType: currentChatType,
        timestamp: Date.now(),
    };

    messageMap.set(optimisticId, optimisticMsg);
    const prev = getLastRenderedMessage();
    const welcome = document.getElementById('welcomeState');
    if (welcome) welcome.remove();
    appendMessageToDOM(optimisticMsg, prev, true);
    scrollToBottom(true);

    input.value = '';
    input.style.height = 'auto';

    try {
        const res = await apiFetch('/api/send', {
            method: 'POST',
            body: JSON.stringify({
                message,
                to: currentChatWith,
                chatType: currentChatType,
            }),
        });

        const data = await res.json();
        if (data.success && data.message) {
            // Replace optimistic with real
            messageMap.delete(optimisticId);
            messageMap.set(data.message._id, data.message);
            lastSeenTimestamp = Math.max(lastSeenTimestamp, data.message.timestamp);
        }
    } catch (error) {
        console.error('Send error:', error);
        showToast('Failed to send');
        // Remove optimistic message
        messageMap.delete(optimisticId);
        const optEl = document.querySelector(`[data-id="${optimisticId}"]`);
        if (optEl) optEl.remove();
    }
}

function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
}

function autoResize(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

// ── Queue Visualization ───────────────────────────────────
function updateQueueVisualization() {
    const visual = document.getElementById('queueVisual');
    const countBadge = document.getElementById('queueCount');
    const messages = Array.from(messageMap.values());

    countBadge.textContent = messages.length;

    const displayMessages = messages.slice(-8);

    if (displayMessages.length === 0) {
        visual.innerHTML = `
            <div class="queue-empty-state">
                <i class="fas fa-inbox"></i>
                <span>Queue Empty</span>
            </div>
        `;
    } else {
        visual.innerHTML = '';
        displayMessages.forEach(msg => {
            const node = document.createElement('div');
            node.className = 'queue-node';
            node.style.background = 'var(--accent-gradient)';
            node.title = `${msg.fromName}: ${msg.content}`;
            if (msg.fromAvatar) {
                node.innerHTML = `<img src="${msg.fromAvatar}" referrerpolicy="no-referrer">`;
            } else {
                node.textContent = (msg.fromName || '?').charAt(0).toUpperCase();
            }
            visual.appendChild(node);
        });
    }

    // Stats
    document.getElementById('statUsers').textContent = allUsers.length;
    document.getElementById('statMessages').textContent = messages.length;
    document.getElementById('statQueue').textContent = '10';
}

function toggleQueuePanel() {
    const panel = document.getElementById('queuePanel');
    const btn = document.getElementById('queueToggleBtn');
    queuePanelOpen = !queuePanelOpen;
    panel.classList.toggle('hidden', !queuePanelOpen);
    btn.classList.toggle('active', queuePanelOpen);
}

// ── Controls ──────────────────────────────────────────────
async function refreshData() {
    const btn = document.querySelector('.header-btn[onclick="refreshData()"]');
    if (btn) btn.classList.add('spinning');
    await loadUsers();
    await loadMessages(true);
    if (btn) setTimeout(() => btn.classList.remove('spinning'), 400);
    showToast('Refreshed!');
}

async function downloadChat() {
    if (!currentUser) return;

    const params = new URLSearchParams({ chatType: currentChatType });
    if (currentChatType === 'private' && currentChatWith) {
        params.append('with', currentChatWith);
    }

    try {
        const link = document.createElement('a');
        link.href = `/api/download?${params}`;
        // We need to add the auth token as a query param since <a> download can't set headers
        // Instead, fetch with auth and create a blob
        const res = await apiFetch(`/api/download?${params}`);
        if (!res.ok) {
            showToast('No messages to download');
            return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const dateStr = new Date().toISOString().slice(0, 10);
        a.download = currentChatType === 'global'
            ? `global_chat_${dateStr}.txt`
            : `dm_${currentChatWith}_${dateStr}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('Chat downloaded!');
    } catch (error) {
        showToast('Download failed');
    }
}

async function clearCurrentChat() {
    const label = currentChatType === 'global' ? 'global chat' : `DM with ${currentChatWith}`;
    if (!confirm(`Clear all messages in ${label}? This cannot be undone.`)) return;

    try {
        const body = { chatType: currentChatType };
        if (currentChatType === 'private') body.with = currentChatWith;

        const res = await apiFetch('/api/clear', {
            method: 'POST',
            body: JSON.stringify(body),
        });

        if (res.ok) {
            messageMap.clear();
            renderedIds.clear();
            lastSeenTimestamp = 0;
            const container = document.getElementById('messagesContainer');
            container.innerHTML = '';
            container.appendChild(createWelcomeState());
            updateQueueVisualization();
            showToast('Chat cleared');
        }
    } catch (error) {
        showToast('Failed to clear');
    }
}

// ── Emoji Picker ──────────────────────────────────────────
function initEmojiPicker() {
    const grid = document.getElementById('emojiGrid');
    EMOJIS.forEach(emoji => {
        const btn = document.createElement('button');
        btn.textContent = emoji;
        btn.onclick = () => insertEmoji(emoji);
        grid.appendChild(btn);
    });
}

function toggleEmojiPicker() {
    emojiPickerOpen = !emojiPickerOpen;
    document.getElementById('emojiPicker').style.display = emojiPickerOpen ? 'block' : 'none';
}

function insertEmoji(emoji) {
    const input = document.getElementById('messageInput');
    const start = input.selectionStart;
    const end = input.selectionEnd;
    input.value = input.value.substring(0, start) + emoji + input.value.substring(end);
    input.focus();
    input.selectionStart = input.selectionEnd = start + emoji.length;
    toggleEmojiPicker();
}

document.addEventListener('click', (e) => {
    if (emojiPickerOpen && !e.target.closest('.emoji-picker') && !e.target.closest('.emoji-btn')) {
        emojiPickerOpen = false;
        document.getElementById('emojiPicker').style.display = 'none';
    }
});

// ── Sidebar Toggle (mobile) ──────────────────────────────
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('open');

    let overlay = document.querySelector('.sidebar-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        overlay.onclick = () => toggleSidebar();
        document.getElementById('chatScreen').appendChild(overlay);
    }
    overlay.classList.toggle('visible', sidebar.classList.contains('open'));
}

// ── Scroll Detection ──────────────────────────────────────
function initScrollDetection() {
    const container = document.getElementById('messagesContainer');
    container.addEventListener('scroll', () => {
        const btn = document.getElementById('scrollBottomBtn');
        const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
        btn.style.display = isNearBottom ? 'none' : 'flex';
    });
}

function scrollToBottom(smooth = true) {
    const container = document.getElementById('messagesContainer');
    if (smooth) {
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    } else {
        container.scrollTop = container.scrollHeight;
    }
}

// ── Helpers ───────────────────────────────────────────────
function formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
    });
}

function formatDate(timestamp) {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showToast(message) {
    const toast = document.getElementById('toast');
    const text = document.getElementById('toastText');
    text.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
}
