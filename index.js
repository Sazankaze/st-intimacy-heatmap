import { getContext } from "../../../extensions.js";
import { getPastCharacterChats } from '../../../../script.js';

const extensionName = "st-intimacy-heatmap";
const extensionCss = `/scripts/extensions/third-party/${extensionName}/style.css`;

let intimacyState = {
    calendarMonths: [],
    currentMonthIndex: 0,
    stats: null
};

// === 1. 并发控制器 (Utility) ===
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

// === 2. 日期解析 (Utility) ===
const monthMap = {
    Jan: '01', January: '01', Feb: '02', February: '02', Mar: '03', March: '03',
    Apr: '04', April: '04', May: '05', Jun: '06', June: '06',
    Jul: '07', July: '07', Aug: '08', August: '08', Sep: '09', September: '09',
    Oct: '10', October: '10', Nov: '11', November: '11', Dec: '12', December: '12'
};

function parseSTDate(dateString) {
    if (!dateString) return null;
    if (typeof dateString === 'number') return new Date(dateString);

    const parts = dateString.match(/(\w+)\s+(\d+),\s+(\d+)\s+(\d+):(\d+)(am|pm)/i);
    if (parts) {
        const month = monthMap[parts[1]] || '01';
        let h = parseInt(parts[4]);
        if (parts[6].toLowerCase() === 'pm' && h !== 12) h += 12;
        if (parts[6].toLowerCase() === 'am' && h === 12) h = 0;
        const iso = `${parts[3]}-${month}-${parts[2].padStart(2,'0')}T${String(h).padStart(2,'0')}:${parts[5]}:00`;
        return new Date(iso);
    }
    
    if (dateString.includes('@')) {
        try {
            const isoStr = dateString.replace('@', 'T').replace('h', ':').replace('m', ':').replace('s', '');
            const d = new Date(isoStr);
            if (!isNaN(d.getTime())) return d;
        } catch(e) {}
    }

    const d = new Date(dateString);
    return isNaN(d.getTime()) ? null : d;
}

// === 3. 核心数据获取逻辑 (FIXED & ROBUST) ===

async function parseResponseText(res) {
    try {
        const text = await res.text();
        // 增加检查：如果返回的是 HTML (比如 404 页面)，则忽略
        if (!text || text.trim().startsWith("<!DOCTYPE") || text.trim().startsWith("<html")) return [];
        
        const lines = text.trim().split('\n');
        const messages = [];
        
        lines.forEach(line => {
            try {
                if (!line) return;
                const json = JSON.parse(line);
                if (json) messages.push(json); 
            } catch(e) { }
        });
        return messages;
    } catch (e) {
        console.error("Error parsing chat file text:", e);
        return [];
    }
}

async function fetchChatFileContent(folderNameFromAvatar, fileName) {
    if (!fileName) return [];

    const encodedFileName = encodeURIComponent(fileName);
    
    // 准备所有可能的路径尝试列表
    const pathsToTry = [];

    // 1. 基于头像的文件夹名称 (Encoded) - 标准情况
    if (folderNameFromAvatar) {
        pathsToTry.push(`/chats/${encodeURIComponent(folderNameFromAvatar)}/${encodedFileName}`);
        // 2. 基于头像的文件夹名称 (Raw) - 有些服务器配置不需要编码
        pathsToTry.push(`/chats/${folderNameFromAvatar}/${encodedFileName}`);
    }

    // 3. 基于文件名推断的文件夹名称 - 对应 Reference.js 的 fallback 逻辑
    // 例如文件名为 "黑田葵 - 2026..."，尝试去 "黑田葵" 文件夹找
    try {
        // 通常格式是 "CharName - Date.jsonl"
        const splitName = fileName.split(' - ');
        if (splitName.length > 1) {
            const charNameFromFile = splitName[0];
            if (charNameFromFile && charNameFromFile !== folderNameFromAvatar) {
                // 同样尝试编码和不编码两种情况
                pathsToTry.push(`/chats/${encodeURIComponent(charNameFromFile)}/${encodedFileName}`);
                pathsToTry.push(`/chats/${charNameFromFile}/${encodedFileName}`);
            }
        }
    } catch(e) {}

    // 4. 暴力尝试：不使用子文件夹（虽然很少见，但也试一下）
    // pathsToTry.push(`/chats/${encodedFileName}`);

    // === 开始逐个尝试 ===
    for (const path of pathsToTry) {
        try {
            const res = await fetch(path, { method: 'GET', credentials: 'same-origin' });
            // 只有状态码为 200 OK 才视为成功
            if (res.ok) {
                // 成功！解析并返回
                return await parseResponseText(res);
            }
            // 如果是 404，for 循环会继续尝试下一个 path
        } catch (e) {
            // 网络错误等，继续尝试下一个
        }
    }

    // 所有尝试都失败了
    // console.warn(`[Intimacy] Failed to fetch ${fileName} after ${pathsToTry.length} attempts.`);
    return [];
}

