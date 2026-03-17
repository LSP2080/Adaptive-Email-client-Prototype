/**
 * ============================================================
 * Main Application Script
 * ============================================================
 * Based on BaseCase, with integration hooks for the
 * Dual-AI system (Settings AI + Base AI + Renderer).
 * ============================================================
 */

// ===== Application State =====
const state = {
    currentFolder: 'inbox',
    selectedEmailId: null,
    emails: [],
    searchQuery: '',
    sidebarOpen: false,
    emailViewOpen: false,
    currentPage: 1,
    emailsPerPage: 15,
    folders: {
        'inbox': { name: 'Inbox', icon: 'fa-inbox', count: 0, unread: 0 },
        'starred': { name: 'Starred', icon: 'fa-star', count: 0, unread: 0 },
        'sent': { name: 'Sent', icon: 'fa-paper-plane', count: 0, unread: 0 },
        'drafts': { name: 'Drafts', icon: 'fa-file-alt', count: 0, unread: 0 },
        'trash': { name: 'Trash', icon: 'fa-trash-alt', count: 0, unread: 0 }
    }
};

// ===== App Context Provider (for Renderer) =====
window.AppContext = {
    getContext() {
        return {
            currentEmail: state.emails.find(e => e.id === state.selectedEmailId),
            emails: state.emails,
            currentFolder: state.currentFolder,
            selectedEmailId: state.selectedEmailId
        };
    }
};

// ===== DOM Elements =====
const elements = {
    emailList: document.getElementById('emailList'),
    emailViewContent: document.getElementById('emailViewContent'),
    emailViewSection: document.getElementById('emailViewSection'),
    sidebar: document.getElementById('sidebar'),
    searchInput: document.getElementById('searchInput'),
    menuToggle: document.getElementById('menuToggle'),
    newEmailBtn: document.getElementById('newEmailBtn'),
    closeCompose: document.getElementById('closeCompose'),
    composeModal: document.getElementById('composeModal'),
    sendEmail: document.getElementById('sendEmail'),
    folderList: document.getElementById('folderList'),
    refreshBtn: document.getElementById('refreshBtn'),
    paginationInfo: document.getElementById('paginationInfo'),
    prevPage: document.getElementById('prevPage'),
    nextPage: document.getElementById('nextPage'),
    closeEmailView: document.getElementById('closeEmailView'),
    labelsList: document.getElementById('labelsList'),
    composeTo: document.getElementById('composeTo'),
    composeSubject: document.getElementById('composeSubject'),
    composeBody: document.getElementById('composeBody'),
    attachFile: document.getElementById('attachFile'),
    saveDraft: document.getElementById('saveDraft'),
    // Settings AI elements
    settingsAiToggle: document.getElementById('settingsAiToggle'),
    settingsAiPanel: document.getElementById('settingsAiPanel'),
    closeSettingsAi: document.getElementById('closeSettingsAi'),
    settingsAiInput: document.getElementById('settingsAiInput'),
    settingsAiSend: document.getElementById('settingsAiSend'),
    settingsAiMessages: document.getElementById('settingsAiMessages'),
    rulesList: document.getElementById('rulesList'),
    clearRules: document.getElementById('clearRules'),
    debugPanel: document.getElementById('debugPanel'),
    toggleDebug: document.getElementById('toggleDebug')
};

// ===== Utility Functions =====
function truncateText(text, maxLength = 100) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

function formatDate(dateString) {
    if (!dateString) return 'Unknown date';
    if (typeof dateString === 'string' && dateString.includes(' ')) return dateString;
    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return dateString;
        const now = new Date();
        const diffMs = now - date;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        if (diffDays === 0) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7) return date.toLocaleDateString([], { weekday: 'short' });
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch (error) { return dateString; }
}

function getSenderInitials(sender) {
    if (!sender) return '??';
    const parts = sender.split(' ');
    return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : sender.substring(0, 2).toUpperCase();
}

// ===== Folder Management =====
function updateFolderCounts() {
    Object.keys(state.folders).forEach(folder => {
        state.folders[folder].count = 0;
        state.folders[folder].unread = 0;
    });
    state.emails.forEach(email => {
        const folder = state.folders[email.folder];
        if (folder) {
            folder.count++;
            if (email.unread) folder.unread++;
        }
        if (email.starred) {
            state.folders.starred.count++;
            if (email.unread) state.folders.starred.unread++;
        }
    });
    renderFolderCounts();
}

