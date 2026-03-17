// ===== DCAF Configuration =====
const DCAF_CONFIG = {
    // 模式选择: true = AI模式, false = 规则模式
    USE_AI: false,  // 改为false则使用规则引擎

    // AI提供商配置
    AI_PROVIDER: 'gemini',

    // 评估间隔（毫秒）- 2分钟
    EVALUATION_INTERVAL: 20000, // 120000ms = 2分钟

    DEBUG_MODE: true,

    // Gemini API配置 - 请填写你的API密钥
    AI_API: {
        gemini: {
            endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/',
            apiKey: 'YOUR_API_KEY_HERE', // 🔴 请替换为你的实际API密钥
            models: {
                flash: 'gemini-1.5-flash',
                pro: 'gemini-1.5-pro'
            }
        }
    },

    // 阅读速度阈值（字/分钟）
    READING_SPEED: {
        SKIMMING: 350,  // >350 字/分钟 = 快速浏览
        NORMAL_MIN: 150, // 150-350 = 正常
        DEEP_MAX: 150    // <150 = 深度阅读
    },

    // 悬停阈值（毫秒）
    HOVER: {
        CONFUSION: 3000,  // >3秒 = 困惑
        LONG: 5000        // >5秒 = 非常困惑
    },

    // 切换频率
    SWITCH: {
        HIGH: 8,     // 每分钟8次以上 = 高频
        MEDIUM: 5,   // 5-8次 = 中频
        LOW: 2       // 2-5次 = 低频
    },

    // 阈值配置（规则引擎用）
    THRESHOLDS: {
        SWITCH_FREQUENCY_HIGH: 8,
        READING_TIME_SHORT: 3000,
        READING_TIME_LONG: 20000,
        HOVER_TIME_CONFUSION: 3000,
        DISTRACTION_LEVEL: 0.4
    }
};

// ===== 感知层：跟踪用户行为 =====
class SensingLayer {
    constructor() {
        this.trackers = {
            mouse: new MouseTracker(),
            switch: new SwitchTracker(),
            reading: new ReadingTracker(),
            hover: new HoverTracker()
        };

        this.userState = {
            currentEmailId: null,
            sessionStartTime: Date.now(),
            lastActivityTime: Date.now()
        };

        this.metricsHistory = [];
        this.initialized = false;
    }

    init() {
        if (this.initialized) return;

        this.trackers.mouse.init();
        this.trackers.switch.init();
        this.trackers.reading.init();
        this.trackers.hover.init();

        this.initialized = true;
        console.log('DCAF Sensing Layer initialized');
    }

    getCurrentMetrics() {
        const metrics = {
            mouseComplexity: this.trackers.mouse.getComplexity(),
            switchFrequency: this.trackers.switch.getFrequency(60000),
            readingMetrics: this.trackers.reading.getMetrics(),
            hoverMetrics: this.trackers.hover.getMetrics(),
            switchPattern: this.trackers.switch.getPattern(),
            timestamp: Date.now()
        };

        this.metricsHistory.push(metrics);
        if (this.metricsHistory.length > 20) {
            this.metricsHistory = this.metricsHistory.slice(-20);
        }

        return metrics;
    }

    getMetricsHistory() {
        return this.metricsHistory;
    }

    recordEmailOpen(emailId, emailBody) {
        this.userState.currentEmailId = emailId;
        this.userState.lastActivityTime = Date.now();
        this.trackers.reading.startReading(emailId, emailBody);
    }

    recordEmailClose() {
        this.trackers.reading.endReading();
    }

    recordAction(actionType) {
        this.userState.lastActivityTime = Date.now();
    }
}

// 鼠标轨迹跟踪器
class MouseTracker {
    constructor() {
        this.trajectory = [];
        this.lastPosition = { x: 0, y: 0 };
        this.sampleRate = 100;
        this.lastSample = 0;
    }

    init() {
        document.addEventListener('mousemove', (e) => {
            const now = Date.now();
            if (now - this.lastSample > this.sampleRate) {
                this.trajectory.push({
                    x: e.clientX,
                    y: e.clientY,
                    timestamp: now
                });
                this.lastPosition = { x: e.clientX, y: e.clientY };
                this.lastSample = now;

                if (this.trajectory.length > 100) {
                    this.trajectory = this.trajectory.slice(-50);
                }
            }
        });
    }

    getComplexity() {
        if (this.trajectory.length < 5) return 0;

        let directionChanges = 0;
        let lastAngle = null;

        for (let i = 1; i < this.trajectory.length; i++) {
            const prev = this.trajectory[i-1];
            const curr = this.trajectory[i];

            const angle = Math.atan2(curr.y - prev.y, curr.x - prev.x);
            if (lastAngle !== null && Math.abs(angle - lastAngle) > 0.5) {
                directionChanges++;
            }
            lastAngle = angle;
        }

        return Math.min(1, directionChanges / 20);
    }
}

// 切换频率跟踪器
class SwitchTracker {
    constructor() {
        this.switches = [];
        this.currentFolder = 'inbox';
    }

