import { getContext } from "../../../extensions.js";
import { getPastCharacterChats } from '../../../../script.js';

const extensionName = "st-intimacy-heatmap";
const extensionCss = `/scripts/extensions/third-party/${extensionName}/style.css`;

let intimacyState = {
    calendarMonths: [],
    currentMonthIndex: 0,
    stats: null
};

// === 1. 并发控制器 (用于全局统计) ===
async function asyncPool(poolLimit, array, iteratorFn, onProgress) {
    const ret = [];
    const executing = [];
    let completed = 0;
    const total = array.length;

    for (const item of array) {
        const p = Promise.resolve().then(() => iteratorFn(item));
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

// === 2. 工具函数 ===
const monthMap = {
    Jan: '01', January: '01', Feb: '02', February: '02', Mar: '03', March: '03',
    Apr: '04', April: '04', May: '05', May: '05', Jun: '06', June: '06',
    Jul: '07', July: '07', Aug: '08', August: '08', Sep: '09', September: '09',
    Oct: '10', October: '10', Nov: '11', November: '11', Dec: '12', December: '12'
};

function parseSTDate(dateString) {
    if (!dateString) return null;
    if (typeof dateString === 'number') return new Date(dateString);

    // 尝试解析 SillyTavern 常见格式: "Month Day, Year HH:MMam/pm"
    const parts = dateString.match(/(\w+)\s+(\d+),\s+(\d+)\s+(\d+):(\d+)(am|pm)/i);
    if (parts) {
        const month = monthMap[parts[1]] || '01';
        let h = parseInt(parts[4]);
        if (parts[6].toLowerCase() === 'pm' && h !== 12) h += 12;
        if (parts[6].toLowerCase() === 'am' && h === 12) h = 0;
        const iso = `${parts[3]}-${month}-${parts[2].padStart(2,'0')}T${String(h).padStart(2,'0')}:${parts[5]}:00`;
        return new Date(iso);
    }
    
    // 兜底尝试
    const d = new Date(dateString);
    return isNaN(d.getTime()) ? null : d;
}

// === 3. 核心数据获取逻辑 (Reference.js 思路) ===

// 获取单个文件的内容 (通过 URL Fetch)
async function fetchChatFileContent(folderName, fileName) {
    // 尝试两种常见的路径结构
    // 1. /chats/FolderName/FileName (ID based)
    // 2. /chats/EncodedName/FileName (Name based)
    
    // 优先使用 ID/文件夹名
    let url = `/chats/${folderName}/${encodeURIComponent(fileName)}`;
    
    try {
        let res = await fetch(url, { method: 'GET' });
        
        if (!res.ok) {
            // 如果 ID 路径失败，尝试从文件名解析角色名作为文件夹
            // 假设文件名格式 "CharName - Date.jsonl"
            const charNameFromFill = fileName.split(' - ')[0];
            if (charNameFromFill) {
                url = `/chats/${encodeURIComponent(charNameFromFill)}/${encodeURIComponent(fileName)}`;
                res = await fetch(url, { method: 'GET' });
            }
        }

        if (res.ok) {
            const text = await res.text();
            const lines = text.trim().split('\n');
            const messages = [];
            lines.forEach(line => {
                try {
                    const json = JSON.parse(line);
                    // 过滤掉只有元数据没有日期的行
                    if (json.send_date) messages.push(json);
                } catch(e) {}
            });
            return messages;
        }
    } catch (e) {
        console.warn(`Failed to fetch ${url}`, e);
    }
    return [];
}

// 获取单个角色的所有聊天记录
async function getCharacterMessages(avatarId) {
    try {
        // 1. 使用 ST 提供的 script.js 函数获取文件列表 (元数据)
        const chats = await getPastCharacterChats(avatarId);
        if (!chats || chats.length === 0) return [];

        // 2. 提取文件夹名 (去除扩展名)
        const folderName = avatarId.replace(/\.[^/.]+$/, "");

        // 3. 并发读取该角色的所有文件内容 (限制并发数为 5)
        const allFileMessages = await asyncPool(5, chats, async (chatMeta) => {
            return await fetchChatFileContent(folderName, chatMeta.file_name);
        });

        return allFileMessages.flat();
    } catch (e) {
        console.error("Error fetching char chats:", e);
        return [];
    }
}

// 获取全局所有角色的聊天记录
async function getGlobalMessages(onProgress) {
    const context = getContext();
    const characters = context.characters;
    // 过滤掉无效角色（没有 avatar 字段的）
    const validChars = characters.filter(c => c && c.avatar);
    
    // 全局并发读取 (限制并发数为 3 个角色同时读取，防止 IO 爆炸)
    const results = await asyncPool(3, validChars, async (char) => {
        return await getCharacterMessages(char.avatar);
    }, onProgress);

    return results.flat();
}

// === 4. 统计计算逻辑 (移植自 App.vue) ===
function calculateStats(messages) {
    if (!messages.length) return null;

    // 按时间排序
    messages.sort((a, b) => parseSTDate(a.send_date) - parseSTDate(b.send_date));

    const dayMap = new Map();
    let totalChars = 0;
    let totalRerolls = 0;

    messages.forEach(msg => {
        const content = msg.mes || "";
        const len = content.length;
        totalChars += len;
        // 简单判断 swipe: 如果 swipes 数组长度 > 1，说明重试过
        if (msg.swipes && Array.isArray(msg.swipes) && msg.swipes.length > 1) {
            totalRerolls += (msg.swipes.length - 1);
        }

        const date = parseSTDate(msg.send_date);
        if (date) {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            const dateStr = `${y}-${m}-${d}`;

            if (!dayMap.has(dateStr)) dayMap.set(dateStr, { count: 0, chars: 0 });
            const dData = dayMap.get(dateStr);
            dData.count++;
            dData.chars += len;
        }
    });

    const firstDate = parseSTDate(messages[0].send_date);
    const lastDate = parseSTDate(messages[messages.length - 1].send_date) || new Date();

    // 生成日历月数据
    const monthsData = [];
    let curY = firstDate.getFullYear();
    let curM = firstDate.getMonth();
    const endY = lastDate.getFullYear();
    const endM = lastDate.getMonth();

    while (curY < endY || (curY === endY && curM <= endM)) {
        const daysInMonth = new Date(curY, curM + 1, 0).getDate();
        const firstDayObj = new Date(curY, curM, 1);
        const paddingStart = firstDayObj.getDay();

        const days = [];
        let mCount = 0;
        let mChars = 0;

        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${curY}-${String(curM + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const data = dayMap.get(dateStr) || { count: 0, chars: 0 };
            
            mCount += data.count;
            mChars += data.chars;

            let level = 0;
            if (data.count > 0) level = 1;
            if (data.count > 20) level = 2;
            if (data.count > 50) level = 3;
            if (data.count > 100) level = 4;

            days.push({ dayNum: d, dateStr, count: data.count, chars: data.chars, level });
        }

        monthsData.push({
            year: curY, month: curM + 1, paddingStart, days,
            totalCount: mCount, totalChars: mChars
        });

        curM++;
        if (curM > 11) { curM = 0; curY++; }
    }

    return {
        firstDate: firstDate.toLocaleDateString(),
        daysSince: Math.floor((new Date() - firstDate) / 86400000),
        activeDays: dayMap.size,
        totalMessages: messages.length,
        totalChars,
        totalRerolls,
        calendarMonths: monthsData.reverse() // 倒序，最近的月份在前
    };
}

// === 5. UI 渲染逻辑 ===

function renderModalUI(title) {
    const s = intimacyState.stats;
    if (!s) return;

    const html = `
    <div id="st-intimacy-overlay">
        <div class="st-intimacy-dialog">
            <div class="st-intimacy-header">
                <h3><i class="fa-solid fa-heart-pulse"></i> ${title}</h3>
                <div class="st-btn-group">
                    <button id="st-btn-global" class="st-intimacy-btn" title="计算所有角色的总数据">🌍 全局统计</button>
                    <button class="st-close-btn" id="st-close-overlay">×</button>
                </div>
            </div>
            
            <div class="st-intimacy-body">
                <div id="st-intimacy-loading" style="display:none;">
                    <div class="loading-spinner"><i class="fa-solid fa-circle-notch fa-spin"></i></div>
                    <div id="st-loading-text">正在读取数据...</div>
                </div>

                <div class="st-stats-grid">
                    <div class="st-stat-card">
                        <div class="st-stat-label">初次相遇</div>
                        <div class="st-stat-value" style="font-size:1.2rem">${s.firstDate}</div>
                        <div class="st-stat-sub">距今 ${s.daysSince} 天</div>
                    </div>
                    <div class="st-stat-card">
                        <div class="st-stat-label">活跃天数</div>
                        <div class="st-stat-value">${s.activeDays}</div>
                        <div class="st-stat-sub">天</div>
                    </div>
                    <div class="st-stat-card">
                        <div class="st-stat-label">消息总数</div>
                        <div class="st-stat-value">${s.totalMessages}</div>
                        <div class="st-stat-sub">${(s.totalChars / 10000).toFixed(1)}万 字</div>
                    </div>
                    <div class="st-stat-card">
                        <div class="st-stat-label">重Roll次数</div>
                        <div class="st-stat-value">${s.totalRerolls}</div>
                        <div class="st-stat-sub">命运分歧</div>
                    </div>
                </div>

                <div class="st-calendar-container">
                    <div class="st-calendar-nav">
                        <button class="st-intimacy-btn" id="st-cal-prev">◀</button>
                        <div class="st-month-title" id="st-cal-title">...</div>
                        <button class="st-intimacy-btn" id="st-cal-next">▶</button>
                    </div>
                    <div id="st-cal-grid" class="st-month-grid"></div>
                </div>
            </div>
        </div>
        <div id="st-heatmap-tooltip"></div>
    </div>
    `;

    $('body').append(html);
    $('#st-intimacy-overlay').css('display', 'flex');

    // 绑定事件
    $('#st-close-overlay').click(() => $('#st-intimacy-overlay').remove());
    $('#st-intimacy-overlay').click((e) => {
        if (e.target.id === 'st-intimacy-overlay') $('#st-intimacy-overlay').remove();
    });

    $('#st-cal-prev').click(() => {
        if (intimacyState.currentMonthIndex < intimacyState.calendarMonths.length - 1) {
            intimacyState.currentMonthIndex++;
            renderMonth();
        }
    });

    $('#st-cal-next').click(() => {
        if (intimacyState.currentMonthIndex > 0) {
            intimacyState.currentMonthIndex--;
            renderMonth();
        }
    });

    // 切换全局统计
    $('#st-btn-global').click(async () => {
        if (!confirm("全局统计需要读取所有角色的所有聊天记录，可能会花费一些时间（取决于文件数量）。是否继续？")) return;
        
        $('#st-intimacy-loading').show();
        $('#st-btn-global').hide(); // 隐藏按钮防止重复点击
        
        // 延迟一下让UI渲染Loading
        setTimeout(async () => {
            try {
                const msgs = await getGlobalMessages((done, total) => {
                    $('#st-loading-text').text(`正在分析角色 (${done}/${total})...`);
                });
                
                $('#st-loading-text').text("正在生成热力图...");
                const globalStats = calculateStats(msgs);
                
                if (globalStats) {
                    intimacyState.stats = globalStats;
                    intimacyState.calendarMonths = globalStats.calendarMonths;
                    intimacyState.currentMonthIndex = 0;
                    
                    // 重新渲染整个 Modal (简单粗暴的方法来更新所有数据)
                    $('#st-intimacy-overlay').remove();
                    renderModalUI(`全局统计 (共 ${globalStats.activeDays} 天活跃)`);
                    $('#st-btn-global').hide(); // 全局模式下不再显示全局按钮
                } else {
                    alert("未找到有效数据");
                    $('#st-intimacy-loading').hide();
                }
            } catch (e) {
                console.error(e);
                alert("统计失败: " + e.message);
                $('#st-intimacy-loading').hide();
            }
        }, 100);
    });

    renderMonth();
}

function renderMonth() {
    const months = intimacyState.calendarMonths;
    const idx = intimacyState.currentMonthIndex;
    
    if (!months || months.length === 0) {
        $('#st-cal-grid').html('<div style="grid-column:1/-1;text-align:center;padding:20px">无数据</div>');
        return;
    }

    const mData = months[idx];
    $('#st-cal-title').text(`${mData.year}年 ${mData.month}月`);
    
    // 更新按钮状态
    $('#st-cal-prev').prop('disabled', idx >= months.length - 1);
    $('#st-cal-next').prop('disabled', idx <= 0);

    let html = '';
    // Header
    const days = ['日','一','二','三','四','五','六'];
    days.forEach(d => html += `<div class="st-day-header">${d}</div>`);
    
    // Padding
    for(let i=0; i<mData.paddingStart; i++) html += `<div class="st-day-cell padding"></div>`;
    
    // Days
    mData.days.forEach(d => {
        const hasData = d.count > 0;
        const cls = hasData ? `has-data level-${d.level}` : '';
        html += `<div class="st-day-cell ${cls}" 
                  data-date="${d.dateStr}" 
                  data-count="${d.count}" 
                  data-chars="${d.chars}">${d.dayNum}</div>`;
    });

    $('#st-cal-grid').html(html);

    // Tooltip Events
    $('.st-day-cell.has-data').on('mouseenter', function(e) {
        const $t = $(this);
        $('#st-heatmap-tooltip').html(`
            <strong>${$t.data('date')}</strong><br>
            💬 消息: ${$t.data('count')}<br>
            📝 字数: ${$t.data('chars')}
        `).show();
        moveTooltip(e);
    }).on('mouseleave', () => $('#st-heatmap-tooltip').hide())
      .on('mousemove', moveTooltip);
}

function moveTooltip(e) {
    const $tip = $('#st-heatmap-tooltip');
    let x = e.clientX + 15;
    let y = e.clientY + 15;
    // 简单防溢出
    if (x + $tip.width() > $(window).width()) x -= ($tip.width() + 30);
    $tip.css({top: y, left: x});
}

// === 6. 主入口 ===
async function openIntimacyHeatmap() {
    const context = getContext();
    const charId = context.characterId;
    
    // 如果没有选择角色，直接询问是否进行全局统计
    if (charId === undefined || charId === null) {
        if(confirm("当前未加载角色。是否进行全员【全局统计】？")) {
            $('#st-btn-global').click(); // 模拟点击逻辑需要在UI渲染后，这里我们直接调用逻辑
            // 为了复用代码，先渲染一个空的Loading状态UI
            intimacyState.stats = { firstDate:'-', daysSince:0, activeDays:0, totalMessages:0, totalChars:0, totalRerolls:0 };
            renderModalUI("全局数据加载中...");
            $('#st-btn-global').click(); // 触发加载
        }
        return;
    }

    // 加载当前角色数据
    const charName = context.characters[charId].name;
    const avatar = context.characters[charId].avatar;
    
    // 显示简单的 Loading toast
    toastr.info(`正在读取 ${charName} 的历史记录...`);
    
    const msgs = await getCharacterMessages(avatar);
    const stats = calculateStats(msgs);
    
    if (stats) {
        intimacyState.stats = stats;
        intimacyState.calendarMonths = stats.calendarMonths;
        intimacyState.currentMonthIndex = 0;
        renderModalUI(`${charName} 的情感档案`);
    } else {
        toastr.warning("未找到该角色的聊天记录");
    }
}

jQuery(async () => {
    // 加载 CSS
    $('head').append(`<link rel="stylesheet" type="text/css" href="${extensionCss}">`);

    // 添加菜单按钮 (参考 index.js 的样式)
    const menuBtn = `
        <div id="st-intimacy-trigger" class="list-group-item" style="cursor:pointer; display:flex; align-items:center;">
            <span style="margin-right:10px; width:20px; text-align:center;">
                <i class="fa-solid fa-heart-pulse" style="color: #e91e63;"></i>
            </span>
            <span>情感档案</span>
        </div>
    `;

    // 延时注入，确保 #extensionsMenu 存在
    const intv = setInterval(() => {
        if ($('#extensionsMenu').length > 0) {
            $('#extensionsMenu').append(menuBtn);
            clearInterval(intv);
            
            // 绑定点击事件
            $('#st-intimacy-trigger').on('click', openIntimacyHeatmap);
        }
    }, 500);

    console.log(`${extensionName} loaded.`);
});