function renderFolderCounts() {
    document.querySelectorAll('.folder-nav li .badge').forEach(b => b.remove());
    Object.keys(state.folders).forEach(folderKey => {
        const folder = state.folders[folderKey];
        document.querySelectorAll('.folder-nav li').forEach(li => {
            const span = li.querySelector('span:first-of-type');
            if (span && span.textContent.trim() === folder.name) {
                if (folderKey === 'inbox' && folder.unread > 0) {
                    const badge = document.createElement('span');
                    badge.className = 'badge inbox-badge';
                    badge.textContent = folder.unread;
                    li.appendChild(badge);
                } else if (folder.count > 0 && folderKey !== 'inbox') {
                    const badge = document.createElement('span');
                    badge.className = 'badge folder-badge';
                    badge.textContent = folder.count;
                    li.appendChild(badge);
                }
            }
        });
    });
}

// ===== Data Loading =====
async function loadEmailData() {
    try {
        const response = await fetch('data/emails.json');
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        state.emails = data.map(email => ({
            id: email.id || Date.now() + Math.random(),
            sender: email.sender || 'Unknown Sender',
            senderInitials: email.senderInitials || getSenderInitials(email.sender),
            email: email.email || 'unknown@example.com',
            subject: email.subject || 'No Subject',
            snippet: email.snippet || '',
            body: email.body || '<p>No content</p>',
            time: email.time || formatDate(email.date) || 'Unknown time',
            date: email.date || new Date().toISOString().split('T')[0],
            unread: email.unread !== undefined ? email.unread : true,
            starred: email.starred !== undefined ? email.starred : false,
            folder: email.folder || 'inbox',
            labels: email.labels || []
        }));
        updateFolderCounts();
        renderEmailList();
        updatePaginationInfo();
        if (state.emails.length > 0) {
            setTimeout(() => selectEmail(state.emails[0].id), 100);
        }
    } catch (error) {
        console.error('Error loading email data:', error);
        loadFallbackData();
    }
}

function loadFallbackData() {
    state.emails = [{
        id: 1, sender: "System Administrator", senderInitials: "SA",
        email: "admin@system.com", subject: "Welcome to Dual-AI Email Client",
        snippet: "This is a demo email showing the dual AI system...",
        body: `<p>Welcome to the Dual-AI Email Client prototype!</p>
               <p>This system features two AI modules working together:</p>
               <ul><li><strong>Settings AI</strong> - understands your preferences</li>
               <li><strong>Base AI</strong> - adapts the interface based on behavior + your rules</li></ul>
               <p>Try clicking the <strong>robot icon</strong> in the header to open Settings AI!</p>`,
        time: "Just now", date: new Date().toISOString().split('T')[0],
        unread: true, starred: false, folder: "inbox", labels: ["Important"]
    }];
    updateFolderCounts();
    renderEmailList();
    selectEmail(1);
}

