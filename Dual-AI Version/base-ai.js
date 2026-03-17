/**
 * ============================================================
 * Base AI Module (LLM-Powered)
 * ============================================================
 * The Base AI combines:
 *   1. Behavioral sensing (mouse, reading, switching, hover)
 *   2. User rules from Settings AI (additional prompt)
 *   → Produces adaptation decisions (declarative JSON config)
 *   → Passed to Renderer for execution
 *
 * LLM Integration Strategy:
 *   - When Settings AI rules change → call LLM for full inference
 *   - Periodic evaluation (15s) → use rule-based logic (saves quota)
 *   - Falls back to rule-based if LLM fails or is disabled
 *
 * Decision output format (always declarative JSON):
 * {
 *   cssVars: { '--font-base': '1.1rem', ... },
 *   components: [ { type: 'summaryPanel', props: {...} } ],
 *   visibility: { sidebar: true, labels: false },
 *   templates: [ { type: 'emailSummary', data: {...} } ],
 *   focusMode: boolean,
 *   reason: [...]
 * }
 * ============================================================
 */

const BaseAI = (() => {

    // ===== Configuration =====
    const config = {
        evaluationInterval: 60000,   // 60 seconds
        sensingEnabled: true,
        debugMode: true,
        // Thresholds
        readingSpeedFast: 300,       // words per minute
        readingSpeedSlow: 100,
        hoverConfusionTime: 3000,    // ms
        switchFrequencyHigh: 5,      // switches per evaluation
    };

    // ===== Behavioral Metrics =====
    let metrics = {
        mouse: {
            totalDistance: 0,
            directionChanges: 0,
            complexity: 0,          // 0-1 scale
            lastX: 0,
            lastY: 0,
            lastAngle: null,
            movements: 0
        },
        reading: {
            currentEmailOpenTime: null,
            currentEmailWordCount: 0,
            readingSpeed: 0,        // words per minute
            pattern: 'normal',      // skimming | normal | deep
            emailsRead: 0
        },
        switching: {
            folderSwitches: 0,
            emailSwitches: 0,
            frequency: 0,           // switches per minute
            pattern: 'systematic',  // erratic | systematic | mixed
            lastSwitchTime: Date.now()
        },
        hover: {
            totalHoverTime: 0,
            confusionEvents: 0,
            hoveredElements: [],
            currentHoverStart: null,
            currentHoverElement: null
        }
    };

    // ===== Settings AI Rules (received via event) =====
    let settingsAIRules = null;
    let settingsAIPrompt = null;

    // ===== State =====
    let evaluationTimer = null;
    let lastDecision = null;
    let isRunning = false;
    let lastApiCallTime = 0;
    let isLLMCallInProgress = false;

    // ===== LLM System Prompt for Base AI =====
    const BASE_AI_SYSTEM_PROMPT = `You are the Base AI for an adaptive email client. You receive user preference rules from the Settings AI and behavioral sensing data, then produce a UI adaptation decision as declarative JSON.

AVAILABLE CSS VARIABLES you can set (use any valid CSS value):
- Font sizes: --font-base, --font-sm, --font-lg, --font-xl, --font-2xl
- Spacing: --spacing-sm, --spacing-md, --spacing-lg, --spacing-xl, --content-padding
- Colors: --bg-primary, --bg-secondary, --bg-tertiary, --text-primary, --text-secondary, --text-muted, --border-color, --primary-color, --primary-hover
- Layout: --sidebar-width, --email-list-max-width, --content-max-width, --line-height

AVAILABLE COMPONENTS:
- summaryPanel: { type: "summaryPanel", props: { title: "string", autoGenerate: boolean } }
- priorityBadges: { type: "priorityBadges", props: { analyze: boolean } }
- infoCard: { type: "infoCard", props: { icon: "string", title: "string", content: "string" } }
- actionBar: { type: "actionBar", props: { buttons: [...] } }

VISIBILITY CONTROLS:
- sidebar: true/false

RESPONSE FORMAT (output ONLY valid JSON, no markdown, no extra text):
{
  "cssVars": { "variable-name": "value", ... },
  "components": [ { "type": "...", "props": {...} } ],
  "visibility": { "sidebar": true/false },
  "focusMode": true/false,
  "reason": ["short explanation of each adaptation"]
}

RULES:
1. Settings AI preferences take top priority.
2. Behavioral data provides additional context for fine-tuning.
3. You can use ANY valid CSS value, not just predefined options. Be creative but reasonable.
4. focusMode dims non-essential areas (sidebar, email list) so user can focus on the email content.
5. Keep "reason" entries short and user-friendly.
6. Output valid JSON only. No markdown code blocks.
7. Include ALL relevant cssVars based on the rules, not just changed ones.`;

    // ============================================================
    // SENSING LAYER
    // ============================================================

    function onMouseMove(e) {
        if (!config.sensingEnabled) return;
        const dx = e.clientX - metrics.mouse.lastX;
        const dy = e.clientY - metrics.mouse.lastY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > 5) {
            metrics.mouse.totalDistance += distance;
            metrics.mouse.movements++;
            const angle = Math.atan2(dy, dx);
            if (metrics.mouse.lastAngle !== null) {
                const angleDiff = Math.abs(angle - metrics.mouse.lastAngle);
                if (angleDiff > Math.PI / 4) {
                    metrics.mouse.directionChanges++;
                }
            }
            metrics.mouse.lastAngle = angle;
            metrics.mouse.lastX = e.clientX;
            metrics.mouse.lastY = e.clientY;
        }
    }

    function onMouseOver(e) {
        if (!config.sensingEnabled) return;
        metrics.hover.currentHoverStart = Date.now();
        metrics.hover.currentHoverElement = e.target.tagName + '.' + e.target.className.split(' ')[0];
    }

    function onMouseOut(e) {
        if (!config.sensingEnabled) return;
        if (metrics.hover.currentHoverStart) {
            const duration = Date.now() - metrics.hover.currentHoverStart;
            metrics.hover.totalHoverTime += duration;
            if (duration > config.hoverConfusionTime) {
                metrics.hover.confusionEvents++;
                metrics.hover.hoveredElements.push({
                    element: metrics.hover.currentHoverElement,
                    duration
                });
            }
            metrics.hover.currentHoverStart = null;
        }
    }

    function onEmailOpened(email) {
        if (metrics.reading.currentEmailOpenTime && metrics.reading.currentEmailWordCount > 0) {
            const timeSpent = (Date.now() - metrics.reading.currentEmailOpenTime) / 60000;
            if (timeSpent > 0.05) {
                metrics.reading.readingSpeed = Math.round(metrics.reading.currentEmailWordCount / timeSpent);
                metrics.reading.emailsRead++;
                if (metrics.reading.readingSpeed > config.readingSpeedFast) {
                    metrics.reading.pattern = 'skimming';
                } else if (metrics.reading.readingSpeed < config.readingSpeedSlow) {
                    metrics.reading.pattern = 'deep';
                } else {
                    metrics.reading.pattern = 'normal';
                }
            }
        }
        metrics.reading.currentEmailOpenTime = Date.now();
        const textContent = email.body.replace(/<[^>]+>/g, ' ').trim();
        metrics.reading.currentEmailWordCount = textContent.split(/\s+/).length;
    }

    function onFolderSwitch() {
        metrics.switching.folderSwitches++;
        recordSwitch();
    }

    function onEmailSwitch() {
        metrics.switching.emailSwitches++;
        recordSwitch();
    }

    function recordSwitch() {
        const now = Date.now();
        const timeSinceLastSwitch = now - metrics.switching.lastSwitchTime;
        metrics.switching.lastSwitchTime = now;
        const totalSwitches = metrics.switching.folderSwitches + metrics.switching.emailSwitches;
        metrics.switching.frequency = totalSwitches;

        if (timeSinceLastSwitch < 2000 && totalSwitches > 3) {
            metrics.switching.pattern = 'erratic';
        } else if (totalSwitches < 3) {
            metrics.switching.pattern = 'systematic';
        } else {
            metrics.switching.pattern = 'mixed';
        }
    }

    function initSensing() {
        document.addEventListener('mousemove', onMouseMove, { passive: true });
        document.addEventListener('mouseover', onMouseOver, { passive: true });
        document.addEventListener('mouseout', onMouseOut, { passive: true });
    }

    // ============================================================
    // LLM INFERENCE
    // ============================================================

    async function inferWithLLM(rules, metricsSnapshot) {
        if (isLLMCallInProgress) {
            console.log('[BaseAI] LLM call already in progress, using rule-based');
            return null;
        }

        const now = Date.now();
        const minInterval = (typeof AI_CONFIG !== 'undefined') ? AI_CONFIG.minRequestInterval : 3000;
        if (now - lastApiCallTime < minInterval) {
            await new Promise(resolve => setTimeout(resolve, minInterval - (now - lastApiCallTime)));
        }

        isLLMCallInProgress = true;
        lastApiCallTime = Date.now();

        try {
            const config_ai = (typeof AI_CONFIG !== 'undefined') ? AI_CONFIG : {};
            const apiKey = config_ai.apiKey || '';
            const endpoint = config_ai.apiEndpoint || 'https://openrouter.ai/api/v1/chat/completions';
            const model = config_ai.model || 'openrouter/hunter-alpha';

            const userMessage = `USER PREFERENCE RULES (from Settings AI):
${JSON.stringify(rules, null, 2)}

BEHAVIORAL SENSING DATA:
${JSON.stringify(metricsSnapshot, null, 2)}

Based on these rules and behavior data, produce the adaptation decision JSON.`;

            if (config_ai.debug) {
                console.log('[BaseAI] LLM Request:', { model, rules, metrics: metricsSnapshot });
            }

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                    'HTTP-Referer': window.location.href,
                    'X-Title': 'Adaptive Email Client - Base AI'
                },
                body: JSON.stringify({
                    model: model,
                    messages: [
                        { role: 'system', content: BASE_AI_SYSTEM_PROMPT },
                        { role: 'user', content: userMessage }
                    ],
                    max_tokens: 800,
                    temperature: 0.2
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API error ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            const content = data.choices?.[0]?.message?.content;

            if (!content) throw new Error('Empty response from API');

            if (config_ai.debug) {
                console.log('[BaseAI] LLM Response:', content);
            }

            // Parse JSON (strip markdown if present)
            let cleaned = content.trim();
            if (cleaned.startsWith('```')) {
                cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
            }

            const decision = JSON.parse(cleaned);

            // Ensure required fields exist
            decision.cssVars = decision.cssVars || {};
            decision.components = decision.components || [];
            decision.visibility = decision.visibility || {};
            decision.reason = decision.reason || [];
            decision.focusMode = !!decision.focusMode;

            return decision;

        } catch (error) {
            console.error('[BaseAI] LLM inference failed:', error);
            return null;
        } finally {
            isLLMCallInProgress = false;
        }
    }

    // ============================================================
    // RULE-BASED INFERENCE (Fallback / Periodic)
    // ============================================================

    function inferRuleBased() {
        const mouseComplexity = metrics.mouse.movements > 0
            ? Math.min(1, metrics.mouse.directionChanges / metrics.mouse.movements)
            : 0;
        metrics.mouse.complexity = mouseComplexity;

        // Always read fresh rules from SettingsAI (not cached settingsAIRules)
        // because Renderer's undo/redo uses setRulesSilent() which doesn't fire events
        const rules = SettingsAI.getRules();

        const decision = {
            cssVars: {},
            components: [],
            visibility: {},
            templates: [],
            reason: [],
            focusMode: false
        };

        // ----- 1. Apply Settings AI preferences -----

        const fontSizeMap = {
            'small': { base: '0.875rem', sm: '0.75rem', lg: '1rem', xl: '1.125rem', '2xl': '1.25rem' },
            'normal': { base: '1rem', sm: '0.875rem', lg: '1.125rem', xl: '1.25rem', '2xl': '1.5rem' },
            'large': { base: '1.15rem', sm: '1rem', lg: '1.25rem', xl: '1.375rem', '2xl': '1.75rem' },
            'x-large': { base: '1.3rem', sm: '1.125rem', lg: '1.4rem', xl: '1.5rem', '2xl': '2rem' }
        };
        const fontConfig = fontSizeMap[rules.fontSize] || fontSizeMap['normal'];
        decision.cssVars['--font-base'] = fontConfig.base;
        decision.cssVars['--font-sm'] = fontConfig.sm;
        decision.cssVars['--font-lg'] = fontConfig.lg;
        decision.cssVars['--font-xl'] = fontConfig.xl;
        decision.cssVars['--font-2xl'] = fontConfig['2xl'];

        if (rules.layoutDensity === 'compact') {
            decision.cssVars['--spacing-md'] = '0.6rem';
            decision.cssVars['--spacing-lg'] = '1rem';
            decision.cssVars['--spacing-xl'] = '1.25rem';
            decision.cssVars['--content-padding'] = '1rem';
            decision.reason.push('Compact layout applied');
        } else if (rules.layoutDensity === 'spacious') {
            decision.cssVars['--spacing-md'] = '1.25rem';
            decision.cssVars['--spacing-lg'] = '2rem';
            decision.cssVars['--spacing-xl'] = '2.5rem';
            decision.cssVars['--content-padding'] = '2.5rem';
            decision.cssVars['--line-height'] = '1.8';
            decision.reason.push('Spacious layout applied');
        }

        decision.visibility.sidebar = rules.sidebarVisible;
        if (!rules.sidebarVisible) {
            decision.reason.push('Sidebar hidden per user preference');
        }

        if (rules.detailLevel === 'low') {
            decision.cssVars['--email-list-max-width'] = '350px';
            decision.reason.push('Minimal detail level');
        } else if (rules.detailLevel === 'high') {
            decision.cssVars['--email-list-max-width'] = '550px';
            decision.reason.push('High detail level');
        }

        if (rules.colorScheme === 'warm') {
            decision.cssVars['--bg-primary'] = '#faf8f5';
            decision.cssVars['--bg-secondary'] = '#f5f0eb';
            decision.cssVars['--bg-tertiary'] = '#ece5db';
            decision.cssVars['--primary-color'] = '#c77b3f';
            decision.cssVars['--primary-hover'] = '#a5632e';
            decision.reason.push('Warm color scheme applied');
        } else if (rules.colorScheme === 'dark') {
            decision.cssVars['--bg-primary'] = '#1e1e2e';
            decision.cssVars['--bg-secondary'] = '#181825';
            decision.cssVars['--bg-tertiary'] = '#313244';
            decision.cssVars['--text-primary'] = '#cdd6f4';
            decision.cssVars['--text-secondary'] = '#a6adc8';
            decision.cssVars['--text-muted'] = '#6c7086';
            decision.cssVars['--border-color'] = '#45475a';
            decision.cssVars['--primary-color'] = '#89b4fa';
            decision.cssVars['--primary-hover'] = '#74c7ec';
            decision.reason.push('Dark theme applied');
        } else if (rules.colorScheme === 'high-contrast') {
            decision.cssVars['--bg-primary'] = '#ffffff';
            decision.cssVars['--text-primary'] = '#000000';
            decision.cssVars['--text-secondary'] = '#333333';
            decision.cssVars['--primary-color'] = '#0000cc';
            decision.cssVars['--border-color'] = '#000000';
            decision.reason.push('High contrast mode applied');
        } else if (rules.colorScheme === 'default') {
            decision.cssVars['--bg-primary'] = '#ffffff';
            decision.cssVars['--bg-secondary'] = '#f8f9fa';
            decision.cssVars['--bg-tertiary'] = '#e9ecef';
            decision.cssVars['--text-primary'] = '#212529';
            decision.cssVars['--text-secondary'] = '#6c757d';
            decision.cssVars['--text-muted'] = '#adb5bd';
            decision.cssVars['--border-color'] = '#dee2e6';
            decision.cssVars['--primary-color'] = '#007bff';
            decision.cssVars['--primary-hover'] = '#0056b3';
        }

        if (rules.readingAssist) {
            decision.cssVars['--line-height'] = '2.0';
            decision.cssVars['--content-max-width'] = '650px';
            decision.reason.push('Reading assistance enabled');
        }

        // ----- Custom CSS overrides from LLM -----
        if (rules.customCssVars && typeof rules.customCssVars === 'object') {
            Object.entries(rules.customCssVars).forEach(([key, value]) => {
                decision.cssVars[key] = value;
            });
            if (Object.keys(rules.customCssVars).length > 0) {
                decision.reason.push('Custom style applied');
            }
        }

        // ----- 2. Behavioral inferences -----
        if (rules.focusMode || metrics.switching.pattern === 'erratic') {
            decision.focusMode = true;
            if (metrics.switching.pattern === 'erratic') {
                decision.reason.push('Focus mode triggered by erratic switching behavior');
            } else {
                decision.reason.push('Focus mode enabled: non-essential areas dimmed, hover to restore');
            }
        } else {
            decision.focusMode = false;
        }

        if (rules.fontSize === 'normal' && metrics.reading.pattern === 'deep' && metrics.reading.readingSpeed > 0 && metrics.reading.readingSpeed < config.readingSpeedSlow) {
            decision.cssVars['--font-base'] = '1.05rem';
            decision.reason.push('Slightly increased font size based on slow reading pattern');
        }

        // ----- 3. Components -----
        if (rules.showSummary) {
            decision.components.push({ type: 'summaryPanel', props: { title: 'AI Summary', autoGenerate: true } });
        }
        if (rules.showPriority) {
            decision.components.push({ type: 'priorityBadges', props: { analyze: true } });
        }

        lastDecision = decision;
        updateDebugDisplay();
        return decision;
    }

    // ============================================================
    // EVALUATION LOOP
    // ============================================================

    /**
     * Evaluate with optional LLM.
     * @param {boolean} useLLM - If true, try LLM inference first
     */
    async function evaluate(useLLM = false) {
        if (!isRunning) return;

        setStatus('sensing');

        setTimeout(async () => {
            setStatus('adapting');

            let decision = null;

            // Try LLM if requested and enabled
            if (useLLM && typeof AI_CONFIG !== 'undefined' && AI_CONFIG.useBaseAI_LLM && AI_CONFIG.apiKey) {
                const rules = SettingsAI.getRules();
                const metricsSnapshot = {
                    mouse: { complexity: metrics.mouse.complexity.toFixed(2), movements: metrics.mouse.movements },
                    reading: { speed: metrics.reading.readingSpeed, pattern: metrics.reading.pattern, emailsRead: metrics.reading.emailsRead },
                    switching: { frequency: metrics.switching.frequency, pattern: metrics.switching.pattern },
                    hover: { confusionEvents: metrics.hover.confusionEvents }
                };

                decision = await inferWithLLM(rules, metricsSnapshot);
            }

            // Fallback to rule-based
            if (!decision) {
                decision = inferRuleBased();
            }

            lastDecision = decision;

            // Send decision to renderer
            window.dispatchEvent(new CustomEvent('baseai:decision', {
                detail: { decision }
            }));

            setTimeout(() => {
                setStatus('adapted');
                resetCycleMetrics();
            }, 500);

        }, 500);
    }

    /**
     * Immediate evaluation (no delay, rule-based only).
     * Used when Settings AI rules change — the LLM already interpreted
     * the user's intent, so we just need to map rules → decision instantly.
     */
    function evaluateImmediate() {
        if (!isRunning) return;

        setStatus('adapting');
        const decision = inferRuleBased();
        lastDecision = decision;

        window.dispatchEvent(new CustomEvent('baseai:decision', {
            detail: { decision }
        }));

        setStatus('adapted');
        resetCycleMetrics();

        // Reset the periodic timer so it doesn't fire right after
        if (evaluationTimer) clearInterval(evaluationTimer);
        evaluationTimer = setInterval(() => evaluate(false), config.evaluationInterval);
    }

    function resetCycleMetrics() {
        metrics.mouse.totalDistance = 0;
        metrics.mouse.directionChanges = 0;
        metrics.mouse.movements = 0;
        metrics.switching.folderSwitches = 0;
        metrics.switching.emailSwitches = 0;
        metrics.hover.confusionEvents = 0;
        metrics.hover.totalHoverTime = 0;
        metrics.hover.hoveredElements = [];
    }

    // ============================================================
    // STATUS & DEBUG
    // ============================================================

    function setStatus(status) {
        const el = document.getElementById('aiStatus');
        const textEl = document.getElementById('aiStatusText');
        if (!el) return;

        el.className = 'ai-status ' + status;
        const statusTexts = {
            'idle': 'AI Idle',
            'sensing': 'Sensing...',
            'adapting': 'Adapting...',
            'adapted': 'Adapted'
        };
        if (textEl) {
            textEl.textContent = statusTexts[status] || 'AI';
        }
    }

    function updateDebugDisplay() {
        const metricsEl = document.getElementById('debugMetrics');
        const decisionEl = document.getElementById('debugDecision');

        if (metricsEl) {
            metricsEl.textContent = JSON.stringify({
                mouse: { complexity: metrics.mouse.complexity.toFixed(2), moves: metrics.mouse.movements },
                reading: { speed: metrics.reading.readingSpeed, pattern: metrics.reading.pattern },
                switching: { freq: metrics.switching.frequency, pattern: metrics.switching.pattern },
                hover: { confusion: metrics.hover.confusionEvents }
            }, null, 2);
        }

        if (decisionEl && lastDecision) {
            decisionEl.textContent = JSON.stringify({
                cssVarsCount: Object.keys(lastDecision.cssVars).length,
                components: lastDecision.components.map(c => c.type),
                visibility: lastDecision.visibility,
                focusMode: lastDecision.focusMode,
                reasons: lastDecision.reason
            }, null, 2);
        }
    }

    // ============================================================
    // LIFECYCLE
    // ============================================================

    function start() {
        isRunning = true;
        initSensing();

        // Listen for Settings AI rule changes → evaluate immediately with rule-based
        // (Settings AI already did the LLM interpretation, no need for a second LLM call)
        window.addEventListener('settingsai:rules-changed', (e) => {
            settingsAIRules = e.detail.rules;
            settingsAIPrompt = SettingsAI.getBaseAIPrompt();
            // Immediate rule-based evaluation, skip the sensing delay
            evaluateImmediate();
        });

        // Start periodic evaluation (rule-based only to save API quota)
        evaluationTimer = setInterval(() => evaluate(false), config.evaluationInterval);

        // Initial evaluation after a short delay (rule-based)
        setTimeout(() => evaluate(false), 2000);

        setStatus('idle');
        console.log('[BaseAI] Started. Evaluation interval:', config.evaluationInterval, 'ms');
        console.log('[BaseAI] LLM enabled:', typeof AI_CONFIG !== 'undefined' && AI_CONFIG.useBaseAI_LLM);
    }

    function stop() {
        isRunning = false;
        if (evaluationTimer) clearInterval(evaluationTimer);
        setStatus('idle');
    }

    // ===== Public API =====
    return {
        start,
        stop,
        evaluate,
        onEmailOpened,
        onFolderSwitch,
        onEmailSwitch,
        getMetrics: () => JSON.parse(JSON.stringify(metrics)),
        getLastDecision: () => lastDecision
    };
})();
