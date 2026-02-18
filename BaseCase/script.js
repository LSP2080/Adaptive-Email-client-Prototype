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
    saveDraft: document.getElementById('saveDraft')
};

// ===== Utility Functions =====
function truncateText(text, maxLength = 100) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

function formatDate(dateString) {
    if (!dateString) return 'Unknown date';

    // 如果已经是格式化的日期字符串
    if (typeof dateString === 'string' && dateString.includes(' ')) {
        return dateString;
    }

    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) {
            return dateString;
        }

        const now = new Date();
        const diffMs = now - date;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays === 0) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (diffDays === 1) {
            return 'Yesterday';
        } else if (diffDays < 7) {
            return date.toLocaleDateString([], { weekday: 'short' });
        } else {
            return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
        }
    } catch (error) {
        return dateString;
    }
}

function getSenderInitials(sender) {
    if (!sender) return '??';
    const parts = sender.split(' ');
    if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return sender.substring(0, 2).toUpperCase();
}

// ===== Folder Management =====
function updateFolderCounts() {
    // Reset counts
    Object.keys(state.folders).forEach(folder => {
        state.folders[folder].count = 0;
        state.folders[folder].unread = 0;
    });

    // Calculate counts
    state.emails.forEach(email => {
        const folder = state.folders[email.folder];
        if (folder) {
            folder.count++;
            if (email.unread) {
                folder.unread++;
            }
        }

        // Starred folder (special case - spans all folders)
        if (email.starred) {
            state.folders.starred.count++;
            if (email.unread) {
                state.folders.starred.unread++;
            }
        }
    });

    renderFolderCounts();
}