// ===== Rendering Functions =====
function renderEmailList() {
    const filteredEmails = state.emails.filter(email => {
        if (state.currentFolder === 'starred') {
            if (!email.starred) return false;
        } else if (state.currentFolder !== 'all' && email.folder !== state.currentFolder) {
            return false;
        }
        if (state.searchQuery) {
            const query = state.searchQuery.toLowerCase();
            return email.sender.toLowerCase().includes(query) ||
                email.subject.toLowerCase().includes(query) ||
                email.snippet.toLowerCase().includes(query) ||
                (email.labels && email.labels.some(l => l.toLowerCase().includes(query)));
        }
        return true;
    });

    elements.emailList.innerHTML = '';
    if (filteredEmails.length === 0) {
        elements.emailList.innerHTML = `
            <div class="no-emails-found">
                <i class="fas fa-inbox"></i>
                <h3>No emails found</h3>
                <p>${state.searchQuery ? 'Try a different search term' : 'No emails in this folder'}</p>
            </div>`;
        return;
    }

    const startIndex = (state.currentPage - 1) * state.emailsPerPage;
    const paginatedEmails = filteredEmails.slice(startIndex, startIndex + state.emailsPerPage);

    paginatedEmails.forEach(email => {
        const emailItem = document.createElement('div');
        emailItem.className = `email-item ${email.unread ? 'unread' : ''} ${state.selectedEmailId === email.id ? 'selected' : ''}`;
        emailItem.dataset.emailId = email.id;

        const labelsHTML = email.labels && email.labels.length > 0
            ? `<div class="email-labels">${email.labels.map(l => `<span class="label-tag" data-label="${l}">${l}</span>`).join('')}</div>`
            : '';

        emailItem.innerHTML = `
            <div class="email-checkbox"><input type="checkbox"></div>
            <div class="email-sender">${email.sender}</div>
            <div class="email-preview">
                <div class="email-subject">
                    <span class="subject-text">${email.subject}</span>
                    ${labelsHTML}
                </div>
                <div class="email-snippet">${truncateText(email.snippet, 80)}</div>
            </div>
            <div class="email-meta">
                <div class="email-time">${formatDate(email.date)}</div>
                <div class="email-actions">
                    <i class="fas fa-star email-star ${email.starred ? 'starred' : ''}" data-email-id="${email.id}"></i>
                </div>
            </div>`;

        emailItem.addEventListener('click', (e) => {
            if (!e.target.classList.contains('email-star') && !e.target.classList.contains('label-tag')) {
                selectEmail(email.id);
            }
        });

        emailItem.querySelectorAll('.label-tag').forEach(tag => {
            tag.addEventListener('click', (e) => { e.stopPropagation(); filterByLabel(tag.dataset.label); });
        });

        const star = emailItem.querySelector('.email-star');
        star.addEventListener('click', (e) => { e.stopPropagation(); toggleStar(parseInt(star.dataset.emailId)); });

        elements.emailList.appendChild(emailItem);
    });

    updatePaginationInfo(filteredEmails.length);

    // ===== AI HOOK: Update priority badges after render =====
    Renderer.updateComponents(window.AppContext.getContext());
}

function renderEmailView(emailId) {
    const email = state.emails.find(e => e.id === emailId);
    if (!email) {
        elements.emailViewContent.innerHTML = `
            <div class="no-email-selected">
                <i class="fas fa-envelope-open-text"></i>
                <h3>No Email Selected</h3>
                <p>Select an email from the list to read it here</p>
            </div>`;
        return;
    }

    if (email.unread) {
        email.unread = false;
        updateFolderCounts();
        renderEmailList();
    }

    const labelsHTML = email.labels && email.labels.length > 0
        ? `<div class="email-labels-view">${email.labels.map(l => `<span class="label-tag-view" data-label="${l}">${l}</span>`).join('')}</div>`
        : '';

    elements.emailViewContent.innerHTML = `
        <div class="email-content">
            <div class="email-header">
                <h1 class="email-subject-large">${email.subject}</h1>
                <div class="email-from">
                    <div class="sender-avatar">${email.senderInitials}</div>
                    <div class="sender-details">
                        <h4>${email.sender}</h4>
                        <p>${email.email}</p>
                    </div>
                </div>
                <div class="email-info">
                    <div><span>To: Me</span>${labelsHTML}</div>
                    <div>${formatDate(email.date)} &bull; ${email.time}</div>
                </div>
            </div>
            <div class="email-body">${email.body}</div>
        </div>`;

    if (window.innerWidth <= 768) {
        elements.emailViewSection.classList.add('open');
        state.emailViewOpen = true;
    }

    // ===== AI HOOK: Notify Base AI of email open =====
    BaseAI.onEmailOpened(email);

    // ===== AI HOOK: Update components with new context =====
    setTimeout(() => {
        Renderer.updateComponents(window.AppContext.getContext());
    }, 100);
}

function renderSidebarFolders() {
    elements.folderList.innerHTML = '';
    Object.keys(state.folders).forEach(folderKey => {
        const folder = state.folders[folderKey];
        const li = document.createElement('li');
        li.dataset.folder = folderKey;
        li.innerHTML = `<i class="fas ${folder.icon}"></i><span>${folder.name}</span>`;
        if (folderKey === state.currentFolder) li.classList.add('active');
        elements.folderList.appendChild(li);
    });
    updateFolderCounts();
}

// ===== State Operations =====
function selectEmail(emailId) {
    state.selectedEmailId = emailId;
    // ===== AI HOOK: Notify switch =====
    BaseAI.onEmailSwitch();
    renderEmailList();
    renderEmailView(emailId);
}