    init() {
        document.addEventListener('click', (e) => {
            const folderItem = e.target.closest('.folder-nav li');
            if (folderItem && folderItem.dataset.folder) {
                this.recordSwitch(folderItem.dataset.folder);
            }
        });
    }

    recordSwitch(newFolder) {
        const now = Date.now();
        this.switches.push({
            from: this.currentFolder,
            to: newFolder,
            timestamp: now
        });
        this.currentFolder = newFolder;

        if (this.switches.length > 100) {
            this.switches = this.switches.slice(-50);
        }
    }

    getFrequency(timeWindow = 60000) {
        const now = Date.now();
        const recentSwitches = this.switches.filter(s =>
            now - s.timestamp < timeWindow
        );
        return recentSwitches.length;
    }

    getPattern() {
        if (this.switches.length < 5) return 'insufficient';

        const intervals = [];
        for (let i = 1; i < this.switches.length; i++) {
            intervals.push(this.switches[i].timestamp - this.switches[i-1].timestamp);
        }

        const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const variance = intervals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / intervals.length;
        const cv = Math.sqrt(variance) / mean;

        if (cv > 1.2) return 'erratic';
        if (cv < 0.5) return 'systematic';
        return 'mixed';
    }
}

// 阅读时长跟踪器
class ReadingTracker {
    constructor() {
        this.sessions = [];
        this.currentSession = null;
        this.emailWordCounts = new Map();
    }

    init() {
        if (DCAF_CONFIG.DEBUG_MODE) {
            console.log('ReadingTracker initialized');
        }
    }

    getWordCount(html) {
        if (!html) return 100;
        const text = html.replace(/<[^>]*>/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        return text.split(/\s+/).length;
    }

    startReading(emailId, emailBody) {
        this.endReading();

        if (!this.emailWordCounts.has(emailId) && emailBody) {
            const wordCount = this.getWordCount(emailBody);
            this.emailWordCounts.set(emailId, wordCount);
            if (DCAF_CONFIG.DEBUG_MODE) {
                console.log(`Email ${emailId} word count: ${wordCount}`);
            }
        }

        this.currentSession = {
            emailId,
            startTime: Date.now()
        };
    }

    endReading() {
        if (this.currentSession) {
            this.currentSession.duration = Date.now() - this.currentSession.startTime;
            const wordCount = this.emailWordCounts.get(this.currentSession.emailId) || 100;
            const readingSpeed = (wordCount / this.currentSession.duration) * 60000;

            this.currentSession.wordCount = wordCount;
            this.currentSession.readingSpeed = readingSpeed;
            this.sessions.push(this.currentSession);

            if (this.sessions.length > 50) {
                this.sessions = this.sessions.slice(-30);
            }
            this.currentSession = null;
        }
    }

    getMetrics() {
        if (this.sessions.length === 0) {
            return {
                avgDuration: 0,
                lastDuration: 0,
                readingPattern: 'unknown',
                avgReadingSpeed: 0,
                lastReadingSpeed: 0
            };
        }

        const recent = this.sessions.slice(-5);
        const avgDuration = recent.reduce((a, s) => a + s.duration, 0) / recent.length;
        const lastDuration = this.sessions[this.sessions.length - 1]?.duration || 0;
        const avgReadingSpeed = recent.reduce((a, s) => a + (s.readingSpeed || 0), 0) / recent.length;
        const lastReadingSpeed = this.sessions[this.sessions.length - 1]?.readingSpeed || 0;

        let readingPattern = 'normal';
        if (avgReadingSpeed > DCAF_CONFIG.READING_SPEED.SKIMMING) {
            readingPattern = 'skimming';
        } else if (avgReadingSpeed < DCAF_CONFIG.READING_SPEED.DEEP_MAX) {
            readingPattern = 'deep';
        }

        if (DCAF_CONFIG.DEBUG_MODE && readingPattern !== 'normal') {
            console.log(`Reading pattern: ${readingPattern} (${Math.round(avgReadingSpeed)} words/min)`);
        }

        return {
            avgDuration,
            lastDuration,
            readingPattern,
            avgReadingSpeed: Math.round(avgReadingSpeed),
            lastReadingSpeed: Math.round(lastReadingSpeed),
            sessionCount: this.sessions.length
        };
    }
}

// 悬停跟踪器
class HoverTracker {
    constructor() {
        this.hovers = [];
        this.currentHover = null;
    }

    shouldTrack(target) {
        return target.classList.contains('btn-icon') ||
            target.classList.contains('email-item') ||
            target.classList.contains('folder-nav li') ||
            target.classList.contains('folders-section li') ||
            target.tagName === 'BUTTON' ||
            target.tagName === 'A' ||
            target.closest('.btn-icon') ||
            target.closest('.email-item') ||
            target.closest('.folder-nav') ||
            target.closest('.folders-section');
    }

