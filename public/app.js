/* ═══════════════════════════════════════════════════════════
   ChatApp Logger — Application Logic
   ═══════════════════════════════════════════════════════════ */

// ── State ─────────────────────────────────────────────────
let currentUser = '';
let allMessages = [];
let users = [];
let refreshInterval = null;
let queuePanelOpen = false;
let emojiPickerOpen = false;

// Avatar color palette
const AVATAR_COLORS = [
    '#6c5ce7', '#e17055', '#00b894', '#fdcb6e',
    '#e84393', '#0984e3', '#ff7675', '#00cec9',
    '#636e72', '#d63031', '#74b9ff', '#a29bfe',
];

// Emoji collection
const EMOJIS = [
    '😀', '😂', '😍', '🥰', '😎', '🤔', '😅', '😊',
    '🔥', '❤️', '👍', '👏', '🎉', '💯', '✨', '🙌',
    '😢', '😡', '🤣', '😜', '🥺', '😴', '🤗', '🫡',
    '👀', '💀', '🤝', '✅', '❌', '💬', '📱', '🚀',
];

// ── Initialization ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initParticles();
    initEmojiPicker();

    // Check if user was logged in before
    const savedUser = sessionStorage.getItem('chatapp_user');
    if (savedUser) {
        currentUser = savedUser;
        showChatScreen();
    }

    // Handle Enter key on login input
    document.getElementById('loginUsername').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleLogin();
    });

    // Scroll detection for "scroll to bottom" button
    const container = document.getElementById('messagesContainer');
    container.addEventListener('scroll', () => {
        const btn = document.getElementById('scrollBottomBtn');
        const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
        btn.style.display = isNearBottom ? 'none' : 'flex';
    });
});

// ── Login / Logout ────────────────────────────────────────
function handleLogin() {
    const input = document.getElementById('loginUsername');
    const username = input.value.trim();

    if (!username) {
        input.style.borderColor = '#ff6b6b';
        input.style.boxShadow = '0 0 0 3px rgba(255,107,107,0.2)';
        setTimeout(() => {
            input.style.borderColor = '';
            input.style.boxShadow = '';
        }, 1500);
        return;
    }

    currentUser = username;
    sessionStorage.setItem('chatapp_user', username);
    showChatScreen();
}

function handleLogout() {
    currentUser = '';
    sessionStorage.removeItem('chatapp_user');
    clearInterval(refreshInterval);

    document.getElementById('chatScreen').style.display = 'none';
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('loginUsername').value = '';
}

function showChatScreen() {
    // Animate login out
    const loginScreen = document.getElementById('loginScreen');
    loginScreen.style.opacity = '0';
    loginScreen.style.transform = 'scale(1.05)';
    loginScreen.style.transition = 'all 0.4s ease';

    setTimeout(() => {
        loginScreen.style.display = 'none';
        loginScreen.style.opacity = '';
        loginScreen.style.transform = '';

        const chatScreen = document.getElementById('chatScreen');
        chatScreen.style.display = 'flex';
        chatScreen.style.opacity = '0';
        chatScreen.style.animation = 'fadeInScreen 0.5s forwards';

        // Update sidebar user info
        document.getElementById('sidebarUsername').textContent = currentUser;
        document.getElementById('sidebarAvatar').textContent = currentUser.charAt(0).toUpperCase();
        document.getElementById('sidebarAvatar').style.background = getAvatarColor(currentUser);

        loadData(true);
        refreshInterval = setInterval(() => loadData(false), 4000);

        // Focus message input
        setTimeout(() => document.getElementById('messageInput').focus(), 300);
    }, 400);
}

// ── Data Loading ──────────────────────────────────────────
async function loadData(scrollToBottom = false) {
    try {
        const response = await fetch('/api/messages');
        const data = await response.json();

        if (data.users) {
            allMessages = [];
            users = [];

            data.users.forEach(user => {
                users.push(user.username);
                user.messages.forEach(msg => {
                    allMessages.push(msg);
                });
            });

            // Sort by timestamp
            allMessages.sort((a, b) => a.timestamp - b.timestamp);

            updateUserList();
            updateMessages(scrollToBottom);
            updateQueueVisualization();
            updateParticipantCount();
        }
    } catch (error) {
        console.error('Error loading data:', error);
    }
}