function toggleStar(emailId) {
    const email = state.emails.find(e => e.id === emailId);
    if (email) {
        email.starred = !email.starred;
        updateFolderCounts();
        renderEmailList();
        renderEmailView(emailId);
    }
}

function changeFolder(folder) {
    state.currentFolder = folder;
    state.selectedEmailId = null;
    state.currentPage = 1;
    document.querySelectorAll('.folder-nav li').forEach(li => {
        li.classList.toggle('active', li.dataset.folder === folder);
    });
    // ===== AI HOOK: Notify folder switch =====
    BaseAI.onFolderSwitch();
    renderEmailList();
    renderEmailView(null);
    if (window.innerWidth <= 768) {
        elements.sidebar.classList.remove('open');
        state.sidebarOpen = false;
    }
}

function sendNewEmail(to, subject, body) {
    let recipientEmail = to, recipientName = to;
    const emailMatch = to.match(/<(.+?)>/);
    if (emailMatch) { recipientEmail = emailMatch[1]; recipientName = to.replace(/<.+?>/, '').trim(); }
    else if (to.includes('@')) { recipientEmail = to; recipientName = to.split('@')[0]; }

    const newEmail = {
        id: Date.now(), sender: "John Doe", senderInitials: "JD",
        email: "john@example.com", to: recipientEmail, toName: recipientName,
        subject: subject || 'No Subject', snippet: truncateText(body, 50) || '',
        body: `<p>${(body || '').replace(/\n/g, '</p><p>')}</p>`,
        time: "Just now", date: new Date().toISOString().split('T')[0],
        unread: false, starred: false, folder: "sent", labels: []
    };
    state.emails.unshift(newEmail);
    updateFolderCounts();
    changeFolder('sent');
    selectEmail(newEmail.id);
    return newEmail;
}

function saveAsDraft(to, subject, body) {
    const draftEmail = {
        id: Date.now(), sender: "Me", senderInitials: "ME",
        email: "me@example.com", to, subject: subject || 'No Subject',
        snippet: truncateText(body, 50) || '(Draft)',
        body: `<p>${(body || '').replace(/\n/g, '</p><p>')}</p>`,
        time: "Just now", date: new Date().toISOString().split('T')[0],
        unread: false, starred: false, folder: "drafts", labels: ["Draft"]
    };
    state.emails.unshift(draftEmail);
    updateFolderCounts();
    changeFolder('drafts');
    return draftEmail;
}

// ===== UI Helpers =====
function updatePaginationInfo(totalEmails) {
    if (!totalEmails) return;
    const start = (state.currentPage - 1) * state.emailsPerPage + 1;
    const end = Math.min(state.currentPage * state.emailsPerPage, totalEmails);
    elements.paginationInfo.textContent = `${start}-${end} of ${totalEmails}`;
    elements.prevPage.disabled = state.currentPage === 1;
    elements.nextPage.disabled = end >= totalEmails;
}

function filterByLabel(label) {
    state.searchQuery = label;
    elements.searchInput.value = label;
    renderEmailList();
}

function clearComposeForm() {
    elements.composeTo.value = '';
    elements.composeSubject.value = '';
    elements.composeBody.value = '';
}

// ============================================================
// SETTINGS AI PANEL INTEGRATION
// ============================================================

