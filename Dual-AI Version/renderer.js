/**
 * ============================================================
 * Universal Renderer Module
 * ============================================================
 * Executes the Base AI's declarative adaptation decisions.
 * This is the ONLY module that touches the DOM for adaptations.
 *
 * Handles four layers:
 *   1. CSS Variables     → document.documentElement.style
 *   2. Components        → Component Registry (pre-defined skeletons)
 *   3. Visibility        → Show/hide major sections
 *   4. Templates         → Fill data into pre-defined templates
 *
 * The AI never generates raw HTML/JS. It always outputs
 * declarative JSON that the Renderer interprets safely.
 * ============================================================
 */

const Renderer = (() => {

    // ===== Previous state for smooth transitions =====
    let previousCssVars = {};
    let activeComponents = {};
    let notificationTimer = null;

    // ===== Decision history for undo/redo =====
    let decisionHistory = [];
    let decisionIndex = -1;
    let hasActiveAdaptation = false;

    // ===== Last decision fingerprint (for diff comparison) =====
    let lastDecisionFingerprint = null;

    // ===== Auto-accept timer =====
    let autoAcceptTimer = null;
    const AUTO_ACCEPT_DELAY = 20000; // 20 seconds

    /**
     * Generate a fingerprint string from a decision object.
     * Used to detect whether a new decision is actually different.
     */
    function getDecisionFingerprint(decision) {
        if (!decision) return '';
        const fp = {
            cssVars: decision.cssVars || {},
            visibility: decision.visibility || {},
            focusMode: !!decision.focusMode,
            components: (decision.components || []).map(c => c.type).sort()
        };
        return JSON.stringify(fp);
    }

    // ============================================================
    // 1. CSS VARIABLE LAYER
    // ============================================================

    function applyCssVars(cssVars) {
        if (!cssVars || Object.keys(cssVars).length === 0) return;

        const root = document.documentElement;
        const changes = [];

        Object.entries(cssVars).forEach(([key, value]) => {
            if (previousCssVars[key] !== value) {
                root.style.setProperty(key, value);
                changes.push(key);
            }
        });

        previousCssVars = { ...previousCssVars, ...cssVars };

        if (changes.length > 0) {
            console.log('[Renderer] CSS vars updated:', changes.length, 'properties');
        }
    }

    function resetCssVars() {
        const root = document.documentElement;
        Object.keys(previousCssVars).forEach(key => {
            root.style.removeProperty(key);
        });
        previousCssVars = {};
    }

    // ============================================================
    // 2. COMPONENT REGISTRY (Pre-defined skeletons)
    // ============================================================

    const componentRegistry = {

        // ----- Summary Panel -----
        summaryPanel: {
            render(props, context) {
                // Remove existing
                this.destroy();

                const slot = document.getElementById('componentSlot');
                if (!slot) return;

                const panel = document.createElement('div');
                panel.className = 'ai-component-summary-panel';
                panel.id = 'aiSummaryPanel';

                // Generate summary based on current email
                const email = context?.currentEmail;
                let summaryText = 'Select an email to see its AI summary.';
                let readingTime = '';
                let keyPoints = '';

                if (email) {
                    const textContent = email.body.replace(/<[^>]+>/g, ' ').trim();
                    const wordCount = textContent.split(/\s+/).length;
                    const minutes = Math.max(1, Math.round(wordCount / 200));
                    readingTime = `${minutes} min read`;

                    // Simple rule-based summary (would be LLM in production)
                    summaryText = generateSimpleSummary(email);
                    keyPoints = detectKeyPoints(email);
                }

                panel.innerHTML = `
                    <div class="panel-header">
                        <span><i class="fas fa-brain"></i> AI Summary</span>
                        <button onclick="Renderer.destroyComponent('summaryPanel')" style="background:none;border:none;cursor:pointer;color:#667eea;font-size:12px;">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="panel-body">
                        <p>${summaryText}</p>
                        ${keyPoints ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border-color);">${keyPoints}</div>` : ''}
                    </div>
                    <div class="panel-footer">
                        <span>${readingTime}</span>
                        <span style="opacity:0.6">AI Generated</span>
                    </div>
                `;

                slot.appendChild(panel);
                activeComponents['summaryPanel'] = panel;
            },

            destroy() {
                const existing = document.getElementById('aiSummaryPanel');
                if (existing) existing.remove();
                delete activeComponents['summaryPanel'];
            },

            update(context) {
                // Re-render with new context
                this.render({}, context);
            }
        },

        // ----- Priority Badges -----
        priorityBadges: {
            render(props, context) {
                // Add priority badges to email list items
                const emailItems = document.querySelectorAll('.email-item');
                const emails = context?.emails || [];

                emailItems.forEach(item => {
                    // Remove existing badges
                    const existing = item.querySelector('.ai-component-priority-badge');
                    if (existing) existing.remove();

                    const emailId = parseInt(item.dataset.emailId);
                    const email = emails.find(e => e.id === emailId);
                    if (!email) return;

                    const priority = analyzePriority(email);
                    if (priority.level !== 'none') {
                        const badge = document.createElement('span');
                        badge.className = `ai-component-priority-badge ${priority.level}`;
                        badge.innerHTML = `<i class="fas fa-flag"></i> ${priority.label}`;
                        badge.title = priority.reason;

                        const metaEl = item.querySelector('.email-meta');
                        if (metaEl) {
                            metaEl.insertBefore(badge, metaEl.firstChild);
                        }
                    }
                });

                activeComponents['priorityBadges'] = true;
            },

            destroy() {
                document.querySelectorAll('.ai-component-priority-badge').forEach(el => el.remove());
                delete activeComponents['priorityBadges'];
            },

            update(context) {
                this.render({}, context);
            }
        },

        // ----- Info Card (inline above email body) -----
        infoCard: {
            render(props, context) {
                this.destroy();

                const emailBody = document.querySelector('.email-body');
                if (!emailBody) return;

                const card = document.createElement('div');
                card.className = 'ai-component-info-card';
                card.id = 'aiInfoCard';
                card.innerHTML = `
                    <i class="fas fa-${props.icon || 'info-circle'}"></i>
                    <div>
                        <strong>${props.title || 'Note'}</strong>
                        <p style="margin:4px 0 0;font-size:12px;">${props.content || ''}</p>
                    </div>
                `;

                emailBody.parentElement.insertBefore(card, emailBody);
                activeComponents['infoCard'] = card;
            },

            destroy() {
                const existing = document.getElementById('aiInfoCard');
                if (existing) existing.remove();
                delete activeComponents['infoCard'];
            }
        },

        // ----- Quick Action Bar -----
        actionBar: {
            render(props, context) {
                this.destroy();

                const slot = document.getElementById('componentSlot');
                if (!slot) return;

                const bar = document.createElement('div');
                bar.className = 'ai-component-action-bar';
                bar.id = 'aiActionBar';

                const buttons = props.buttons || [
                    { icon: 'fa-reply', label: 'Reply', action: 'reply' },
                    { icon: 'fa-archive', label: 'Archive', action: 'archive' },
                    { icon: 'fa-star', label: 'Star', action: 'star' }
                ];

                bar.innerHTML = buttons.map(btn =>
                    `<button onclick="Renderer.handleAction('${btn.action}')">
                        <i class="fas ${btn.icon}"></i> ${btn.label}
                    </button>`
                ).join('');

                slot.appendChild(bar);
                activeComponents['actionBar'] = bar;
            },

            destroy() {
                const existing = document.getElementById('aiActionBar');
                if (existing) existing.remove();
                delete activeComponents['actionBar'];
            }
        }
    };

    // ============================================================
    // 3. VISIBILITY CONTROL
    // ============================================================

    function applyVisibility(visibility) {
        if (!visibility) return;

        if (visibility.sidebar !== undefined) {
            const sidebar = document.getElementById('sidebar');
            if (sidebar) {
                if (visibility.sidebar) {
                    sidebar.classList.remove('hidden');
                } else {
                    sidebar.classList.add('hidden');
                }
            }
        }
    }

    // ============================================================
    // 4. TEMPLATE RENDERING
    // ============================================================

    const templates = {
        emailSummary: (data) => `
            <div class="ai-template-summary">
                <p>${data.summary || 'No summary available.'}</p>
                ${data.keyPoints ? `<ul>${data.keyPoints.map(p => `<li>${p}</li>`).join('')}</ul>` : ''}
            </div>
        `,

        todoList: (data) => `
            <div class="ai-template-todo">
                <h4>${data.title || 'Action Items'}</h4>
                <ul>
                    ${(data.items || []).map(item =>
                        `<li style="${item.done ? 'text-decoration:line-through;opacity:0.6' : ''}">${item.text}</li>`
                    ).join('')}
                </ul>
            </div>
        `
    };

    function applyTemplates(templateList) {
        if (!templateList || templateList.length === 0) return;

        templateList.forEach(tmpl => {
            const templateFn = templates[tmpl.type];
            if (templateFn) {
                const html = templateFn(tmpl.data);
                const target = document.querySelector(tmpl.target || '#componentSlot');
                if (target) {
                    const wrapper = document.createElement('div');
                    wrapper.innerHTML = html;
                    target.appendChild(wrapper.firstElementChild);
                }
            }
        });
    }

    // ============================================================
    // HELPER FUNCTIONS
    // ============================================================

    function generateSimpleSummary(email) {
        const text = email.body.replace(/<[^>]+>/g, ' ').trim();
        const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);

        if (sentences.length === 0) return 'This email has minimal content.';

        // Take first 2 meaningful sentences
        const summary = sentences.slice(0, 2).map(s => s.trim()).join('. ') + '.';
        return summary;
    }

    function detectKeyPoints(email) {
        const text = email.body.replace(/<[^>]+>/g, ' ').toLowerCase();
        const points = [];

        if (/deadline|due|by\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d)/.test(text)) {
            points.push('<span style="color:#dc3545"><i class="fas fa-clock"></i> Contains deadline</span>');
        }
        if (/meeting|call|sync|conference|agenda/.test(text)) {
            points.push('<span style="color:#007bff"><i class="fas fa-calendar"></i> Meeting related</span>');
        }
        if (/\?/.test(email.body)) {
            points.push('<span style="color:#ffc107"><i class="fas fa-question-circle"></i> Contains questions</span>');
        }
        if (/attach|file|document|download/.test(text)) {
            points.push('<span style="color:#28a745"><i class="fas fa-paperclip"></i> Mentions attachments</span>');
        }
        if (/action|todo|task|please|need you to/.test(text)) {
            points.push('<span style="color:#e83e8c"><i class="fas fa-tasks"></i> Action required</span>');
        }

        return points.length > 0
            ? `<div style="display:flex;flex-wrap:wrap;gap:8px;font-size:11px">${points.join('')}</div>`
            : '';
    }

    function analyzePriority(email) {
        let score = 0;
        const reasons = [];

        // Unread emails get a slight boost
        if (email.unread) { score += 1; reasons.push('Unread'); }

        // Important label
        if (email.labels && email.labels.includes('Important')) {
            score += 3; reasons.push('Labeled Important');
        }

        // Meeting-related
        if (email.labels && email.labels.includes('Meetings')) {
            score += 2; reasons.push('Meeting');
        }

        // Deadline keywords in subject/snippet
        const text = (email.subject + ' ' + email.snippet).toLowerCase();
        if (/urgent|deadline|asap|immediate|important/.test(text)) {
            score += 3; reasons.push('Urgent keywords');
        }
        if (/reminder|don't forget|action required/.test(text)) {
            score += 2; reasons.push('Action needed');
        }

        if (score >= 4) return { level: 'high', label: 'High', reason: reasons.join(', ') };
        if (score >= 2) return { level: 'medium', label: 'Med', reason: reasons.join(', ') };
        if (score >= 1) return { level: 'low', label: 'Low', reason: reasons.join(', ') };
        return { level: 'none', label: '', reason: '' };
    }

    // ============================================================
    // MAIN EXECUTION
    // ============================================================

    /**
     * Execute a full adaptation decision from the Base AI.
     * This is the single entry point for all UI changes.
     */
    function execute(decision, context, skipHistory) {
        if (!decision) return;

        // ===== DIFF CHECK: skip if decision hasn't actually changed =====
        if (!skipHistory) {
            const newFingerprint = getDecisionFingerprint(decision);
            if (newFingerprint === lastDecisionFingerprint) {
                console.log('[Renderer] Decision unchanged, skipping');
                return;
            }
            lastDecisionFingerprint = newFingerprint;

            // Save to history: decision + Settings AI rules snapshot
            decisionHistory = decisionHistory.slice(0, decisionIndex + 1);
            decisionHistory.push({
                decision: JSON.parse(JSON.stringify(decision)),
                context,
                settingsRules: SettingsAI.getRules()   // snapshot of rules at this point
            });
            decisionIndex = decisionHistory.length - 1;
        }

        console.log('[Renderer] Executing decision:', decision.reason?.join(', ') || 'update');

        // 1. CSS Variables
        applyCssVars(decision.cssVars);

        // 2. Visibility
        applyVisibility(decision.visibility);

        // 3. Focus mode: apply CSS classes for dimming + hover restore
        applyFocusMode(decision);

        // 4. Components
        if (decision.components) {
            const requestedTypes = decision.components.map(c => c.type);
            Object.keys(activeComponents).forEach(type => {
                if (!requestedTypes.includes(type)) {
                    const comp = componentRegistry[type];
                    if (comp) comp.destroy();
                }
            });

            decision.components.forEach(comp => {
                const registry = componentRegistry[comp.type];
                if (registry) {
                    if (activeComponents[comp.type]) {
                        registry.update(context);
                    } else {
                        registry.render(comp.props || {}, context);
                    }
                }
            });
        }

        // 5. Templates
        if (decision.templates) {
            applyTemplates(decision.templates);
        }

        // Show notification only when state truly changed (persistent until user acts)
        if (decision.reason && decision.reason.length > 0) {
            hasActiveAdaptation = true;
            showNotification(decision.reason.join(' | '));
            updateResetButtonVisibility();
            updateUndoRedoState();
        }
    }

    // ============================================================
    // FOCUS MODE (class-based dimming + hover restore)
    // ============================================================

    function applyFocusMode(decision) {
        const sidebar = document.getElementById('sidebar');
        const emailList = document.querySelector('.email-list-section');
        const emailView = document.getElementById('emailViewSection');

        if (!sidebar || !emailList || !emailView) return;

        // Check if focus mode is active (either via CSS var hint or direct flag)
        const isFocusMode = decision.focusMode ||
            (decision.cssVars && (
                decision.cssVars['--non-essential-opacity'] === '0.6' ||
                decision.cssVars['--non-essential-opacity'] === '0.3'
            ));

        if (isFocusMode) {
            sidebar.classList.add('focus-dimmed');
            emailList.classList.add('focus-dimmed');
            emailView.classList.add('focus-highlighted');
            // Override CSS vars so class-based approach takes control
            document.documentElement.style.setProperty('--non-essential-opacity', '1');
            document.documentElement.style.setProperty('--non-essential-blur', '0px');
            document.documentElement.style.setProperty('--sidebar-opacity', '1');
        } else {
            sidebar.classList.remove('focus-dimmed');
            emailList.classList.remove('focus-dimmed');
            emailView.classList.remove('focus-highlighted');
        }
    }

    function clearFocusMode() {
        document.getElementById('sidebar')?.classList.remove('focus-dimmed');
        document.querySelector('.email-list-section')?.classList.remove('focus-dimmed');
        document.getElementById('emailViewSection')?.classList.remove('focus-highlighted');
    }

    // ============================================================
    // NOTIFICATIONS (persistent until user interacts)
    // ============================================================

    function showNotification(message) {
        const notification = document.getElementById('adaptationNotification');
        const messageEl = document.getElementById('adaptationMessage');
        if (!notification || !messageEl) return;

        messageEl.textContent = message;
        notification.classList.add('show');

        // Start auto-accept countdown (20s)
        startAutoAcceptTimer();
    }

    function hideNotification() {
        const notification = document.getElementById('adaptationNotification');
        if (notification) notification.classList.remove('show');
        clearAutoAcceptTimer();
    }

    function startAutoAcceptTimer() {
        clearAutoAcceptTimer();
        autoAcceptTimer = setTimeout(() => {
            console.log('[Renderer] Auto-accepting after 20s of inactivity');
            hideNotification();
        }, AUTO_ACCEPT_DELAY);
    }

    function clearAutoAcceptTimer() {
        if (autoAcceptTimer) {
            clearTimeout(autoAcceptTimer);
            autoAcceptTimer = null;
        }
    }

    // ============================================================
    // UNDO / REDO
    // ============================================================

    function undo() {
        if (decisionIndex <= 0) return;
        decisionIndex--;

        // Reset visual state first
        resetCssVars();
        clearFocusMode();

        if (decisionIndex < 0) {
            // Back to default: clear all visuals but keep history for redo
            const sidebar = document.getElementById('sidebar');
            if (sidebar) sidebar.classList.remove('hidden');
            Object.keys(activeComponents).forEach(type => {
                const comp = componentRegistry[type];
                if (comp) comp.destroy();
            });
            activeComponents = {};
            // Restore Settings AI to default rules (silently, no re-eval)
            SettingsAI.setRulesSilent(SettingsAI.getDefaultRules());
            syncSettingsUI();
            showNotification('Reverted to default state');
        } else {
            // Replay the previous decision
            const prev = decisionHistory[decisionIndex];
            if (prev) {
                execute(prev.decision, prev.context, true);
                // Restore Settings AI rules to this snapshot (silently)
                if (prev.settingsRules) {
                    SettingsAI.setRulesSilent(prev.settingsRules);
                }
            }
            syncSettingsUI();
            showNotification('Undo: reverted to previous state');
        }

        // Update fingerprint to match current state
        if (decisionIndex >= 0 && decisionHistory[decisionIndex]) {
            lastDecisionFingerprint = getDecisionFingerprint(decisionHistory[decisionIndex].decision);
        } else {
            lastDecisionFingerprint = null;
        }

        updateUndoRedoState();
    }

    function redo() {
        if (decisionIndex >= decisionHistory.length - 1) return;
        decisionIndex++;

        const next = decisionHistory[decisionIndex];
        if (next) {
            execute(next.decision, next.context, true);
            // Restore Settings AI rules to this snapshot (silently)
            if (next.settingsRules) {
                SettingsAI.setRulesSilent(next.settingsRules);
            }
            syncSettingsUI();
            lastDecisionFingerprint = getDecisionFingerprint(next.decision);
            showNotification('Redo: ' + (next.decision.reason?.join(' | ') || 'restored'));
        }

        updateUndoRedoState();
    }

    /**
     * Sync the Settings AI panel UI to match the current SettingsAI rules.
     * Updates preset buttons active state + rules chip display.
     * Called after undo/redo to keep the panel in sync.
     */
    function syncSettingsUI() {
        const rules = SettingsAI.getRules();

        // Update preset buttons
        document.querySelectorAll('.preset-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.preset === rules.activePreset);
        });

        // Update rules chip display (call the app's function if available)
        if (typeof updateRulesDisplay === 'function') {
            updateRulesDisplay();
        }
    }

    function updateUndoRedoState() {
        const undoBtn = document.getElementById('undoAdaptation');
        const redoBtn = document.getElementById('redoAdaptation');
        if (undoBtn) undoBtn.disabled = decisionIndex <= 0;
        if (redoBtn) redoBtn.disabled = decisionIndex >= decisionHistory.length - 1;
    }

    function updateResetButtonVisibility() {
        const resetBtn = document.getElementById('resetInterface');
        if (resetBtn) {
            if (hasActiveAdaptation) {
                resetBtn.classList.add('visible');
            } else {
                resetBtn.classList.remove('visible');
            }
        }
    }

    // ============================================================
    // COMPONENT ACTIONS
    // ============================================================

    function handleAction(action) {
        console.log('[Renderer] Action triggered:', action);
        // These would integrate with the main app logic
        window.dispatchEvent(new CustomEvent('renderer:action', {
            detail: { action }
        }));
    }

    function destroyComponent(type) {
        const comp = componentRegistry[type];
        if (comp) comp.destroy();
    }

    // ============================================================
    // UPDATE COMPONENTS (when email selection changes)
    // ============================================================

    function updateComponents(context) {
        Object.keys(activeComponents).forEach(type => {
            const comp = componentRegistry[type];
            if (comp && comp.update) {
                comp.update(context);
            }
        });
    }

    // ============================================================
    // RESET
    // ============================================================

    function reset() {
        resetCssVars();
        clearFocusMode();
        Object.keys(activeComponents).forEach(type => {
            const comp = componentRegistry[type];
            if (comp) comp.destroy();
        });
        activeComponents = {};
    }

    /**
     * Full reset: clears EVERYTHING including history.
     * Only used by the "Reset Interface" button.
     */
    function fullReset() {
        reset();
        hideNotification();
        hasActiveAdaptation = false;
        decisionHistory = [];
        decisionIndex = -1;
        lastDecisionFingerprint = null;
        updateResetButtonVisibility();
        updateUndoRedoState();
        // Also reset sidebar visibility
        const sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.classList.remove('hidden');
    }

    // ============================================================
    // INITIALIZATION
    // ============================================================

    function init() {
        // Listen for Base AI decisions
        window.addEventListener('baseai:decision', (e) => {
            const decision = e.detail.decision;
            const context = window.AppContext ? window.AppContext.getContext() : {};
            execute(decision, context);
        });

        // Undo button
        document.getElementById('undoAdaptation')?.addEventListener('click', () => {
            undo();
        });

        // Redo button
        document.getElementById('redoAdaptation')?.addEventListener('click', () => {
            redo();
        });

        // Accept button: hide notification, keep current state
        document.getElementById('acceptAdaptation')?.addEventListener('click', () => {
            hideNotification();
        });

        // Reset Interface button: clear everything
        document.getElementById('resetInterface')?.addEventListener('click', () => {
            fullReset();
            // Reset Settings AI rules silently (no re-evaluation triggered)
            SettingsAI.setRulesSilent(SettingsAI.getDefaultRules());
            syncSettingsUI();
        });

        // Initial undo/redo state
        updateUndoRedoState();
        updateResetButtonVisibility();

        console.log('[Renderer] Initialized');
    }

    // ===== Public API =====
    return {
        init,
        execute,
        reset,
        fullReset,
        undo,
        redo,
        updateComponents,
        showNotification,
        hideNotification,
        handleAction,
        destroyComponent,
        getActiveComponents: () => Object.keys(activeComponents)
    };
})();