    getElementType(target) {
        if (target.classList.contains('btn-icon')) return 'button';
        if (target.classList.contains('email-item')) return 'email';
        if (target.closest('.folder-nav')) return 'folder';
        if (target.closest('.folders-section')) return 'label';
        return 'other';
    }

    init() {
        document.addEventListener('mouseover', (e) => {
            const target = e.target;
            if (this.shouldTrack(target)) {
                this.currentHover = {
                    elementType: this.getElementType(target),
                    target: target,
                    startTime: Date.now()
                };
            }
        });

        document.addEventListener('mouseout', (e) => {
            if (this.currentHover && e.target === this.currentHover.target) {
                const duration = Date.now() - this.currentHover.startTime;
                if (duration > 500) {
                    this.currentHover.duration = duration;
                    this.hovers.push(this.currentHover);

                    if (this.hovers.length > 100) {
                        this.hovers = this.hovers.slice(-50);
                    }
                }
                this.currentHover = null;
            }
        });
    }

    getMetrics() {
        if (this.hovers.length === 0) {
            return { avgDuration: 0, confusionCount: 0, confusionRate: 0, hoverDistribution: {} };
        }

        const recent = this.hovers.slice(-20);
        const avgDuration = recent.reduce((a, h) => a + h.duration, 0) / recent.length;
        const confusionCount = recent.filter(h => h.duration > DCAF_CONFIG.HOVER.CONFUSION).length;
        const confusionRate = confusionCount / recent.length;

        const hoverDistribution = {};
        recent.forEach(h => {
            const type = h.elementType || 'unknown';
            hoverDistribution[type] = (hoverDistribution[type] || 0) + 1;
        });

        return {
            avgDuration: Math.round(avgDuration),
            confusionCount,
            confusionRate,
            hoverDistribution
        };
    }
}

// ===== 推断层：双模式切换 =====
class InferenceLayer {
    constructor(sensingLayer) {
        this.sensing = sensingLayer;
        this.lastEvaluation = null;
    }

    async evaluateUserState() {
        const metrics = this.sensing.getCurrentMetrics();

        // 根据USE_AI开关选择使用AI还是规则引擎
        if (DCAF_CONFIG.USE_AI) {
            return await this.getAIInference(metrics);
        } else {
            return this.getRuleBasedInference(metrics);
        }
    }

    // 规则引擎推断
    getRuleBasedInference(metrics) {
        const switchFreq = metrics.switchFrequency;
        const switchPattern = metrics.switchPattern;
        const readingMetrics = metrics.readingMetrics;
        const hoverMetrics = metrics.hoverMetrics;

        let cognitiveLoad = 0.2;

        // 阅读速度判断
        if (readingMetrics.avgReadingSpeed > DCAF_CONFIG.READING_SPEED.SKIMMING) {
            cognitiveLoad += 0.2;
        } else if (readingMetrics.avgReadingSpeed < DCAF_CONFIG.READING_SPEED.DEEP_MAX) {
            cognitiveLoad += 0.1;
        } else {
            cognitiveLoad -= 0.1;
        }

        // 切换频率判断
        if (switchFreq > DCAF_CONFIG.SWITCH.HIGH) {
            cognitiveLoad += 0.3;
        } else if (switchFreq > DCAF_CONFIG.SWITCH.MEDIUM) {
            cognitiveLoad += 0.2;
        } else if (switchFreq > DCAF_CONFIG.SWITCH.LOW) {
            cognitiveLoad += 0.1;
        }

        // 悬停困惑度
        if (hoverMetrics.confusionRate > 0.5) {
            cognitiveLoad += 0.3;
        } else if (hoverMetrics.confusionRate > 0.3) {
            cognitiveLoad += 0.2;
        } else if (hoverMetrics.confusionRate > 0.1) {
            cognitiveLoad += 0.1;
        }

        cognitiveLoad += metrics.mouseComplexity * 0.1;

        let distractionLevel = 0.1;
        if (switchFreq > DCAF_CONFIG.SWITCH.MEDIUM && switchPattern === 'erratic') {
            distractionLevel += 0.4;
        }
        if (readingMetrics.avgReadingSpeed > DCAF_CONFIG.READING_SPEED.SKIMMING && switchFreq > DCAF_CONFIG.SWITCH.MEDIUM) {
            distractionLevel += 0.3;
        }

        const confusionLevel = Math.min(1, hoverMetrics.confusionRate);

        return {
            cognitiveLoad: Math.min(1, Math.max(0, cognitiveLoad)),
            distractionLevel: Math.min(1, distractionLevel),
            confusionLevel: Math.min(1, confusionLevel),
            readingPattern: readingMetrics.readingPattern,
            readingSpeed: readingMetrics.avgReadingSpeed,
            switchPattern,
            confusionRate: hoverMetrics.confusionRate,
            source: 'rule-based',
            reasoning: 'Analysis of the rule engine',
            timestamp: Date.now()
        };
    }