function renderFolderCounts() {
    // Remove all existing badges
    document.querySelectorAll('.folder-nav li .badge').forEach(badge => {
        badge.remove();
    });

    // Add badges for each folder
    Object.keys(state.folders).forEach(folderKey => {
        const folder = state.folders[folderKey];
        const folderItems = document.querySelectorAll('.folder-nav li');

        folderItems.forEach(li => {
            const span = li.querySelector('span:first-of-type');
            if (span && span.textContent.trim() === folder.name) {
                // Create badge conditions
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
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();

        // Process and validate data
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

        // Select first email if available
        if (state.emails.length > 0) {
            setTimeout(() => selectEmail(state.emails[0].id), 100);
        }

    } catch (error) {
        console.error('Error loading email data:', error);
        loadFallbackData();
    }
}

function loadFallbackData() {
    state.emails = [
        {
            id: 1,
            sender: "System Administrator",
            senderInitials: "SA",
            email: "admin@system.com",
            subject: "Welcome to Email Client",
            snippet: "This is a sample email to demonstrate the functionality of the email client...",
            body: `<p>Welcome to the email client prototype!</p>
                   <p>This is a demonstration email showing how the system works.</p>
                   <p>You can:</p>
                   <ul>
                     <li>Read emails in the preview pane</li>
                     <li>Compose new emails</li>
                     <li>Search through your mailbox</li>
                     <li>Organize emails with folders</li>
                   </ul>
                   <p>Enjoy using the system!</p>`,
            time: "Just now",
            date: new Date().toISOString().split('T')[0],
            unread: true,
            starred: false,
            folder: "inbox",
            labels: ["Important"]
        }
    ];
    updateFolderCounts();
    renderEmailList();
    selectEmail(1);
}

// ===== Rendering Functions =====
function renderEmailList() {
    // Filter emails based on current folder and search query
    const filteredEmails = state.emails.filter(email => {
        // Folder filtering
        if (state.currentFolder === 'starred') {
            if (!email.starred) return false;
        } else if (state.currentFolder !== 'all' && email.folder !== state.currentFolder) {
            return false;
        }

        // Search filtering
        if (state.searchQuery) {
            const query = state.searchQuery.toLowerCase();
            return email.sender.toLowerCase().includes(query) ||
                email.subject.toLowerCase().includes(query) ||
                email.snippet.toLowerCase().includes(query) ||
                (email.labels && email.labels.some(label =>
                    label.toLowerCase().includes(query)));
        }

        return true;
    });

    // Clear list
    elements.emailList.innerHTML = '';

    if (filteredEmails.length === 0) {
        elements.emailList.innerHTML = `
            <div class="no-emails-found">
                <i class="fas fa-inbox"></i>
                <h3>No emails found</h3>
                <p>${state.searchQuery ? 'Try a different search term' : 'No emails in this folder'}</p>
            </div>
        `;
        return;
    }

    // Calculate pagination
    const startIndex = (state.currentPage - 1) * state.emailsPerPage;
    const endIndex = startIndex + state.emailsPerPage;
    const paginatedEmails = filteredEmails.slice(startIndex, endIndex);

    // Render email items
    paginatedEmails.forEach(email => {
        const emailItem = document.createElement('div');
        emailItem.className = `email-item ${email.unread ? 'unread' : ''} ${state.selectedEmailId === email.id ? 'selected' : ''}`;
        emailItem.dataset.emailId = email.id;

        // Generate labels HTML
        const labelsHTML = email.labels && email.labels.length > 0 ?
            `<div class="email-labels">
                ${email.labels.map(label =>
                `<span class="label-tag" data-label="${label}">${label}</span>`
            ).join('')}
            </div>` :
            '';

        emailItem.innerHTML = `
            <div class="email-checkbox">
                <input type="checkbox">
            </div>
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
            </div>
        `;

        // Click event
        emailItem.addEventListener('click', (e) => {
            if (!e.target.classList.contains('email-star') &&
                !e.target.classList.contains('label-tag')) {
                selectEmail(email.id);
            }
        });

        // Label click event
        emailItem.querySelectorAll('.label-tag').forEach(tag => {
            tag.addEventListener('click', (e) => {
                e.stopPropagation();
                const label = tag.dataset.label;
                filterByLabel(label);
            });
        });

        // Star click event
        const star = emailItem.querySelector('.email-star');
        star.addEventListener('click', (e) => {
            e.stopPropagation();
            const emailId = parseInt(star.dataset.emailId);
            toggleStar(emailId);
        });

        elements.emailList.appendChild(emailItem);
    });

    updatePaginationInfo(filteredEmails.length);
}

function renderEmailView(emailId) {
    const email = state.emails.find(e => e.id === emailId);

    if (!email) {
        elements.emailViewContent.innerHTML = `
            <div class="no-email-selected">
                <i class="fas fa-envelope-open-text"></i>
                <h3>No Email Selected</h3>
                <p>Select an email from the list to read it here</p>
            </div>
        `;
        return;
    }

    // Mark as read
    if (email.unread) {
        email.unread = false;
        updateFolderCounts();
        renderEmailList();
    }

    // Generate labels HTML
    const labelsHTML = email.labels && email.labels.length > 0 ?
        `<div class="email-labels-view">
            ${email.labels.map(label =>
            `<span class="label-tag-view" data-label="${label}">${label}</span>`
        ).join('')}
        </div>` :
        '';

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
                    <div>
                        <span>To: Me</span>
                        ${labelsHTML}
                    </div>
                    <div>${formatDate(email.date)} • ${email.time}</div>
                </div>
            </div>
            <div class="email-body">
                ${email.body}
            </div>
        </div>
    `;

    // Show email view on mobile
    if (window.innerWidth <= 768) {
        elements.emailViewSection.classList.add('open');
        state.emailViewOpen = true;
    }
}

function renderSidebarFolders() {
    elements.folderList.innerHTML = '';

    Object.keys(state.folders).forEach(folderKey => {
        const folder = state.folders[folderKey];
        const li = document.createElement('li');
        li.dataset.folder = folderKey;
        li.innerHTML = `
            <i class="fas ${folder.icon}"></i>
            <span>${folder.name}</span>
        `;

        // Set active state
        if (folderKey === state.currentFolder) {
            li.classList.add('active');
        }

        elements.folderList.appendChild(li);
    });

    updateFolderCounts();
}

// ===== State Operations =====
function selectEmail(emailId) {
    state.selectedEmailId = emailId;
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
    state.currentPage = 1; // Reset to first page

    // Update sidebar active state
    document.querySelectorAll('.folder-nav li').forEach(li => {
        li.classList.remove('active');
        if (li.dataset.folder === folder) {
            li.classList.add('active');
        }
    });

    renderEmailList();
    renderEmailView(null);

    // Close sidebar on mobile
    if (window.innerWidth <= 768) {
        elements.sidebar.classList.remove('open');
        state.sidebarOpen = false;
    }
}

function sendNewEmail(to, subject, body) {
    // 提取收件人信息
    let recipientEmail = to;
    let recipientName = to;

    const emailMatch = to.match(/<(.+?)>/);
    if (emailMatch) {
        recipientEmail = emailMatch[1];
        recipientName = to.replace(/<.+?>/, '').trim();
    } else if (to.includes('@')) {
        recipientEmail = to;
        recipientName = to.split('@')[0];
    }

    const newEmail = {
        id: Date.now(),
        sender: "John Doe", // 改为实际用户名
        senderInitials: "JD", // 改为用户实际首字母
        email: "john@example.com", // 改为用户实际邮箱
        to: recipientEmail,
        toName: recipientName,
        subject: subject || 'No Subject',
        snippet: truncateText(body, 50) || '',
        body: `<p>${(body || '').replace(/\n/g, '</p><p>')}</p>`,
        time: "Just now",
        date: new Date().toISOString().split('T')[0],
        unread: false,
        starred: false,
        folder: "sent",
        labels: []
    };

    state.emails.unshift(newEmail);
    updateFolderCounts();
    changeFolder('sent');
    selectEmail(newEmail.id);

    return newEmail;
}

function saveAsDraft(to, subject, body) {
    const draftEmail = {
        id: Date.now(),
        sender: "Me",
        senderInitials: "ME",
        email: "me@example.com",
        to: to,
        subject: subject || 'No Subject',
        snippet: truncateText(body, 50) || '(Draft)',
        body: `<p>${(body || '').replace(/\n/g, '</p><p>')}</p>`,
        time: "Just now",
        date: new Date().toISOString().split('T')[0],
        unread: false,
        starred: false,
        folder: "drafts",
        labels: ["Draft"]
    };

    state.emails.unshift(draftEmail);
    updateFolderCounts();
    changeFolder('drafts');

    return draftEmail;
}

// ===== UI Helpers =====
function updatePaginationInfo(totalEmails) {
    const start = (state.currentPage - 1) * state.emailsPerPage + 1;
    const end = Math.min(state.currentPage * state.emailsPerPage, totalEmails);
    elements.paginationInfo.textContent = `${start}-${end} of ${totalEmails}`;

    // Update button states
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

// ===== Event Listeners =====
function initEventListeners() {
    // Sidebar toggle
    elements.menuToggle.addEventListener('click', () => {
        if (window.innerWidth <= 768) {
            // 移动端：滑动侧边栏
            state.sidebarOpen = !state.sidebarOpen;
            elements.sidebar.classList.toggle('open', state.sidebarOpen);

            // 移动端：更新图标提示文本，但图标保持不变
            if (state.sidebarOpen) {
                elements.menuToggle.title = 'Close Sidebar';
            } else {
                elements.menuToggle.title = 'Open Sidebar';
            }
        } else {
            // 桌面端：完全隐藏/显示侧边栏
            elements.sidebar.classList.toggle('hidden');

            // 桌面端：更新图标提示文本，图标保持不变
            if (elements.sidebar.classList.contains('hidden')) {
                elements.menuToggle.title = 'Show Sidebar';
            } else {
                elements.menuToggle.title = 'Hide Sidebar';
            }
        }
    });

    // Folder navigation
    elements.folderList.addEventListener('click', (e) => {
        const li = e.target.closest('li');
        if (li && li.dataset.folder) {
            changeFolder(li.dataset.folder);
        }
    });

    // Label filtering
    elements.labelsList.addEventListener('click', (e) => {
        const li = e.target.closest('li');
        if (li && li.dataset.label) {
            filterByLabel(li.dataset.label);
        }
    });

    // Search
    elements.searchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value;
        state.currentPage = 1;
        renderEmailList();
    });

    // Compose email
    elements.newEmailBtn.addEventListener('click', () => {
        elements.composeModal.classList.add('open');
    });

    // Close compose modal
    elements.closeCompose.addEventListener('click', () => {
        elements.composeModal.classList.remove('open');
        clearComposeForm();
    });

    // Send email
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

    // Save draft
    elements.saveDraft.addEventListener('click', () => {
        const to = elements.composeTo.value.trim();
        const subject = elements.composeSubject.value.trim();
        const body = elements.composeBody.value.trim();

        if (subject || body) {
            saveAsDraft(to, subject, body);
            elements.composeModal.classList.remove('open');
            clearComposeForm();
            alert('Draft saved successfully!');
        } else {
            alert('Cannot save empty draft.');
        }
    });

    // Attach file
    elements.attachFile.addEventListener('click', () => {
        alert('File attachment functionality would be implemented here.');
    });

    // Refresh button
    elements.refreshBtn.addEventListener('click', () => {
        loadEmailData();
    });

    // Pagination
    elements.prevPage.addEventListener('click', () => {
        if (state.currentPage > 1) {
            state.currentPage--;
            renderEmailList();
        }
    });

    elements.nextPage.addEventListener('click', () => {
        state.currentPage++;
        renderEmailList();
    });

    // Close email view on mobile
    elements.closeEmailView.addEventListener('click', () => {
        elements.emailViewSection.classList.remove('open');
        state.emailViewOpen = false;
    });

    // Click outside email view to close (mobile)
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768 &&
            state.emailViewOpen &&
            !elements.emailViewSection.contains(e.target) &&
            !e.target.closest('.email-item')) {
            elements.emailViewSection.classList.remove('open');
            state.emailViewOpen = false;
        }
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
        // Escape key closes modals
        if (e.key === 'Escape') {
            if (elements.composeModal.classList.contains('open')) {
                elements.composeModal.classList.remove('open');
                clearComposeForm();
            }
            if (window.innerWidth <= 768 && state.emailViewOpen) {
                elements.emailViewSection.classList.remove('open');
                state.emailViewOpen = false;
            }
        }

        // Ctrl/Cmd + N for new email
        if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
            e.preventDefault();
            elements.composeModal.classList.add('open');
        }

        // Ctrl/Cmd + F for search
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
            e.preventDefault();
            elements.searchInput.focus();
        }
    });
}

// ===== Initialization =====
async function init() {
    renderSidebarFolders();
    initEventListeners();
    await loadEmailData();
}

// ===== Start Application =====
document.addEventListener('DOMContentLoaded', init);