function initSettingsAI() {
    // Toggle panel
    elements.settingsAiToggle.addEventListener('click', () => {
        elements.settingsAiPanel.classList.toggle('open');
        elements.settingsAiToggle.classList.toggle('active');
    });

    elements.closeSettingsAi.addEventListener('click', () => {
        elements.settingsAiPanel.classList.remove('open');
        elements.settingsAiToggle.classList.remove('active');
    });

    // Send message (async for LLM support)
    async function sendSettingsMessage() {
        const input = elements.settingsAiInput.value.trim();
        if (!input) return;

        // Add user message to chat
        addChatMessage(input, 'user');
        elements.settingsAiInput.value = '';

        // Disable input while processing
        elements.settingsAiInput.disabled = true;
        elements.settingsAiSend.disabled = true;

        // Show thinking indicator
        const thinkingId = addChatMessage('<i class="fas fa-spinner fa-spin"></i> Thinking...', 'ai');

        try {
            // Process through Settings AI (now async with LLM)
            const result = await SettingsAI.processMessage(input);

            // Remove thinking indicator and show real response
            removeLastAiMessage();
            addChatMessage(result.response, 'ai');
            updateRulesDisplay();
        } catch (error) {
            console.error('[App] Settings AI error:', error);
            removeLastAiMessage();
            addChatMessage('Sorry, something went wrong. Please try again.', 'ai');
        } finally {
            // Re-enable input
            elements.settingsAiInput.disabled = false;
            elements.settingsAiSend.disabled = false;
            elements.settingsAiInput.focus();
        }
    }

    elements.settingsAiSend.addEventListener('click', sendSettingsMessage);
    elements.settingsAiInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !elements.settingsAiInput.disabled) sendSettingsMessage();
    });

    // Preset buttons
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const presetName = btn.dataset.preset;
            const preset = SettingsAI.applyPreset(presetName);
            if (preset) {
                // Update active state
                document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                addChatMessage(`Applied "${presetName}" preset: ${preset.description}`, 'ai');
                updateRulesDisplay();
            }
        });
    });

    // Clear rules (via the eraser icon in Settings AI panel)
    elements.clearRules.addEventListener('click', () => {
        Renderer.fullReset();
        SettingsAI.setRulesSilent(SettingsAI.getDefaultRules());
        document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        updateRulesDisplay();
        addChatMessage('All rules cleared. Interface reset to default.', 'ai');
    });
}

function removeLastAiMessage() {
    const container = elements.settingsAiMessages;
    const messages = container.querySelectorAll('.ai-message');
    if (messages.length > 0) {
        messages[messages.length - 1].remove();
    }
}

function addChatMessage(text, type) {
    const container = elements.settingsAiMessages;
    const msg = document.createElement('div');
    msg.className = type === 'user' ? 'user-message' : 'ai-message';

    if (type === 'user') {
        msg.innerHTML = `
            <div class="user-message-avatar">JD</div>
            <div class="user-message-content">${text}</div>`;
    } else {
        msg.innerHTML = `
            <div class="ai-message-avatar"><i class="fas fa-robot"></i></div>
            <div class="ai-message-content">${text}</div>`;
    }

    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
}

function updateRulesDisplay() {
    const rules = SettingsAI.getRules();
    const rulesList = elements.rulesList;

    // Find non-default rules
    const defaults = {
        detailLevel: 'normal', layoutDensity: 'normal', focusMode: false,
        fontSize: 'normal', colorScheme: 'default', showSummary: false,
        showPriority: false, sidebarVisible: true, snippetLength: 'normal',
        readingAssist: false, customCssVars: {}, activePreset: null
    };

    const activeRules = [];
    Object.entries(rules).forEach(([key, value]) => {
        if (key === 'activePreset') return;
        if (key === 'customCssVars') {
            // Show each custom CSS var as a separate chip
            if (value && typeof value === 'object') {
                Object.entries(value).forEach(([cssVar, cssVal]) => {
                    activeRules.push({ key: cssVar, value: cssVal });
                });
            }
            return;
        }
        if (JSON.stringify(value) !== JSON.stringify(defaults[key])) {
            activeRules.push({ key, value });
        }
    });

    if (activeRules.length === 0) {
        rulesList.innerHTML = '<div class="no-rules">No active rules. Tell the AI your preferences below.</div>';
    } else {
        rulesList.innerHTML = activeRules.map(r =>
            `<span class="rule-chip">
                <span class="rule-key">${r.key}:</span>
                <span>${r.value}</span>
                <span class="rule-remove" onclick="removeRule('${r.key}')">&times;</span>
            </span>`
        ).join('');
    }
}

// Global function for rule removal
window.removeRule = function(key) {
    const rules = SettingsAI.getRules();
    const defaults = {
        detailLevel: 'normal', layoutDensity: 'normal', focusMode: false,
        fontSize: 'normal', colorScheme: 'default', showSummary: false,
        showPriority: false, sidebarVisible: true, snippetLength: 'normal',
        readingAssist: false, customCssVars: {}, activePreset: null
    };
    rules[key] = defaults[key];
    // Re-process with a reset message for that key
    SettingsAI.processMessage(`reset ${key}`);
    updateRulesDisplay();
};