    // AI引擎推断 - API已留空，请填写你的API密钥
    async getAIInference(metrics) {
        try {
            console.log('🌐 Preparing to call the AI API for state inference');
            console.log('⚠️ Please first enter your API key in DCAF_CONFIG.AI_API.gemini.apiKey');

            // 🔴 这里返回规则引擎结果，等你填写API密钥后再启用真实API
            return this.getRuleBasedInference(metrics);

            /*
            // 当你填写API密钥后，取消下面的注释
            const config = DCAF_CONFIG.AI_API.gemini;
            const model = config.models.flash;

            const prompt = this.buildAIPrompt(metrics);

            const url = `${config.endpoint}${model}:generateContent?key=${config.apiKey}`;

            const requestBody = {
                contents: [{
                    role: "user",
                    parts: [{
                        text: `You are a user state inference system. Analyze these metrics and output ONLY valid JSON.
${prompt}
Output ONLY the JSON object, no other text.`
                    }]
                }],
                generationConfig: {
                    temperature: 0.2,
                    maxOutputTokens: 300
                }
            };

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const data = await response.json();

            if (data.candidates && data.candidates[0]?.content?.parts[0]?.text) {
                const text = data.candidates[0].content.parts[0].text;
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const aiOutput = JSON.parse(jsonMatch[0]);

                    return {
                        cognitiveLoad: this.validateRange(aiOutput.cognitiveLoad, 0.5),
                        distractionLevel: this.validateRange(aiOutput.distractionLevel, 0.4),
                        confusionLevel: this.validateRange(aiOutput.confusionLevel, 0.3),
                        attentionScore: this.validateRange(aiOutput.attentionScore, 0.5),
                        recommendedAction: aiOutput.recommendedAction || 'none',
                        reasoning: aiOutput.reasoning || 'AI分析完成',
                        source: 'gemini-ai',
                        timestamp: Date.now()
                    };
                }
            }

            return this.getRuleBasedInference(metrics);
            */

        } catch (error) {
            console.error('AI inference error:', error);
            return this.getRuleBasedInference(metrics);
        }
    }

    validateRange(value, defaultValue) {
        if (value === null || value === undefined) return defaultValue;
        if (typeof value === 'number' && !isNaN(value)) {
            return Math.min(1, Math.max(0, value));
        }
        if (typeof value === 'string') {
            const num = parseFloat(value);
            if (!isNaN(num)) {
                return Math.min(1, Math.max(0, num));
            }
        }
        return defaultValue;
    }

    buildAIPrompt(metrics) {
        return `Analyze this user's interaction with an email client:

CURRENT METRICS:
- Mouse movement complexity (0-1): ${metrics.mouseComplexity.toFixed(2)}
- Folder switches in last minute: ${metrics.switchFrequency}
- Switch pattern: ${metrics.switchPattern}
- Reading speed: ${metrics.readingMetrics.avgReadingSpeed} words/minute
- Reading pattern: ${metrics.readingMetrics.readingPattern}
- Hover confusion rate: ${(metrics.hoverMetrics.confusionRate * 100).toFixed(0)}%
- Average hover duration: ${metrics.hoverMetrics.avgDuration}ms

Output a JSON object with these fields:
{
    "cognitiveLoad": <float 0-1>,
    "distractionLevel": <float 0-1>,
    "confusionLevel": <float 0-1>,
    "attentionScore": <float 0-1>,
    "recommendedAction": <string>,
    "reasoning": <string>
}`;
    }
}

// ===== 撤销/重做系统 =====
class UndoRedoSystem {
    constructor() {
        this.undoStack = [];
        this.redoStack = [];
        this.pendingAccept = null;
        this.lastAppliedLevel = 0;
    }

    pushAdaptation(adaptation) {
        if (adaptation.level === this.lastAppliedLevel) {
            console.log('Same adaptation level, not showing panel again');
            return false;
        }

        this.pendingAccept = adaptation;
        this.lastAppliedLevel = adaptation.level;
        this.showUndoPanel(adaptation);
        return true;
    }

    acceptAdaptation() {
        if (this.pendingAccept) {
            this.undoStack.push(this.pendingAccept);
            this.pendingAccept = null;
            this.redoStack = [];
            this.hidePanel();
            document.dispatchEvent(new CustomEvent('adaptation-accepted'));
            this.showMessage('Accepted', 2000);
            return true;
        }
        return false;
    }

    undo() {
        if (this.pendingAccept) {
            this.removeAdaptationEffects(this.pendingAccept);
            this.lastAppliedLevel = 0;
            this.showMessage('This has been temporarily cancelled; click Redo to restore it.', 3000);
            this.updatePanelButtons(true);
            return true;
        }

        if (this.undoStack.length > 0) {
            const adaptation = this.undoStack.pop();
            this.redoStack.push(adaptation);
            this.removeAdaptationEffects(adaptation);

            this.lastAppliedLevel = this.undoStack.length > 0 ?
                this.undoStack[this.undoStack.length-1].level : 0;

            document.dispatchEvent(new CustomEvent('adaptation-undone', {
                detail: { adaptation }
            }));
            this.showMessage('Withdrawn', 2000);

            if (this.undoStack.length === 0 && !this.pendingAccept) {
                this.hidePanel();
            }
            return true;
        }

        this.showMessage('No reversible actions', 1500);
        return false;
    }