async function getCharacterMessages(charIndex, avatarFileName) {
    try {
        const chats = await getPastCharacterChats(charIndex);
        
        if (!chats || !Array.isArray(chats) || chats.length === 0) {
            return [];
        }

        // 从头像文件名中提取基础文件夹名 (移除 .png 等后缀)
        let folderName = avatarFileName;
        const lastDotIndex = avatarFileName.lastIndexOf('.');
        if (lastDotIndex > 0) {
            folderName = avatarFileName.substring(0, lastDotIndex);
        }
        
        const allFileMessages = await asyncPool(5, chats, async (chatMeta) => {
            if (!chatMeta || !chatMeta.file_name) return [];
            return await fetchChatFileContent(folderName, chatMeta.file_name);
        });

        return allFileMessages.flat();
    } catch (e) {
        console.error(`[Intimacy] Error processing character ${avatarFileName}:`, e);
        return [];
    }
}

// 获取全局所有角色的聊天记录
async function getGlobalMessages(onProgress) {
    const context = getContext();
    if (!context || !context.characters) {
        return [];
    }

    const characters = context.characters;
    const validTasks = characters
        .map((char, index) => ({ char, index }))
        .filter(task => task.char && task.char.avatar && typeof task.char.avatar === 'string');
    
    const results = await asyncPool(3, validTasks, async (task) => {
        return await getCharacterMessages(task.index, task.char.avatar);
    }, onProgress);

    return results.flat();
}