// ============================================================
// DEBUG PANEL
// ============================================================

function initDebugPanel() {
    const panel = elements.debugPanel;
    panel.classList.add('collapsed');

    elements.toggleDebug.addEventListener('click', () => {
        panel.classList.toggle('collapsed');
    });
}

// ============================================================
// EVENT LISTENERS
// ============================================================

function initEventListeners() {
    // Sidebar toggle
    elements.menuToggle.addEventListener('click', () => {
        if (window.innerWidth <= 768) {
            state.sidebarOpen = !state.sidebarOpen;
            elements.sidebar.classList.toggle('open', state.sidebarOpen);
        } else {
            elements.sidebar.classList.toggle('hidden');
        }
    });

    // Folder navigation
    elements.folderList.addEventListener('click', (e) => {
        const li = e.target.closest('li');
        if (li && li.dataset.folder) changeFolder(li.dataset.folder);
    });

    // Label filtering
    elements.labelsList.addEventListener('click', (e) => {
        const li = e.target.closest('li');
        if (li && li.dataset.label) filterByLabel(li.dataset.label);
    });

    // Search
    elements.searchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value;
        state.currentPage = 1;
        renderEmailList();
    });

    // Compose
    elements.newEmailBtn.addEventListener('click', () => elements.composeModal.classList.add('open'));
    elements.closeCompose.addEventListener('click', () => { elements.composeModal.classList.remove('open'); clearComposeForm(); });

    elements.sendEmail.addEventListener('click', () => {
        const to = elements.composeTo.value.trim();
        const subject = elements.composeSubject.value.trim();
        const body = elements.composeBody.value.trim();
        if (to && subject && body) {
            sendNewEmail(to, subject, body);
            elements.composeModal.classList.remove('open');
            clearComposeForm();
        } else {
            alert('Please fill in all fields: To, Subject, and Message.');
        }
    });

    elements.saveDraft.addEventListener('click', () => {
        const subject = elements.composeSubject.value.trim();
        const body = elements.composeBody.value.trim();
        if (subject || body) {
            saveAsDraft(elements.composeTo.value.trim(), subject, body);
            elements.composeModal.classList.remove('open');
            clearComposeForm();
            alert('Draft saved successfully!');
        } else {
            alert('Cannot save empty draft.');
        }
    });

    elements.attachFile.addEventListener('click', () => alert('File attachment functionality would be implemented here.'));
    elements.refreshBtn.addEventListener('click', () => loadEmailData());

    // Pagination
    elements.prevPage.addEventListener('click', () => { if (state.currentPage > 1) { state.currentPage--; renderEmailList(); } });
    elements.nextPage.addEventListener('click', () => { state.currentPage++; renderEmailList(); });

    // Close email view (mobile)
    elements.closeEmailView.addEventListener('click', () => {
        elements.emailViewSection.classList.remove('open');
        state.emailViewOpen = false;
    });

    // Window resize
    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) {
            elements.sidebar.classList.remove('open');
            elements.emailViewSection.classList.remove('open');
            state.sidebarOpen = false;
            state.emailViewOpen = false;
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (elements.composeModal.classList.contains('open')) { elements.composeModal.classList.remove('open'); clearComposeForm(); }
            if (elements.settingsAiPanel.classList.contains('open')) { elements.settingsAiPanel.classList.remove('open'); elements.settingsAiToggle.classList.remove('active'); }
            if (window.innerWidth <= 768 && state.emailViewOpen) { elements.emailViewSection.classList.remove('open'); state.emailViewOpen = false; }
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'n') { e.preventDefault(); elements.composeModal.classList.add('open'); }
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); elements.searchInput.focus(); }
    });
}

// ============================================================
// INITIALIZATION
// ============================================================

async function init() {
    // 1. Initialize core UI
    renderSidebarFolders();
    initEventListeners();
    await loadEmailData();

    // 2. Initialize AI systems
    Renderer.init();
    initSettingsAI();
    initDebugPanel();

    // 3. Start Base AI (behavioral sensing + evaluation loop)
    BaseAI.start();

    console.log('[App] Dual-AI Email Client initialized');
    console.log('[App] Click the robot icon (header) to open Settings AI');
    console.log('[App] Click the bug icon (bottom-left) to open Debug Panel');
}

document.addEventListener('DOMContentLoaded', init);