    redo() {
        if (this.pendingAccept) {
            this.applyAdaptationEffects(this.pendingAccept);
            this.lastAppliedLevel = this.pendingAccept.level;
            document.dispatchEvent(new CustomEvent('adaptation-redone', {
                detail: { adaptation: this.pendingAccept }
            }));
            this.showMessage('Revised', 2000);
            this.updatePanelButtons(false);
            return true;
        }

        if (this.redoStack.length > 0) {
            const adaptation = this.redoStack.pop();
            this.undoStack.push(adaptation);
            this.applyAdaptationEffects(adaptation);
            this.lastAppliedLevel = adaptation.level;

            document.dispatchEvent(new CustomEvent('adaptation-redone', {
                detail: { adaptation }
            }));
            this.showMessage('Revised', 2000);

            const panel = document.getElementById('adaptationPanel');
            if (panel && panel.style.display === 'none') {
                panel.style.display = 'block';
            }
            return true;
        }

        this.showMessage('There are no actions that can be undone', 1500);
        return false;
    }

    removeAdaptationEffects(adaptation) {
        if (!adaptation || !adaptation.adaptations) return;
        adaptation.adaptations.forEach(adapt => {
            if (adapt.cssClass) {
                document.body.classList.remove(adapt.cssClass);
            }
        });
    }

    applyAdaptationEffects(adaptation) {
        if (!adaptation || !adaptation.adaptations) return;
        adaptation.adaptations.forEach(adapt => {
            if (adapt.cssClass) {
                document.body.classList.add(adapt.cssClass);
            }
        });
    }

    showUndoPanel(adaptation) {
        const panel = document.getElementById('adaptationPanel');
        const message = document.getElementById('adaptationMessage');
        const buttonsDiv = document.querySelector('.panel-buttons');

        if (!panel || !message || !buttonsDiv) return;

        message.textContent = adaptation.message || 'The interface has been updated';

        buttonsDiv.innerHTML = '';

        const undoBtn = document.createElement('button');
        undoBtn.className = 'btn-undo';
        undoBtn.id = 'undoBtn';
        undoBtn.innerHTML = '<i class="fas fa-undo"></i> Undo';
        undoBtn.addEventListener('click', () => this.undo());

        const redoBtn = document.createElement('button');
        redoBtn.className = 'btn-redo';
        redoBtn.id = 'redoBtn';
        redoBtn.innerHTML = '<i class="fas fa-redo"></i> Redo';
        redoBtn.addEventListener('click', () => this.redo());

        const acceptBtn = document.createElement('button');
        acceptBtn.className = 'btn-accept';
        acceptBtn.id = 'acceptBtn';
        acceptBtn.innerHTML = '<i class="fas fa-check"></i> Accept';
        acceptBtn.addEventListener('click', () => {
            this.acceptAdaptation();
            this.hidePanel();
        });

        buttonsDiv.appendChild(undoBtn);
        buttonsDiv.appendChild(redoBtn);
        buttonsDiv.appendChild(acceptBtn);

        panel.style.display = 'block';

        if (this.timeoutId) clearTimeout(this.timeoutId);

        this.timeoutId = setTimeout(() => {
            if (this.pendingAccept) {
                this.acceptAdaptation();
                this.hidePanel();
            }
        }, 300000);
    }

    updatePanelButtons(isUndone) {
        const undoBtn = document.getElementById('undoBtn');
        const redoBtn = document.getElementById('redoBtn');
        const acceptBtn = document.getElementById('acceptBtn');

        if (isUndone) {
            if (undoBtn) undoBtn.style.opacity = '0.5';
            if (redoBtn) {
                redoBtn.style.opacity = '1';
                redoBtn.style.backgroundColor = 'var(--primary-color)';
                redoBtn.style.color = 'white';
            }
            if (acceptBtn) acceptBtn.style.opacity = '0.7';
        } else {
            if (undoBtn) undoBtn.style.opacity = '1';
            if (redoBtn) {
                redoBtn.style.opacity = '1';
                redoBtn.style.backgroundColor = '';
                redoBtn.style.color = '';
            }
            if (acceptBtn) acceptBtn.style.opacity = '1';
        }
    }

    hidePanel() {
        const panel = document.getElementById('adaptationPanel');
        if (panel) {
            panel.style.display = 'none';
        }
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
    }

    showMessage(text, duration) {
        const msg = document.getElementById('undoMessage');
        if (!msg) return;

        msg.textContent = text;
        msg.style.display = 'block';

        if (this.msgTimeoutId) {
            clearTimeout(this.msgTimeoutId);
        }

        this.msgTimeoutId = setTimeout(() => {
            msg.style.display = 'none';
        }, duration);
    }