// === 4. 统计计算逻辑 ===
function calculateStats(messages) {
    if (!messages || messages.length === 0) return null;

    const validMessages = [];
    messages.forEach(m => {
        if (m.send_date && parseSTDate(m.send_date)) validMessages.push(m);
    });

    if (validMessages.length === 0) return null;

    validMessages.sort((a, b) => parseSTDate(a.send_date) - parseSTDate(b.send_date));

    const dayMap = new Map();
    let totalChars = 0;
    let totalRerolls = 0;

    validMessages.forEach(msg => {
        const content = msg.mes || "";
        const len = content.length;
        totalChars += len;
        
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

    const firstDate = parseSTDate(validMessages[0].send_date);
    const lastDate = parseSTDate(validMessages[validMessages.length - 1].send_date) || new Date();

    const monthsData = [];
    let curY = firstDate.getFullYear();
    let curM = firstDate.getMonth();
    const endY = lastDate.getFullYear();
    const endM = lastDate.getMonth();

    let loopGuard = 0;
    while ((curY < endY || (curY === endY && curM <= endM)) && loopGuard < 1200) {
        loopGuard++;
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
        totalMessages: validMessages.length,
        totalChars,
        totalRerolls,
        calendarMonths: monthsData.reverse()
    };
}

// === 5. UI 渲染逻辑 ===
function renderModalUI(title) {
    const s = intimacyState.stats;
    if (!s) return;

    $('#st-intimacy-overlay').remove();

    const html = `
    <div id="st-intimacy-overlay">
        <div class="st-intimacy-dialog">
            <div class="st-intimacy-header">
                <h3><i class="fa-solid fa-heart-pulse" style="margin-right:10px; color:#e91e63"></i> ${title}</h3>
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

    $('#st-btn-global').click(async () => {
        if (!confirm("全局统计需要读取所有角色的所有聊天记录，可能会花费一些时间。是否继续？")) return;
        
        const $btn = $('#st-btn-global');
        $btn.prop('disabled', true).text('计算中...');
        $('#st-intimacy-loading').show();
        
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
                    
                    $('#st-intimacy-overlay').remove();
                    renderModalUI(`全局统计 (共 ${globalStats.activeDays} 天活跃)`);
                    $('#st-btn-global').hide();
                } else {
                    toastr.warning("未找到有效数据");
                    $('#st-intimacy-loading').hide();
                    $btn.prop('disabled', false).text('🌍 全局统计');
                }
            } catch (e) {
                console.error(e);
                toastr.error("统计失败: " + e.message);
                $('#st-intimacy-loading').hide();
                $btn.prop('disabled', false).text('🌍 全局统计');
            }
        }, 100);
    });

    renderMonth();
}

function renderMonth() {
    const months = intimacyState.calendarMonths;
    const idx = intimacyState.currentMonthIndex;
    
    if (!months || months.length === 0) {
        $('#st-cal-grid').html('<div style="grid-column:1/-1;text-align:center;padding:20px;color:#888;">无数据 / 日期解析失败</div>');
        return;
    }

    const mData = months[idx];
    $('#st-cal-title').text(`${mData.year}年 ${mData.month}月`);
    
    $('#st-cal-prev').prop('disabled', idx >= months.length - 1);
    $('#st-cal-next').prop('disabled', idx <= 0);

    let html = '';
    const days = ['日','一','二','三','四','五','六'];
    days.forEach(d => html += `<div class="st-day-header">${d}</div>`);
    
    for(let i=0; i<mData.paddingStart; i++) html += `<div class="st-day-cell padding"></div>`;
    
    mData.days.forEach(d => {
        const hasData = d.count > 0;
        const cls = hasData ? `has-data level-${d.level}` : '';
        html += `<div class="st-day-cell ${cls}" 
                  data-date="${d.dateStr}" 
                  data-count="${d.count}" 
                  data-chars="${d.chars}">${d.dayNum}</div>`;
    });

    $('#st-cal-grid').html(html);

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
    if (x + $tip.width() > $(window).width()) x -= ($tip.width() + 30);
    if (y + $tip.height() > $(window).height()) y -= ($tip.height() + 30);
    $tip.css({top: y, left: x});
}

// === 6. 主入口 ===
async function openIntimacyHeatmap() {
    const context = getContext();
    const charId = context.characterId;
    
    if (charId === undefined || charId === null) {
        if(confirm("当前未加载角色。是否进行全员【全局统计】？")) {
            intimacyState.stats = { firstDate:'-', daysSince:0, activeDays:0, totalMessages:0, totalChars:0, totalRerolls:0 };
            renderModalUI("全局数据加载中...");
            $('#st-btn-global').click();
        }
        return;
    }

    const charName = context.characters[charId].name;
    const avatar = context.characters[charId].avatar;
    
    toastr.info(`正在读取 ${charName} 的历史记录...`);
    
    const msgs = await getCharacterMessages(charId, avatar);
    
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
    $('head').append(`<link rel="stylesheet" type="text/css" href="${extensionCss}">`);

    const menuBtn = `
        <div id="st-intimacy-trigger" class="list-group-item" style="cursor:pointer; display:flex; align-items:center;">
            <span style="margin-right:10px; width:20px; text-align:center;">
                <i class="fa-solid fa-heart-pulse" style="color: #e91e63;"></i>
            </span>
            <span>情感档案 / 全局统计</span>
        </div>
    `;

    const intv = setInterval(() => {
        if ($('#extensionsMenu').length > 0) {
            if ($('#st-intimacy-trigger').length === 0) {
                $('#extensionsMenu').append(menuBtn);
                $('#st-intimacy-trigger').on('click', openIntimacyHeatmap);
            }
            clearInterval(intv);
        }
    }, 500);

    console.log(`${extensionName} loaded.`);
});