// ── User List (Sidebar) ──────────────────────────────────
function updateUserList() {
    const userList = document.getElementById('userList');
    const searchTerm = document.getElementById('searchUsers').value.toLowerCase();

    if (users.length === 0) {
        userList.innerHTML = `
            <div class="empty-sidebar">
                <div class="empty-sidebar-icon"><i class="fas fa-user-friends"></i></div>
                <p>No conversations yet</p>
                <span>Send a message to get started</span>
            </div>
        `;
        return;
    }

    // Filter users
    const filteredUsers = users.filter(u => u.toLowerCase().includes(searchTerm));

    userList.innerHTML = '';
    filteredUsers.forEach(username => {
        const userMessages = allMessages.filter(msg => msg.username === username);
        const lastMessage = userMessages[userMessages.length - 1];
        const msgCount = userMessages.length;

        const item = document.createElement('div');
        item.className = 'user-item' + (username === currentUser ? ' active' : '');
        item.onclick = () => {
            // Highlight but don't change current user
        };

        const preview = lastMessage
            ? escapeHtml(lastMessage.content).substring(0, 35) + (lastMessage.content.length > 35 ? '...' : '')
            : 'No messages yet';

        item.innerHTML = `
            <div class="user-avatar" style="background:${getAvatarColor(username)}">
                ${username.charAt(0).toUpperCase()}
            </div>
            <div class="user-item-info">
                <div class="user-item-name">${escapeHtml(username)}</div>
                <div class="user-item-preview">${preview}</div>
            </div>
            <div class="user-item-meta">
                <span class="user-item-time">${lastMessage ? formatTime(lastMessage.timestamp) : ''}</span>
                <span class="user-item-badge">${msgCount}</span>
            </div>
        `;

        userList.appendChild(item);
    });
}

function filterUsers() {
    updateUserList();
}

// ── Messages ──────────────────────────────────────────────
function updateMessages(scrollToBottom = false) {
    const container = document.getElementById('messagesContainer');
    const welcomeState = document.getElementById('welcomeState');

    if (allMessages.length === 0) {
        container.innerHTML = '';
        container.appendChild(createWelcomeState());
        return;
    }

    // Check if near bottom before update
    const wasNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;

    container.innerHTML = '';

    let lastDate = '';
    let lastUsername = '';

    allMessages.forEach((msg, index) => {
        // Date separator
        const msgDate = formatDate(msg.timestamp);
        if (msgDate !== lastDate) {
            const sep = document.createElement('div');
            sep.className = 'date-separator';
            sep.innerHTML = `<span>${msgDate}</span>`;
            container.appendChild(sep);
            lastDate = msgDate;
            lastUsername = ''; // Reset for first message of new day
        }

        const isSent = msg.username === currentUser;
        const isConsecutive = msg.username === lastUsername;

        const row = document.createElement('div');
        row.className = `message-row ${isSent ? 'sent' : 'received'}${isConsecutive ? ' consecutive' : ''}`;

        const avatarHtml = !isSent
            ? `<div class="msg-avatar" style="background:${getAvatarColor(msg.username)}">${msg.username.charAt(0).toUpperCase()}</div>`
            : '';

        const senderHtml = (!isSent && !isConsecutive)
            ? `<div class="msg-sender">${escapeHtml(msg.username)}</div>`
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
        lastUsername = msg.username;
    });

    // Scroll management
    if (scrollToBottom || wasNearBottom) {
        requestAnimationFrame(() => {
            container.scrollTop = container.scrollHeight;
        });
    }
}

function createWelcomeState() {
    const div = document.createElement('div');
    div.className = 'welcome-state';
    div.id = 'welcomeState';
    div.innerHTML = `
        <div class="welcome-icon"><i class="fas fa-paper-plane"></i></div>
        <h2>Welcome to ChatApp Logger</h2>
        <p>Messages are stored using a FIFO Queue data structure.<br>Start typing to begin the conversation!</p>
    `;
    return div;
}