    reset() {
        if (this.pendingAccept) {
            this.removeAdaptationEffects(this.pendingAccept);
            this.pendingAccept = null;
        }

        this.undoStack.forEach(adapt => this.removeAdaptationEffects(adapt));
        this.redoStack.forEach(adapt => this.removeAdaptationEffects(adapt));

        this.undoStack = [];
        this.redoStack = [];
        this.lastAppliedLevel = 0;
        this.hidePanel();
    }
}

// ===== 适应层 =====
class AdaptationLayer {
    constructor(undoRedoSystem) {
        this.undoRedo = undoRedoSystem;
    }

    determineStrategy(userState) {
        const { cognitiveLoad, distractionLevel, confusionLevel } = userState;

        if (cognitiveLoad > 0.8 || distractionLevel > 0.7 || confusionLevel > 0.7) {
            return this.getLevel3Strategy();
        } else if (cognitiveLoad > 0.6 || distractionLevel > 0.5 || confusionLevel > 0.5) {
            return this.getLevel2Strategy();
        } else {
            return this.getLevel1Strategy();
        }
    }

    getLevel1Strategy() {
        return {
            level: 1,
            name: 'Fine-tuning',
            adaptations: [{
                type: 'font',
                cssClass: 'large-text-mode',
                message: 'The font size has been increased'
            }],
            message: 'We have optimised your reading experience'
        };
    }

    getLevel2Strategy() {
        return {
            level: 2,
            name: 'Focus mode',
            adaptations: [{
                type: 'focus',
                cssClass: 'focus-mode-active',
                message: 'Focused on the current email'
            }],
            message: 'We’ve detected that you may need to focus; we’ve now highlighted the current email'
        };
    }

    getLevel3Strategy() {
        return {
            level: 3,
            name: 'Guidance and support',
            adaptations: [
                {
                    type: 'focus',
                    cssClass: 'focus-mode-active',
                    message: 'Focused on the current email'
                },
                {
                    type: 'guidance',
                    cssClass: 'guidance-mode',
                    message: 'Need help?'
                }
            ],
            message: 'It seems you’re having a bit of trouble; let me help you.'
        };
    }

    applyStrategy(strategy, previousState = null) {
        if (!strategy || strategy.adaptations.length === 0) return null;

        const currentLevel = this.getCurrentAdaptationLevel();
        if (currentLevel === strategy.level) {
            console.log('If the state has not changed, the adaptation is not triggered again');
            return null;
        }

        const adaptation = {
            id: Date.now(),
            timestamp: Date.now(),
            strategy: strategy.name,
            level: strategy.level,
            adaptations: strategy.adaptations,
            message: strategy.message
        };

        strategy.adaptations.forEach(adapt => {
            if (adapt.cssClass) {
                document.body.classList.add(adapt.cssClass);
            }
        });

        this.undoRedo.pushAdaptation(adaptation);

        return adaptation.id;
    }

    getCurrentAdaptationLevel() {
        if (document.body.classList.contains('focus-mode-active') ||
            document.body.classList.contains('guidance-mode')) {
            return 3;
        } else if (document.body.classList.contains('simplified-mode')) {
            return 2;
        } else if (document.body.classList.contains('large-text-mode')) {
            return 1;
        }
        return 0;
    }

    resetAllAdaptations() {
        document.body.classList.remove(
            'focus-mode-active',
            'simplified-mode',
            'guidance-mode',
            'large-text-mode',
            'high-contrast-mode'
        );
    }
}

// ===== AI摘要系统 =====
class AISummarySystem {
    constructor() {
        this.panel = document.getElementById('aiSummaryPanel');
        this.content = document.getElementById('aiSummaryContent');
        this.readingTime = document.getElementById('aiReadingTime');
        this.toggle = document.getElementById('aiSummaryToggle');
        this.closeBtn = document.getElementById('closeAISummary');
        this.summaryCache = new Map();

        console.log('🤖 Initialisation of the AI summarisation system');

        if (!this.panel || !this.content) {
            console.error('❌ AI Summary Panel elements not found');
            return;
        }

        // 绑定全局state
        if (typeof state !== 'undefined' && !window.state) {
            window.state = state;
            console.log('✅ The global state has been bound');
        }

        console.log('✅ AI summary panel elements found');
        this.setupListeners();
    }

    setupListeners() {
        if (this.toggle) {
            this.toggle.addEventListener('change', (e) => {
                console.log('🔄 Change in AI switch status:', e.target.checked ? 'Open' : 'Close');
                if (e.target.checked) {
                    this.showSummary();
                } else {
                    this.hide();
                }
            });
        }

        if (this.closeBtn) {
            this.closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                console.log('❌ Close the AI Summary panel');
                this.hide();
                if (this.toggle) this.toggle.checked = false;
            });
        }

