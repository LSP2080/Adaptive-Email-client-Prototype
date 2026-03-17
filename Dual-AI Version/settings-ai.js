/**
 * ============================================================
 * Settings AI Module (LLM-Powered)
 * ============================================================
 * The Settings AI accepts natural language user input and
 * translates it into structured "user rules" (JSON config).
 * These rules become an additional prompt/context for the
 * Base AI, guiding its adaptation decisions.
 *
 * Architecture:
 *   User Input (natural language)
 *       → Settings AI (LLM API call via OpenRouter)
 *           → Structured User Rules (JSON)
 *               → Fed to Base AI as extra prompt
 *
 * Falls back to keyword-based parsing if LLM is disabled
 * or if the API call fails.
 * ============================================================
 */

const SettingsAI = (() => {
    // ===== Current User Rules =====
    let userRules = {
        detailLevel: 'normal',       // low | normal | high
        layoutDensity: 'normal',     // compact | normal | spacious
        focusMode: false,            // true = reduce distractions
        fontSize: 'normal',          // small | normal | large | x-large
        colorScheme: 'default',      // default | warm | dark | high-contrast
        showSummary: false,          // show AI summary for emails
        showPriority: false,         // show priority badges
        sidebarVisible: true,        // show/hide sidebar
        snippetLength: 'normal',     // short | normal | long
        readingAssist: false,        // reading assistance features
        customCssVars: {},           // arbitrary CSS variable overrides from LLM
        activePreset: null           // track which preset is active
    };

    // ===== Rule History for Undo =====
    let ruleHistory = [JSON.parse(JSON.stringify(userRules))];
    let historyIndex = 0;

    // ===== Conversation history for LLM context =====
    let conversationHistory = [];

    // ===== Rate limiting =====
    let lastApiCallTime = 0;

    // ===== Preset Configurations =====
    const presets = {
        minimal: {
            detailLevel: 'low',
            layoutDensity: 'compact',
            focusMode: false,
            fontSize: 'normal',
            showSummary: false,
            showPriority: false,
            sidebarVisible: false,
            snippetLength: 'short',
            readingAssist: false,
            description: 'Clean, distraction-free interface with minimal details'
        },
        focused: {
            detailLevel: 'normal',
            layoutDensity: 'normal',
            focusMode: true,
            fontSize: 'normal',
            showSummary: true,
            showPriority: true,
            sidebarVisible: true,
            snippetLength: 'normal',
            readingAssist: false,
            description: 'Focus mode enabled, AI highlights what matters'
        },
        detailed: {
            detailLevel: 'high',
            layoutDensity: 'spacious',
            focusMode: false,
            fontSize: 'normal',
            showSummary: true,
            showPriority: true,
            sidebarVisible: true,
            snippetLength: 'long',
            readingAssist: false,
            description: 'Full details, summaries, and priority badges visible'
        },
        relaxed: {
            detailLevel: 'normal',
            layoutDensity: 'spacious',
            focusMode: false,
            fontSize: 'large',
            showSummary: true,
            showPriority: false,
            sidebarVisible: true,
            snippetLength: 'normal',
            readingAssist: true,
            description: 'Larger text, comfortable spacing, reading assistance'
        }
    };

    // ===== LLM System Prompt for Settings AI =====
    const SETTINGS_AI_SYSTEM_PROMPT = `You are the Settings AI for an adaptive email client. Your job is to interpret the user's natural language preferences and output a JSON rules update.

CURRENT RULES STATE:
{CURRENT_RULES}

AVAILABLE RULES (only output fields that should CHANGE):
{
  "detailLevel": "low" | "normal" | "high",
  "layoutDensity": "compact" | "normal" | "spacious",
  "focusMode": true | false,
  "fontSize": "small" | "normal" | "large" | "x-large",
  "colorScheme": "default" | "warm" | "dark" | "high-contrast",
  "showSummary": true | false,
  "showPriority": true | false,
  "sidebarVisible": true | false,
  "snippetLength": "short" | "normal" | "long",
  "readingAssist": true | false,
  "customCssVars": { "CSS-variable-name": "value", ... }
}

ABOUT customCssVars:
This is the most powerful field. Use it when the user requests something that goes BEYOND the predefined options above. You can set ANY CSS variable to ANY valid CSS value. Available CSS variables include:
  - --bg-primary, --bg-secondary, --bg-tertiary (background colors)
  - --text-primary, --text-secondary, --text-muted (text colors)
  - --primary-color, --primary-hover (accent/brand colors)
  - --border-color (border color)
  - --font-base, --font-sm, --font-lg, --font-xl, --font-2xl (font sizes)
  - --spacing-sm, --spacing-md, --spacing-lg, --spacing-xl (spacing)
  - --content-padding, --content-max-width, --line-height (layout)
  - --sidebar-width, --email-list-max-width (section widths)

EXAMPLES of when to use customCssVars:
  - "blue background" → { "customCssVars": { "--bg-primary": "#e3f2fd", "--bg-secondary": "#bbdefb", "--bg-tertiary": "#90caf9" } }
  - "yellow background" → { "customCssVars": { "--bg-primary": "#fffde7", "--bg-secondary": "#fff9c4", "--bg-tertiary": "#fff176" } }
  - "make text red" → { "customCssVars": { "--text-primary": "#c62828" } }
  - "bigger sidebar" → { "customCssVars": { "--sidebar-width": "280px" } }
  - "green theme" → { "customCssVars": { "--bg-primary": "#e8f5e9", "--bg-secondary": "#c8e6c9", "--primary-color": "#2e7d32", "--primary-hover": "#1b5e20" } }

IMPORTANT: When the user asks for a specific color (blue, yellow, pink, etc.), ALWAYS use customCssVars with actual color values. Do NOT say "I can't do that" — you CAN set any color via customCssVars.

RESPONSE FORMAT (you MUST respond with valid JSON only, no markdown, no explanation):
{
  "rules": { ... only changed fields ... },
  "response": "A friendly 1-2 sentence explanation of what you changed and why",
  "matched": ["short description of each change"]
}

RULES:
1. Only include fields in "rules" that the user wants to change. Omit unchanged fields.
2. If the user says something unrelated to email interface preferences, set "rules" to {} and explain in "response" what you can help with.
3. If the user wants to reset everything, include ALL fields set to their defaults AND set "customCssVars" to {}.
4. Interpret fuzzy requests intelligently. E.g. "make it easier to read" → larger font + reading assist + spacious layout.
5. Consider the CURRENT state when interpreting toggles. E.g. if sidebar is already hidden and user says "toggle sidebar", set sidebarVisible to true.
6. Keep "response" concise and friendly.
7. You MUST output valid JSON. No markdown code blocks. No extra text.
8. For ANY color request, use customCssVars with hex or rgb values. Pick aesthetically pleasing shades.`;

    // ===== Keyword → Rule Mapping (FALLBACK) =====
    const keywordRules = [
        {
            keywords: ['simple', 'clean', 'minimal', 'less', 'fewer', 'hide', 'remove'],
            apply: (rules) => {
                rules.detailLevel = 'low';
                rules.layoutDensity = 'compact';
                rules.sidebarVisible = false;
                rules.snippetLength = 'short';
            },
            description: 'Simplified interface'
        },
        {
            keywords: ['detail', 'more', 'show', 'everything', 'full', 'complete', 'all'],
            apply: (rules) => {
                rules.detailLevel = 'high';
                rules.showSummary = true;
                rules.showPriority = true;
                rules.snippetLength = 'long';
                rules.sidebarVisible = true;
            },
            description: 'Enhanced details'
        },
        {
            keywords: ['focus', 'concentrate', 'distract', 'attention', 'busy'],
            apply: (rules) => {
                rules.focusMode = true;
                rules.showPriority = true;
            },
            description: 'Focus mode'
        },
        {
            keywords: ['big', 'bigger', 'large', 'larger', 'read', 'small text', 'hard to read', 'eye', 'vision'],
            apply: (rules) => {
                rules.fontSize = 'large';
                rules.readingAssist = true;
            },
            description: 'Larger text'
        },
        {
            keywords: ['tiny', 'smaller', 'compact', 'dense', 'more emails', 'fit more'],
            apply: (rules) => {
                rules.fontSize = 'small';
                rules.layoutDensity = 'compact';
            },
            description: 'Compact layout'
        },
        {
            keywords: ['summary', 'summarize', 'tldr', 'brief', 'quick view', 'overview'],
            apply: (rules) => {
                rules.showSummary = true;
            },
            description: 'Email summaries'
        },
        {
            keywords: ['priority', 'important', 'urgent', 'crucial', 'must read'],
            apply: (rules) => {
                rules.showPriority = true;
                rules.focusMode = true;
            },
            description: 'Priority indicators'
        },
        {
            keywords: ['relax', 'comfortable', 'easy', 'gentle', 'calm', 'breathe'],
            apply: (rules) => {
                rules.layoutDensity = 'spacious';
                rules.fontSize = 'large';
                rules.readingAssist = true;
            },
            description: 'Relaxed layout'
        },
        {
            keywords: ['sidebar', 'folders', 'navigation', 'menu'],
            apply: (rules) => {
                rules.sidebarVisible = !rules.sidebarVisible;
            },
            description: 'Toggle sidebar'
        },
        {
            keywords: ['dark', 'night', 'dim'],
            apply: (rules) => { rules.colorScheme = 'dark'; },
            description: 'Dark theme'
        },
        {
            keywords: ['warm', 'cozy', 'soft'],
            apply: (rules) => { rules.colorScheme = 'warm'; },
            description: 'Warm colors'
        },
        {
            keywords: ['contrast', 'bright', 'bold colors', 'accessibility'],
            apply: (rules) => {
                rules.colorScheme = 'high-contrast';
                rules.readingAssist = true;
            },
            description: 'High contrast'
        },
        {
            keywords: ['reset', 'default', 'normal', 'undo all', 'original', 'back to normal'],
            apply: (rules) => {
                Object.assign(rules, getDefaultRules());
            },
            description: 'Reset to default'
        }
    ];

    // ===== LLM API Call =====
    async function callLLM(userMessage) {
        const now = Date.now();
        const timeSinceLastCall = now - lastApiCallTime;
        const minInterval = (typeof AI_CONFIG !== 'undefined') ? AI_CONFIG.minRequestInterval : 3000;

        if (timeSinceLastCall < minInterval) {
            await new Promise(resolve => setTimeout(resolve, minInterval - timeSinceLastCall));
        }

        const systemPrompt = SETTINGS_AI_SYSTEM_PROMPT.replace(
            '{CURRENT_RULES}',
            JSON.stringify(userRules, null, 2)
        );

        // Build messages with conversation history for context
        const messages = [
            { role: 'system', content: systemPrompt }
        ];

        // Add recent conversation history (last 6 messages for context)
        const recentHistory = conversationHistory.slice(-6);
        messages.push(...recentHistory);

        // Add current user message
        messages.push({ role: 'user', content: userMessage });

        const config = (typeof AI_CONFIG !== 'undefined') ? AI_CONFIG : {};
        const apiKey = config.apiKey || '';
        const endpoint = config.apiEndpoint || 'https://openrouter.ai/api/v1/chat/completions';
        const model = config.model || 'openrouter/hunter-alpha';

        if (config.debug) {
            console.log('[SettingsAI] LLM Request:', { model, userMessage });
        }

        lastApiCallTime = Date.now();

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': window.location.href,
                'X-Title': 'Adaptive Email Client - Settings AI'
            },
            body: JSON.stringify({
                model: model,
                messages: messages,
                max_tokens: 500,
                temperature: 0.3
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API error ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;

        if (!content) {
            throw new Error('Empty response from API');
        }

        if (config.debug) {
            console.log('[SettingsAI] LLM Response:', content);
        }

        // Parse JSON response (strip markdown code blocks if present)
        let cleaned = content.trim();
        if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
        }

        const parsed = JSON.parse(cleaned);

        // Save to conversation history
        conversationHistory.push(
            { role: 'user', content: userMessage },
            { role: 'assistant', content: content }
        );

        // Keep conversation history manageable
        if (conversationHistory.length > 20) {
            conversationHistory = conversationHistory.slice(-12);
        }

        return parsed;
    }

    // ===== Parse User Input (Keyword Fallback) =====
    function parseUserInput(input) {
        const lowerInput = input.toLowerCase().trim();
        const matchedRules = [];
        const newRules = JSON.parse(JSON.stringify(userRules));
        newRules.activePreset = null;

        const hasHideWords = /\b(hide|remove|no|without|disable|close)\b/.test(lowerInput);
        const hasShowWords = /\b(show|open|enable|display|add)\b/.test(lowerInput);

        keywordRules.forEach(rule => {
            const matched = rule.keywords.some(kw => lowerInput.includes(kw));
            if (matched) {
                if (rule.description === 'Toggle sidebar') {
                    if (hasHideWords) newRules.sidebarVisible = false;
                    else if (hasShowWords) newRules.sidebarVisible = true;
                    else newRules.sidebarVisible = !newRules.sidebarVisible;
                } else {
                    rule.apply(newRules);
                }
                matchedRules.push(rule.description);
            }
        });

        return { rules: newRules, matched: matchedRules };
    }

    // ===== Apply Preset =====
    function applyPreset(presetName) {
        const preset = presets[presetName];
        if (!preset) return null;

        const newRules = JSON.parse(JSON.stringify(userRules));
        Object.keys(preset).forEach(key => {
            if (key !== 'description') {
                newRules[key] = preset[key];
            }
        });
        newRules.activePreset = presetName;

        updateRules(newRules);
        return preset;
    }

    // ===== Update Rules =====
    function updateRules(newRules) {
        // Save history for undo
        ruleHistory = ruleHistory.slice(0, historyIndex + 1);
        ruleHistory.push(JSON.parse(JSON.stringify(newRules)));
        historyIndex = ruleHistory.length - 1;

        userRules = newRules;

        // Dispatch event for Base AI to pick up
        window.dispatchEvent(new CustomEvent('settingsai:rules-changed', {
            detail: { rules: JSON.parse(JSON.stringify(userRules)) }
        }));

        // Update debug panel
        updateDebugDisplay();
    }

    // ===== Generate Additional Prompt for Base AI =====
    function generateBaseAIPrompt() {
        const prompt = {
            userPreferences: {},
            adaptationGuidance: [],
            constraints: []
        };

        if (userRules.detailLevel === 'low') {
            prompt.userPreferences.detailLevel = 'minimal';
            prompt.adaptationGuidance.push('Reduce visual clutter. Hide non-essential elements.');
            prompt.constraints.push('Do not show email snippets longer than 40 characters');
        } else if (userRules.detailLevel === 'high') {
            prompt.userPreferences.detailLevel = 'detailed';
            prompt.adaptationGuidance.push('Show all available information. Expand details.');
        }

        if (userRules.focusMode) {
            prompt.adaptationGuidance.push('Prioritize the current email. Dim non-essential areas.');
            prompt.constraints.push('Apply focus overlay to sidebar and email list');
        }

        if (userRules.fontSize !== 'normal') {
            prompt.userPreferences.fontSize = userRules.fontSize;
            prompt.adaptationGuidance.push(`User prefers ${userRules.fontSize} text size.`);
        }

        if (userRules.layoutDensity !== 'normal') {
            prompt.userPreferences.layoutDensity = userRules.layoutDensity;
        }

        if (userRules.showSummary) {
            prompt.adaptationGuidance.push('Generate and display email summaries when user opens an email.');
        }

        if (userRules.showPriority) {
            prompt.adaptationGuidance.push('Analyze and display priority badges for emails.');
        }

        if (userRules.readingAssist) {
            prompt.adaptationGuidance.push('Enable reading assistance: increased line height, optimized line width.');
        }

        if (userRules.colorScheme !== 'default') {
            prompt.userPreferences.colorScheme = userRules.colorScheme;
        }

        return prompt;
    }

    // ===== Generate Fallback Response =====
    function generateFallbackResponse(input, matchedRules) {
        if (matchedRules.length === 0) {
            return "I'm not sure what you'd like me to change. Try telling me about your preferred reading style, layout, or specific features you want to enable/disable.";
        }
        const changes = matchedRules.join(', ');
        const responses = [
            `Got it! I've applied: ${changes}. The Base AI will now adapt the interface accordingly.`,
            `Understood! Adjusting the interface with: ${changes}. You'll see the changes take effect shortly.`,
            `Done! Rules updated for: ${changes}. The Base AI is now using these preferences to guide its decisions.`
        ];
        return responses[Math.floor(Math.random() * responses.length)];
    }

    // ===== Process User Message (Main Entry Point) =====
    async function processMessage(input) {
        const useLLM = (typeof AI_CONFIG !== 'undefined') && AI_CONFIG.useSettingsAI_LLM && AI_CONFIG.apiKey;

        if (useLLM) {
            try {
                // ===== LLM Path =====
                const llmResult = await callLLM(input);

                const rulesUpdate = llmResult.rules || {};
                const response = llmResult.response || 'Settings updated.';
                const matched = llmResult.matched || [];

                if (Object.keys(rulesUpdate).length > 0) {
                    const newRules = JSON.parse(JSON.stringify(userRules));
                    Object.assign(newRules, rulesUpdate);
                    newRules.activePreset = null;
                    updateRules(newRules);
                }

                return {
                    response,
                    rulesChanged: Object.keys(rulesUpdate).length > 0,
                    matchedRules: matched,
                    currentRules: JSON.parse(JSON.stringify(userRules)),
                    baseAIPrompt: generateBaseAIPrompt()
                };

            } catch (error) {
                console.error('[SettingsAI] LLM call failed, falling back to keywords:', error);
                // Fall through to keyword fallback
            }
        }

        // ===== Keyword Fallback Path =====
        const { rules, matched } = parseUserInput(input);
        const response = generateFallbackResponse(input, matched);

        if (matched.length > 0) {
            updateRules(rules);
        }

        return {
            response: useLLM
                ? `[Fallback mode] ${response}`
                : response,
            rulesChanged: matched.length > 0,
            matchedRules: matched,
            currentRules: JSON.parse(JSON.stringify(userRules)),
            baseAIPrompt: generateBaseAIPrompt()
        };
    }

    // ===== Undo/Redo =====
    function undo() {
        if (historyIndex > 0) {
            historyIndex--;
            userRules = JSON.parse(JSON.stringify(ruleHistory[historyIndex]));
            window.dispatchEvent(new CustomEvent('settingsai:rules-changed', {
                detail: { rules: JSON.parse(JSON.stringify(userRules)) }
            }));
            updateDebugDisplay();
            return true;
        }
        return false;
    }

    function clearRules() {
        const defaultRules = getDefaultRules();
        updateRules(defaultRules);
    }

    /**
     * Set rules silently (no event fired, no history recorded).
     * Used by Renderer's undo/redo to restore rules state
     * WITHOUT triggering a Base AI re-evaluation cycle.
     */
    function setRulesSilent(newRules) {
        userRules = JSON.parse(JSON.stringify(newRules));
        updateDebugDisplay();
    }

    /**
     * Get the default rules object (useful for reset comparisons).
     */
    function getDefaultRules() {
        return {
            detailLevel: 'normal',
            layoutDensity: 'normal',
            focusMode: false,
            fontSize: 'normal',
            colorScheme: 'default',
            showSummary: false,
            showPriority: false,
            sidebarVisible: true,
            snippetLength: 'normal',
            readingAssist: false,
            customCssVars: {},
            activePreset: null
        };
    }

    // ===== Debug Display =====
    function updateDebugDisplay() {
        const el = document.getElementById('debugSettingsRules');
        if (el) {
            el.textContent = JSON.stringify(userRules, null, 2);
        }
    }

    // ===== Public API =====
    return {
        processMessage,       // now async!
        applyPreset,
        getRules: () => JSON.parse(JSON.stringify(userRules)),
        getDefaultRules: getDefaultRules,
        getBaseAIPrompt: generateBaseAIPrompt,
        undo,
        clearRules,
        setRulesSilent,
        getPresets: () => presets
    };
})();