// ── Send Message ──────────────────────────────────────────
async function sendMessage(event) {
    if (event) event.preventDefault();

    const input = document.getElementById('messageInput');
    const message = input.value.trim();

    if (!message) return;
    if (!currentUser) {
        showToast('Please login first');
        return;
    }

    // Optimistic UI: instantly show the message
    const optimisticMsg = {
        username: currentUser,
        content: message,
        timestamp: Date.now(),
        _optimistic: true,
    };
    allMessages.push(optimisticMsg);
    updateMessages(true);

    input.value = '';
    input.style.height = 'auto';

    try {
        const response = await fetch('/api/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: currentUser, message }),
        });

        if (response.ok) {
            // Reload to get server-confirmed data
            setTimeout(() => loadData(true), 200);
        } else {
            showToast('Failed to send message');
            // Remove optimistic message
            allMessages.pop();
            updateMessages(true);
        }
    } catch (error) {
        console.error('Error:', error);
        showToast('Connection error');
        allMessages.pop();
        updateMessages(true);
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
    const statUsers = document.getElementById('statUsers');
    const statMessages = document.getElementById('statMessages');
    const statAvgQueue = document.getElementById('statAvgQueue');

    const displayMessages = allMessages.slice(-8);
    countBadge.textContent = allMessages.length;

    if (displayMessages.length === 0) {
        visual.innerHTML = `
            <div class="queue-empty-state">
                <i class="fas fa-inbox"></i>
                <span>Queue Empty</span>
            </div>
        `;
    } else {
        visual.innerHTML = '';
        displayMessages.forEach((msg, i) => {
            const node = document.createElement('div');
            node.className = 'queue-node';
            node.style.background = getAvatarColor(msg.username);
            node.style.animationDelay = `${i * 0.05}s`;
            node.textContent = msg.username.charAt(0).toUpperCase();
            node.title = `${msg.username}: ${msg.content}`;
            visual.appendChild(node);
        });
    }

    // Stats
    statUsers.textContent = users.length;
    statMessages.textContent = allMessages.length;
    statAvgQueue.textContent = users.length > 0
        ? Math.round(allMessages.length / users.length)
        : 0;
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
    await loadData(false);
    showToast('Refreshed!');
}

async function exportData() {
    // Download current user's last 10 messages as readable text
    if (!currentUser) {
        showToast('Please login first');
        return;
    }

    try {
        const link = document.createElement('a');
        link.href = `/api/download/${encodeURIComponent(currentUser)}`;
        link.download = `chat_${currentUser}_${new Date().toISOString().slice(0, 10)}.txt`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast('Downloading your messages!');
    } catch (error) {
        showToast('Download failed');
    }
}

async function downloadAll() {
    try {
        const link = document.createElement('a');
        link.href = '/api/download-all';
        link.download = `chat_all_${new Date().toISOString().slice(0, 10)}.txt`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast('Downloading full conversation!');
    } catch (error) {
        showToast('Download failed');
    }
}

async function clearAllData() {
    if (!confirm('Clear all chat data? This cannot be undone.')) return;

    try {
        const response = await fetch('/api/clear', { method: 'POST' });
        if (response.ok) {
            allMessages = [];
            users = [];
            updateUserList();
            updateMessages();
            updateQueueVisualization();
            showToast('All data cleared');
        }
    } catch (error) {
        showToast('Failed to clear data');
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

// Close emoji picker when clicking outside
document.addEventListener('click', (e) => {
    if (emojiPickerOpen && !e.target.closest('.emoji-picker') && !e.target.closest('.emoji-btn')) {
        emojiPickerOpen = false;
        document.getElementById('emojiPicker').style.display = 'none';
    }
});

// ── Sidebar Toggle ────────────────────────────────────────
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    sidebar.classList.toggle('open');

    // Create overlay if it doesn't exist
    if (!overlay) {
        const newOverlay = document.createElement('div');
        newOverlay.className = 'sidebar-overlay';
        newOverlay.onclick = () => toggleSidebar();
        document.getElementById('chatScreen').appendChild(newOverlay);
    }

    const existingOverlay = document.querySelector('.sidebar-overlay');
    if (existingOverlay) {
        existingOverlay.classList.toggle('visible', sidebar.classList.contains('open'));
    }
}

// ── Particles (Login) ─────────────────────────────────────
function initParticles() {
    const container = document.getElementById('loginParticles');
    for (let i = 0; i < 30; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';
        particle.style.left = Math.random() * 100 + '%';
        particle.style.animationDelay = Math.random() * 6 + 's';
        particle.style.animationDuration = (4 + Math.random() * 4) + 's';
        particle.style.width = (2 + Math.random() * 4) + 'px';
        particle.style.height = particle.style.width;
        particle.style.opacity = 0.1 + Math.random() * 0.4;
        container.appendChild(particle);
    }
}

// ── Helpers ───────────────────────────────────────────────
function getAvatarColor(username) {
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
        hash = username.charCodeAt(i) + ((hash << 5) - hash);
    }
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatDate(timestamp) {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

    return date.toLocaleDateString([], {
        weekday: 'long',
        month: 'short',
        day: 'numeric'
    });
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

function scrollToBottom() {
    const container = document.getElementById('messagesContainer');
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
}

function updateParticipantCount() {
    const count = users.length;
    const text = count + ' participant' + (count !== 1 ? 's' : '');
    document.getElementById('onlineCount').textContent = text;
    document.getElementById('participantCount').textContent = text;
}

// Add fadeIn keyframes that are referenced in JS
const styleSheet = document.createElement('style');
styleSheet.textContent = `
    @keyframes fadeInScreen {
        from { opacity: 0; }
        to { opacity: 1; }
    }
`;
document.head.appendChild(styleSheet);