        if (this.panel) {
            this.panel.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }
    }

    async showSummary() {
        if (!this.panel || !this.content) return;

        console.log('🤖 ===== AI Summary Panel Display =====');

        const currentEmail = this.getCurrentEmail();

        if (!currentEmail) {
            console.log('📭 No emails are selected; a message is displayed');
            this.content.innerHTML = '<p class="ai-summary-placeholder">📧 Please select an email first</p>';
            this.panel.style.display = 'block';
            return;
        }

        this.panel.style.display = 'block';
        this.panel.style.zIndex = '10000';

        console.log('📧 Currently selected email:', {
            id: currentEmail.id,
            subject: currentEmail.subject,
            sender: currentEmail.sender,
            labels: currentEmail.labels
        });

        if (this.summaryCache.has(currentEmail.id)) {
            console.log('📦 Summary of cache usage');
            const cached = this.summaryCache.get(currentEmail.id);
            this.displaySummary(cached.summary, cached.readTime, true);
            return;
        }

        console.log('🔄 Generate a new summary...');
        this.content.innerHTML = '<p class="ai-summary-placeholder">🤔 The AI is thinking...</p>';

        try {
            let summary;
            let readTime;

            if (DCAF_CONFIG.USE_AI) {
                console.log('🌐 Calling the Gemini API...');
                const result = await this.fetchAISummary(currentEmail);
                summary = result.summary;
                readTime = result.readTime;
                console.log('✅ AI summary generated successfully, length:', summary.length);
            } else {
                console.log('📝 Summary of Terms of Use');
                summary = this.getRuleBasedSummary(currentEmail);
                const wordCount = this.getWordCount(currentEmail.body);
                readTime = Math.ceil(wordCount / 250);
            }

            this.summaryCache.set(currentEmail.id, { summary, readTime });
            this.displaySummary(summary, readTime, false);

        } catch (error) {
            console.error('❌ Abstract generation failed:', error);
            this.content.innerHTML = '<p class="ai-summary-placeholder">❌ Abstract generation failed. Please try again.</p>';
        }
    }

    displaySummary(summary, readTime, isCached = false) {
        if (!this.content || !this.readingTime) return;

        const formattedSummary = summary.replace(/\n/g, '<br>');

        const currentEmail = this.getCurrentEmail();
        const labels = currentEmail?.labels || [];

        const labelsHTML = labels.length > 0 ?
            `<div style="margin-bottom: 8px;">
                ${labels.map(label =>
                `<span class="ai-summary-tag ${label.toLowerCase()}">${label}</span>`
            ).join('')}
            </div>` : '';

        this.content.innerHTML = `
            ${labelsHTML}
            <div class="ai-summary-text">${formattedSummary}</div>
        `;

        this.readingTime.innerHTML = `
            <span>📖 约 ${readTime} 分钟阅读</span>
            <span style="margin-left: 8px;">⚡ ${isCached ? 'Cache' : (DCAF_CONFIG.USE_AI ? 'AI-generated' : 'Summary of Rules')}</span>
        `;

        console.log('📊 Summary displayed', {
            阅读时间: readTime + 'minutes',
            来源: isCached ? 'Cache' : (DCAF_CONFIG.USE_AI ? 'AI' : 'Rules'),
            标签: labels
        });
    }

    async fetchAISummary(email) {
        try {
            console.log('⚠️ Please first enter your API key in DCAF_CONFIG.AI_API.gemini.apiKey');

            // 🔴 返回规则摘要，等你填写API密钥后再启用真实API
            return {
                summary: this.getRuleBasedSummary(email),
                readTime: Math.ceil(this.getWordCount(email.body) / 250)
            };

            /*
            // 当你填写API密钥后，取消下面的注释
            const config = DCAF_CONFIG.AI_API.gemini;
            const model = config.models.flash;

            const cleanText = email.body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            const truncated = cleanText.length > 2000 ? cleanText.substring(0, 2000) + '...' : cleanText;

            const url = `${config.endpoint}${model}:generateContent?key=${config.apiKey}`;

            const requestBody = {
                contents: [{
                    role: "user",
                    parts: [{
                        text: `Summarize this email in 2-3 sentences in Chinese.

From: ${email.sender}
Subject: ${email.subject}
Content: ${truncated}

Summary:`
                    }]
                }],
                generationConfig: {
                    temperature: 0.3,
                    maxOutputTokens: 200
                }
            };

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) throw new Error(`API error: ${response.status}`);

            const data = await response.json();

            if (data.candidates && data.candidates[0]?.content?.parts[0]?.text) {
                const summary = data.candidates[0].content.parts[0].text;
                const wordCount = this.getWordCount(email.body);
                const readTime = Math.ceil(wordCount / 250);
                return { summary, readTime };
            }

            throw new Error('Invalid API response');
            */

        } catch (error) {
            console.error('AI summary error:', error);
            const summary = this.getRuleBasedSummary(email);
            const wordCount = this.getWordCount(email.body);
            const readTime = Math.ceil(wordCount / 250);
            return { summary, readTime };
        }
    }

    getRuleBasedSummary(email) {
        const cleanBody = email.body.replace(/<[^>]*>/g, ' ');
        const sentences = cleanBody.split(/[.!?]+/).filter(s => s.trim().length > 0);

        if (sentences.length === 0) {
            return `📧 ${email.subject}\n\n无内容摘要`;
        }

        const summary = sentences.slice(0, 2).join('. ') + '.';

        const hasMeeting = /meeting|会议|discuss|讨论|sync|agenda/i.test(cleanBody);
        const hasDeadline = /deadline|截止|due|before|by\s+\d+|ddl/i.test(cleanBody);
        const hasQuestion = /\?|问题|请问|求助|help|question/i.test(cleanBody);
        const hasAttachment = /附件|attach|file|document|pdf|doc/i.test(cleanBody);

        let prefix = '';
        if (hasMeeting && hasDeadline) prefix = '📅 Meeting + Deadline ';
        else if (hasMeeting) prefix = '👥 meeting ';
        else if (hasDeadline) prefix = '⏰ DDL ';
        else if (hasQuestion) prefix = '❓ Question ';
        else if (hasAttachment) prefix = '📎 Appendix ';

        return `${prefix}${email.subject}\n\n${summary}`;
    }

    getCurrentEmail() {
        if (!window.state) {
            if (typeof state !== 'undefined') {
                window.state = state;
            } else {
                return null;
            }
        }

        if (!window.state.selectedEmailId) return null;
        if (!window.state.emails || window.state.emails.length === 0) return null;

        return window.state.emails.find(e => e.id === window.state.selectedEmailId);
    }

    getWordCount(html) {
        const text = html.replace(/<[^>]*>/g, '');
        return text.split(/\s+/).length;
    }

    hide() {
        if (this.panel) {
            this.panel.style.display = 'none';
            console.log('🔒 The AI summary panel is now closed');
        }
    }
}

