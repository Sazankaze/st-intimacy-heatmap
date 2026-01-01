/*
    SillyTavern Extension: Intimacy Heatmap (Ultimate Global Version)
    Features: Single Character History & Global All-Characters Stats
*/

(function () {
    const extensionName = "st-intimacy-heatmap";

    // 状态存储
    let intimacyData = {
        calendarMonths: [],
        currentMonthIndex: 0
    };

    // 简单的并发控制器
    async function asyncPool(poolLimit, array, iteratorFn, onProgress) {
        const ret = [];
        const executing = [];
        let completed = 0;
        const total = array.length;

        for (const item of array) {
            const p = Promise.resolve().then(() => iteratorFn(item, array));
            ret.push(p);

            const e = p.then(() => {
                executing.splice(executing.indexOf(e), 1);
                completed++;
                if (onProgress) onProgress(completed, total);
            });
            executing.push(e);

            if (executing.length >= poolLimit) {
                await Promise.race(executing);
            }
        }
        return Promise.all(ret);
    }

    // === 工具函数 ===

    function parseSTDate(dateInput) {
        if (!dateInput) return null;
        if (typeof dateInput === 'number') return new Date(dateInput);
        let dateStr = String(dateInput).trim();
        
        if (dateStr.includes('@')) {
            try {
                const isoStr = dateStr.replace('@', 'T').replace('h', ':').replace('m', ':').replace('s', '');
                const d = new Date(isoStr);
                if (!isNaN(d.getTime())) return d;
            } catch (e) {}
        }
        
        let d = new Date(dateStr);
        if (!isNaN(d.getTime())) return d;
        
        if (/am|pm/i.test(dateStr) && !/\s(am|pm)/i.test(dateStr)) {
            const fixedStr = dateStr.replace(/(\d)(am|pm)/i, '$1 $2');
            d = new Date(fixedStr);
            if (!isNaN(d.getTime())) return d;
        }
        return null;
    }

    // === 核心统计逻辑 ===

    function calculateStats(messages) {
        if (!messages || !messages.length) return null;
        
        const validMessages = messages.filter(m => m.send_date);
        if (!validMessages.length) return null;

        // 排序
        const sortedMsgs = [...validMessages].sort((a, b) => {
            const tA = parseSTDate(a.send_date)?.getTime() || 0;
            const tB = parseSTDate(b.send_date)?.getTime() || 0;
            return tA - tB;
        });

        let totalChars = 0;
        let totalRerolls = 0;
        const dayMap = new Map();

        sortedMsgs.forEach(msg => {
            const content = msg.mes || ""; 
            const msgLen = content.length;
            
            if (content) totalChars += msgLen;
            if (msg.swipes && msg.swipes.length > 1) totalRerolls += (msg.swipes.length - 1);

            const date = parseSTDate(msg.send_date);
            if (date) {
                const y = date.getFullYear();
                const m = String(date.getMonth() + 1).padStart(2, '0');
                const d = String(date.getDate()).padStart(2, '0');
                const dateStr = `${y}-${m}-${d}`;

                if (!dayMap.has(dateStr)) {
                    dayMap.set(dateStr, { count: 0, chars: 0 });
                }
                const dayData = dayMap.get(dateStr);
                dayData.count += 1;
                dayData.chars += msgLen;
            }
        });

        // 日历数据生成
        const firstDateObj = parseSTDate(sortedMsgs[0].send_date);
        const lastDateObj = new Date(); 
        const monthsData = [];
        
        if (firstDateObj) {
            let currentYear = firstDateObj.getFullYear();
            let currentMonth = firstDateObj.getMonth();
            const endYear = lastDateObj.getFullYear();
            const endMonth = lastDateObj.getMonth();

            while (currentYear < endYear || (currentYear === endYear && currentMonth <= endMonth)) {
                const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
                const firstDayObj = new Date(currentYear, currentMonth, 1);
                const paddingStart = firstDayObj.getDay(); 

                const days = [];
                let monthTotalCount = 0;
                let monthTotalChars = 0;

                for (let d = 1; d <= daysInMonth; d++) {
                    const mStr = String(currentMonth + 1).padStart(2, '0');
                    const dStr = String(d).padStart(2, '0');
                    const dateStr = `${currentYear}-${mStr}-${dStr}`;
                    
                    const data = dayMap.get(dateStr) || { count: 0, chars: 0 };
                    
                    let level = 0;
                    if (data.count > 0) level = 1;
                    if (data.count > 50) level = 2; // 全局统计阈值适当提高
                    if (data.count > 150) level = 3;
                    if (data.count > 300) level = 4;

                    days.push({
                        dayNum: d,
                        dateStr: dateStr,
                        count: data.count,
                        chars: data.chars,
                        level: level
                    });
                    
                    monthTotalCount += data.count;
                    monthTotalChars += data.chars;
                }

                monthsData.push({
                    year: currentYear,
                    month: currentMonth + 1,
                    paddingStart: paddingStart,
                    days: days,
                    totalCount: monthTotalCount,
                    totalChars: monthTotalChars
                });

                currentMonth++;
                if (currentMonth > 11) {
                    currentMonth = 0;
                    currentYear++;
                }
            }
        }

        const now = new Date();
        const daysSince = Math.floor((now - firstDateObj) / (24 * 3600 * 1000));

        return {
            firstDate: firstDateObj ? firstDateObj.toLocaleDateString() : 'N/A',
            daysSince: daysSince,
            activeDays: dayMap.size,
            totalMessages: sortedMsgs.length,
            totalChars: totalChars,
            totalRerolls: totalRerolls,
            calendarMonths: monthsData.reverse()
        };
    }

    // === 数据获取逻辑 ===

    // 获取单个角色的所有聊天文件内容
    async function fetchAllChatsForCharacter(avatarUrl) {
        try {
            const chatList = await jQuery.post('/api/chats/list', { avatar_url: avatarUrl });
            if (!chatList || !Array.isArray(chatList) || chatList.length === 0) return [];

            // 并发获取该角色的所有聊天，限制并发数为 5
            const results = await asyncPool(5, chatList, (fileName) => {
                return jQuery.post('/api/chats/get', { avatar_url: avatarUrl, file_name: fileName })
                    .then(data => Array.isArray(data) ? data : [])
                    .catch(err => []);
            });

            return results.flat();
        } catch (error) {
            console.warn(`Failed to fetch chats for ${avatarUrl}`, error);
            return [];
        }
    }

    // 更新 Loading 提示文字
    function updateLoadingText(text, subtext = "") {
        const $loading = $('#intimacy-loading');
        if ($loading.length) {
            $loading.find('.loading-text').text(text);
            $loading.find('.loading-subtext').text(subtext);
        }
    }

    // 获取所有角色的数据（全局模式）
    async function fetchGlobalData() {
        const characters = SillyTavern.getContext().characters;
        // 过滤出有效的角色（排除 null 或无效项）
        const validChars = characters.filter(c => c && c.avatar);
        const totalChars = validChars.length;
        
        let allMessages = [];
        let processedCount = 0;

        updateLoadingText(`准备读取 ${totalChars} 个角色...`);

        // 使用 asyncPool 限制并发角色数为 3 (每个角色内部还会并发5个请求，所以总并发大概15左右，避免炸服)
        const charResults = await asyncPool(3, validChars, async (char) => {
            const msgs = await fetchAllChatsForCharacter(char.avatar);
            return msgs;
        }, (completed, total) => {
            // 进度回调
            updateLoadingText(`正在读取角色 (${completed}/${total})`, `当前进度: ${Math.round(completed/total*100)}%`);
        });

        // 合并结果
        updateLoadingText("正在合并时间线...", "即将完成");
        // charResults 是一个数组，每个元素是该角色的消息数组 [ [msg, msg], [msg, msg] ]
        // 使用 flat 展平
        allMessages = charResults.flat();
        
        return allMessages;
    }

    // === UI 构建 ===

    function renderCalendarGrid(monthData) {
        if (!monthData) return '<div style="text-align:center;padding:20px;">无数据</div>';

        let html = `
            <div class="intimacy-month-card">
                <div class="intimacy-month-grid">
                    <div class="intimacy-day-header">日</div>
                    <div class="intimacy-day-header">一</div>
                    <div class="intimacy-day-header">二</div>
                    <div class="intimacy-day-header">三</div>
                    <div class="intimacy-day-header">四</div>
                    <div class="intimacy-day-header">五</div>
                    <div class="intimacy-day-header">六</div>
        `;

        for (let i = 0; i < monthData.paddingStart; i++) {
            html += `<div class="intimacy-day-cell padding"></div>`;
        }

        monthData.days.forEach(day => {
            const hasDataClass = day.count > 0 ? 'has-data' : '';
            const levelClass = day.count > 0 ? `intimacy-level-${day.level}` : '';
            
            const tooltipHtml = `
                <div class="intimacy-tooltip">
                    ${day.dateStr}<br>
                    消息: ${day.count}<br>
                    字数: ${day.chars}
                </div>
            `;

            html += `
                <div class="intimacy-day-cell ${hasDataClass} ${levelClass}">
                    ${day.dayNum}
                    ${day.count > 0 ? tooltipHtml : ''}
                </div>
            `;
        });

        html += `</div>
            <div style="text-align:center; font-size:0.8rem; margin-top:10px; opacity:0.7;">
                本月消息: ${monthData.totalCount} | 字数: ${monthData.totalChars}
            </div>
        </div>`;
        
        return html;
    }

    function updateCalendarView(container) {
        const monthData = intimacyData.calendarMonths[intimacyData.currentMonthIndex];
        const gridContainer = container.find('#intimacy-calendar-container');
        const label = container.find('#intimacy-month-label');
        
        if(monthData) {
            gridContainer.html(renderCalendarGrid(monthData));
            label.text(`${monthData.year}年 ${monthData.month}月`);
        } else {
            gridContainer.html('<div style="padding:20px;text-align:center">暂无数据</div>');
            label.text("无数据");
        }
        
        container.find('#btn-prev-month').prop('disabled', intimacyData.currentMonthIndex >= intimacyData.calendarMonths.length - 1);
        container.find('#btn-next-month').prop('disabled', intimacyData.currentMonthIndex <= 0);
    }

    function showLoading() {
        const loadingHtml = `
            <div class="intimacy-plugin-overlay" id="intimacy-loading">
                <div class="intimacy-plugin-dialog" style="max-width:300px; height:180px; justify-content:center; align-items:center;">
                    <div style="font-size:1.5rem; margin-bottom:15px; color:#e91e63;">
                        <i class="fa-solid fa-heart fa-beat"></i>
                    </div>
                    <div class="loading-text" style="font-weight:bold; margin-bottom:5px;">正在读取记忆回路...</div>
                    <div class="loading-subtext" style="font-size:0.8rem; opacity:0.6;">请稍候</div>
                </div>
            </div>
        `;
        $('body').append(loadingHtml);
    }

    function hideLoading() {
        $('#intimacy-loading').remove();
    }

    function renderModal(title, stats) {
        // 先移除旧的（如果有）
        $('#intimacy-overlay').remove();
        
        intimacyData.calendarMonths = stats.calendarMonths;
        intimacyData.currentMonthIndex = 0;

        const modalHtml = `
            <div class="intimacy-plugin-overlay" id="intimacy-overlay">
                <div class="intimacy-plugin-dialog">
                    <div class="intimacy-header">
                        <h3><i class="fa-solid fa-heart" style="color:#e91e63;"></i> ${title}</h3>
                        <div style="display:flex; gap:10px; align-items:center;">
                            <button id="btn-switch-global" class="intimacy-nav-btn" style="width:auto; padding:0 10px; font-size:0.8rem;" title="计算所有角色的总和">
                                🌍 全局统计
                            </button>
                            <button class="intimacy-close-btn" id="intimacy-close">×</button>
                        </div>
                    </div>
                    
                    <div class="intimacy-body">
                        <div class="intimacy-stats-grid">
                            <div class="intimacy-stat-card">
                                <div class="intimacy-stat-label">首次对话</div>
                                <div class="intimacy-stat-value" style="font-size:1rem; padding: 4px 0;">${stats.firstDate}</div>
                                <div class="intimacy-stat-sub">距今 ${stats.daysSince} 天</div>
                            </div>
                            <div class="intimacy-stat-card">
                                <div class="intimacy-stat-label">活跃天数</div>
                                <div class="intimacy-stat-value">${stats.activeDays} <span style="font-size:0.8rem">天</span></div>
                                <div class="intimacy-stat-sub">累计陪伴</div>
                            </div>
                            <div class="intimacy-stat-card">
                                <div class="intimacy-stat-label">消息总数</div>
                                <div class="intimacy-stat-value">${stats.totalMessages}</div>
                                <div class="intimacy-stat-sub">${(stats.totalChars / 10000).toFixed(2)}万 字</div>
                            </div>
                            <div class="intimacy-stat-card">
                                <div class="intimacy-stat-label">重Roll次数</div>
                                <div class="intimacy-stat-value">${stats.totalRerolls}</div>
                                <div class="intimacy-stat-sub">全时空汇总</div>
                            </div>
                        </div>

                        <div class="intimacy-calendar-section">
                            <div class="intimacy-calendar-nav">
                                <button class="intimacy-nav-btn" id="btn-next-month">◀</button>
                                <div style="font-weight:bold;" id="intimacy-month-label">加载中...</div>
                                <button class="intimacy-nav-btn" id="btn-prev-month">▶</button>
                            </div>
                            <div id="intimacy-calendar-container"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        $('body').append(modalHtml);
        const $overlay = $('#intimacy-overlay');
        
        // 绑定事件
        $overlay.find('#intimacy-close').on('click', () => $overlay.remove());
        $overlay.on('click', (e) => {
            if (e.target.id === 'intimacy-overlay') $overlay.remove();
        });

        // 切换到全局模式按钮
        $overlay.find('#btn-switch-global').on('click', async () => {
            $overlay.remove(); // 关闭当前窗口
            await initGlobalMode(); // 开启全局模式
        });

        // 翻页逻辑
        $overlay.find('#btn-next-month').on('click', () => {
             if (intimacyData.currentMonthIndex < intimacyData.calendarMonths.length - 1) {
                 intimacyData.currentMonthIndex++;
                 updateCalendarView($overlay);
             }
        });
        
        $overlay.find('#btn-prev-month').on('click', () => {
             if (intimacyData.currentMonthIndex > 0) {
                 intimacyData.currentMonthIndex--;
                 updateCalendarView($overlay);
             }
        });

        updateCalendarView($overlay);
    }

    // === 业务逻辑入口 ===

    async function initCharacterMode() {
        const context = SillyTavern.getContext();
        const charName = context.characters[context.characterId].name;
        const charAvatar = context.characters[context.characterId].avatar;

        showLoading();
        updateLoadingText(`读取 ${charName} 的记忆...`);

        try {
            const allMessages = await fetchAllChatsForCharacter(charAvatar);
            const stats = calculateStats(allMessages);
            hideLoading();

            if (!stats) {
                toastr.warning("该角色没有有效聊天记录", "提示");
                return;
            }
            renderModal(`${charName} - 情感档案`, stats);
        } catch (e) {
            hideLoading();
            console.error(e);
            toastr.error("读取失败", "错误");
        }
    }

    async function initGlobalMode() {
        showLoading();
        try {
            // 获取所有数据
            const allMessages = await fetchGlobalData();
            
            updateLoadingText("正在生成热力图...");
            // 给 UI 渲染留一点时间，防止界面卡死
            await new Promise(resolve => setTimeout(resolve, 100));

            const stats = calculateStats(allMessages);
            hideLoading();

            if (!stats) {
                toastr.warning("未找到任何聊天记录", "全局统计");
                return;
            }
            renderModal(`全员统计 (${stats.activeDays}天活跃)`, stats);
            
            // 全局模式下隐藏切换按钮，防止重复点击
            $('#btn-switch-global').hide();
            
        } catch (e) {
            hideLoading();
            console.error(e);
            toastr.error("全局统计失败，请检查控制台", "错误");
        }
    }

    async function handleTrigger() {
        const context = SillyTavern.getContext();
        
        // 如果当前有打开的角色，默认进入单人模式
        if (context.characterId) {
            await initCharacterMode();
        } else {
            // 如果没打开角色，直接询问是否进行全局统计
            if(confirm("当前未打开任何对话。是否要进行【全角色全局统计】？\n警告：角色较多时可能需要较长时间。")) {
                await initGlobalMode();
            }
        }
    }

    // === 插件加载 ===
    jQuery(document).ready(function () {
        const btnHtml = `
            <div class="intimacy-top-btn fa-solid fa-heart-pulse" id="intimacy-trigger" title="情感档案 / 全局统计"></div>
        `;
        
        if ($('#extensions-settings-button').length) {
            $('#extensions-settings-button').before(btnHtml);
        } else {
            $('.drawer-toggle').last().after(btnHtml);
        }

        $(document).on('click', '#intimacy-trigger', handleTrigger);
        
        console.log(`${extensionName} loaded (Ultimate Version).`);
    });
})();