// ===== DCAF主控制器 =====
class DCAFController {
    constructor() {
        this.sensing = new SensingLayer();
        this.inference = new InferenceLayer(this.sensing);
        this.undoRedo = new UndoRedoSystem();
        this.adaptation = new AdaptationLayer(this.undoRedo);
        this.aiSummary = null;

        this.initialized = false;
        this.evaluationTimer = null;
        this.lastUserState = null;

        this.setupResetButton();
    }

    setupResetButton() {
        document.addEventListener('DOMContentLoaded', () => {
            const resetBtn = document.getElementById('resetAdaptationBtn');
            if (resetBtn) {
                resetBtn.addEventListener('click', () => {
                    this.resetAllAdaptations();
                });
            }
        });
    }

    init() {
        if (this.initialized) return;

        this.sensing.init();

        this.aiSummary = new AISummarySystem();

        const aiPanel = document.getElementById('aiControlPanel');
        if (aiPanel) {
            aiPanel.style.display = DCAF_CONFIG.USE_AI ? 'block' : 'none';
        }

        this.startMonitoring();

        this.initialized = true;
        console.log('DCAF initialized. Mode:', DCAF_CONFIG.USE_AI ? 'AI mode' : 'Rule-based mode');
    }

    startMonitoring() {
        this.evaluateAndAdapt();
        this.evaluationTimer = setInterval(() => {
            this.evaluateAndAdapt();
        }, DCAF_CONFIG.EVALUATION_INTERVAL);
    }

    stopMonitoring() {
        if (this.evaluationTimer) {
            clearInterval(this.evaluationTimer);
            this.evaluationTimer = null;
        }
    }

    async evaluateAndAdapt() {
        try {
            const userState = await this.inference.evaluateUserState();
            const previousState = this.lastUserState;
            this.lastUserState = userState;

            if (DCAF_CONFIG.DEBUG_MODE) {
                console.log('DCAF Assessment:', {
                    时间: new Date().toLocaleTimeString(),
                    model: DCAF_CONFIG.USE_AI ? '🤖 AI' : '📊 Rule',
                    认知负荷: userState.cognitiveLoad.toFixed(2),
                    分散度: userState.distractionLevel.toFixed(2),
                    阅读速度: userState.readingSpeed,
                    模式: userState.readingPattern,
                    来源: userState.source
                });
            }

            if (userState.cognitiveLoad > 0.3 || userState.distractionLevel > 0.2) {
                const strategy = this.adaptation.determineStrategy(userState);
                this.adaptation.applyStrategy(strategy, previousState);
            }

        } catch (error) {
            console.error('DCAF evaluation error:', error);
        }
    }

    async manualEvaluate() {
        await this.evaluateAndAdapt();
    }

    resetAllAdaptations() {
        this.adaptation.resetAllAdaptations();
        this.undoRedo.reset();
        this.showToast('All interface adjustments have been reset', 'success');
    }

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast-message toast-${type}`;
        toast.textContent = message;
        toast.style.backgroundColor = type === 'success' ? '#28a745' : '#007bff';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }
}

// ===== 全局实例 =====
window.dcaf = new DCAFController();

// ===== 键盘快捷键 =====
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (window.dcaf) window.dcaf.undoRedo.undo();
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
        e.preventDefault();
        if (window.dcaf) window.dcaf.undoRedo.redo();
    }
});