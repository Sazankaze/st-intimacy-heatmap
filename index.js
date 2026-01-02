import { getContext } from "../../../extensions.js";

const extensionName = "st-intimacy-heatmap";
const extensionCss = `/scripts/extensions/third-party/${extensionName}/style.css`;

// === 1. 内存数据读取 (这是绝招) ===
// 不去 fetch 文件，直接读取当前正在显示的聊天数据
function getCurrentChatMessages() {
    const context = getContext();
    // SillyTavern 的 context.chat 就是当前加载的所有消息数组
    // 只要你能在屏幕上向上翻看到消息，这个数组里就有数据
    if (context && context.chat && Array.isArray(context.chat)) {
        console.log("从内存读取到消息数:", context.chat.length);
        return context.chat;
    }
    return [];
}

// === 2. 日期解析 (加强版) ===
const monthMap = {
    Jan: '01', January: '01', Feb: '02', February: '02', Mar: '03', March: '03',
    Apr: '04', April: '04', May: '05', Jun: '06', June: '06',
    Jul: '07', July: '07', Aug: '08', August: '08', Sep: '09', September: '09',
    Oct: '10', October: '10', Nov: '11', November: '11', Dec: '12', December: '12'
};

function parseDate(dateString) {
    if (!dateString) return null;
    
    // 格式 1: "January 01, 2026 10:30pm" (常见于 ST)
    const parts = dateString.match(/(\w+)\s+(\d+),\s+(\d+)\s+(\d+):(\d+)(am|pm)/i);
    if (parts) {
        const month = monthMap[parts[1]] || '01';
        let h = parseInt(parts[4]);
        if (parts[6].toLowerCase() === 'pm' && h !== 12) h += 12;
        if (parts[6].toLowerCase() === 'am' && h === 12) h = 0;
        // 构建 ISO 字符串以便解析
        const iso = `${parts[3]}-${month}-${parts[2].padStart(2,'0')}T${String(h).padStart(2,'0')}:${parts[5]}:00`;
        return new Date(iso);
    }
    
    // 格式 2: 直接尝试标准解析
    const d = new Date(dateString);
    return isNaN(d.getTime()) ? null : d;
}

// === 3. 热力图计算逻辑 (复活！) ===
function calculateHeatmapData(messages) {
    if (!messages || messages.length === 0) return null;

    // 筛选有效消息
    const validMessages = messages.filter(m => m.send_date && parseDate(m.send_date));
    if (validMessages.length === 0) return null;

    // 按时间排序
    validMessages.sort((a, b) => parseDate(a.send_date) - parseDate(b.send_date));

    // 统计每一天的数据
    const dayMap = new Map();
    let totalChars = 0;

    validMessages.forEach(msg => {
        const content = msg.mes || "";
        const len = content.length;
        totalChars += len;

        const date = parseDate(msg.send_date);
        if (date) {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            const dateStr = `${y}-${m}-${d}`;

            if (!dayMap.has(dateStr)) dayMap.set(dateStr, { count: 0, chars: 0 });
            const data = dayMap.get(dateStr);
            data.count++;
            data.chars += len;
        }
    });

    // 生成日历视图数据
    const firstDate = parseDate(validMessages[0].send_date);
    const lastDate = parseDate(validMessages[validMessages.length - 1].send_date) || new Date();

    const monthsData = [];
    let curY = firstDate.getFullYear();
    let curM = firstDate.getMonth();
    
    // 稍微向后多算一个月，保证日历好看
    const endD = new Date(lastDate);
    endD.setMonth(endD.getMonth() + 1);
    const endY = endD.getFullYear();
    const endM = endD.getMonth();

    let safeGuard = 0;
    while ((curY < endY || (curY === endY && curM <= endM)) && safeGuard < 100) {
        safeGuard++;
        const daysInMonth = new Date(curY, curM + 1, 0).getDate();
        const firstDayObj = new Date(curY, curM, 1);
        const paddingStart = firstDayObj.getDay(); // 0 is Sunday

        const days = [];
        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${curY}-${String(curM + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const data = dayMap.get(dateStr) || { count: 0, chars: 0 };
            
            // 计算热力等级 (0-4)
            let level = 0;
            if (data.count > 0) level = 1;
            if (data.count > 10) level = 2; // 阈值可以调
            if (data.count > 30) level = 3;
            if (data.count > 60) level = 4;

            days.push({ dayNum: d, dateStr, count: data.count, chars: data.chars, level });
        }

        monthsData.push({
            year: curY, month: curM + 1, paddingStart, days
        });

        curM++;
        if (curM > 11) { curM = 0; curY++; }
    }

    return {
        months: monthsData.reverse(), // 最近的月份在上面
        totalMessages: validMessages.length,
        totalChars,
        firstDateStr: firstDate.toLocaleDateString(),
        lastDateStr: lastDate.toLocaleDateString(),
        activeDays: dayMap.size
    };
}

// === 4. UI 渲染 (极简版热力图) ===
let currentMonthIdx = 0;
let cachedStats = null;

function renderHeatmapModal() {
    $('#st-heatmap-modal').remove();
    
    const context = getContext();
    const charName = context.characters[context.characterId].name;
    
    // 1. 获取当前内存消息
    const msgs = getCurrentChatMessages();
    if (msgs.length === 0) {
        alert("当前聊天记录为空，或者未加载成功。请先进入一个聊天。");
        return;
    }

    // 2. 计算
    cachedStats = calculateHeatmapData(msgs);
    if (!cachedStats) {
        alert("无法解析日期数据，请确认聊天记录格式。");
        return;
    }
    currentMonthIdx = 0;

    // 3. 构建 UI HTML
    const html = `
    <div id="st-heatmap-modal" style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:9999;display:flex;justify-content:center;align-items:center;">
        <div class="st-heatmap-card" style="background:#1f2937; width:450px; border-radius:15px; border:1px solid #374151; padding:20px; color:#e5e7eb; box-shadow:0 10px 30px rgba(0,0,0,0.8); font-family:sans-serif;">
            
            <div style="text-align:center; margin-bottom:20px; border-bottom:1px solid #374151; padding-bottom:15px;">
                <h2 style="margin:0; color:#e91e63;">${charName}</h2>
                <div style="font-size:0.9em; color:#9ca3af; margin-top:5px;">当前存档热力图</div>
                <div style="display:flex; justify-content:center; gap:20px; margin-top:15px;">
                    <div><b style="color:#60a5fa">${cachedStats.totalMessages}</b> 条消息</div>
                    <div><b style="color:#34d399">${cachedStats.activeDays}</b> 天活跃</div>
                </div>
            </div>

            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <button id="st-hm-prev" class="menu_button" style="width:40px;">◀</button>
                <div id="st-hm-title" style="font-weight:bold; font-size:1.1em;">Loading...</div>
                <button id="st-hm-next" class="menu_button" style="width:40px;">▶</button>
            </div>

            <div id="st-hm-grid" style="display:grid; grid-template-columns:repeat(7, 1fr); gap:5px; text-align:center; font-size:0.85em; min-height:260px;">
                </div>

            <div id="st-hm-info" style="margin-top:15px; text-align:center; font-size:0.85em; color:#9ca3af; height:20px;">
                鼠标悬停查看详情
            </div>

            <button id="st-hm-close" class="menu_button" style="width:100%; margin-top:20px; background:#e91e63;">关闭</button>
        </div>
    </div>
    
    <style>
        .st-day-cell { padding: 8px 0; border-radius: 4px; background: #374151; cursor: default; }
        .st-day-cell.lvl-0 { background: #374151; color: #6b7280; } /* 无数据 */
        .st-day-cell.lvl-1 { background: #064e3b; color: #a7f3d0; } /* 极少 */
        .st-day-cell.lvl-2 { background: #065f46; color: #a7f3d0; } /* 少 */
        .st-day-cell.lvl-3 { background: #047857; color: #ffffff; } /* 中 */
        .st-day-cell.lvl-4 { background: #10b981; color: #ffffff; font-weight:bold; box-shadow:0 0 5px #10b981; } /* 多 */
        .st-day-cell:hover { transform: scale(1.1); transition: 0.1s; border:1px solid white; }
        .st-day-header { color: #9ca3af; font-weight:bold; margin-bottom:5px; }
    </style>
    `;

    $('body').append(html);

    // 绑定事件
    $('#st-hm-prev').click(() => {
        if (currentMonthIdx < cachedStats.months.length - 1) {
            currentMonthIdx++;
            renderCalendarMonth();
        }
    });
    $('#st-hm-next').click(() => {
        if (currentMonthIdx > 0) {
            currentMonthIdx--;
            renderCalendarMonth();
        }
    });
    $('#st-hm-close').click(() => $('#st-heatmap-modal').remove());

    // 初始渲染
    renderCalendarMonth();
}

function renderCalendarMonth() {
    const data = cachedStats.months[currentMonthIdx];
    $('#st-hm-title').text(`${data.year}年 ${data.month}月`);
    
    // 按钮状态
    $('#st-hm-prev').prop('disabled', currentMonthIdx >= cachedStats.months.length - 1);
    $('#st-hm-next').prop('disabled', currentMonthIdx <= 0);
    $('#st-hm-prev').css('opacity', currentMonthIdx >= cachedStats.months.length - 1 ? 0.3 : 1);
    $('#st-hm-next').css('opacity', currentMonthIdx <= 0 ? 0.3 : 1);

    let gridHtml = '';
    const weeks = ['日','一','二','三','四','五','六'];
    weeks.forEach(d => gridHtml += `<div class="st-day-header">${d}</div>`);

    // 填充空白
    for(let i=0; i<data.paddingStart; i++) {
        gridHtml += `<div></div>`;
    }

    // 填充日期
    data.days.forEach(d => {
        gridHtml += `<div class="st-day-cell lvl-${d.level}" 
            data-date="${d.dateStr}" 
            data-count="${d.count}"
            data-chars="${d.chars}">
            ${d.dayNum}
        </div>`;
    });

    $('#st-hm-grid').html(gridHtml);

    // 悬停事件
    $('.st-day-cell').hover(function() {
        const count = $(this).data('count');
        const date = $(this).data('date');
        const chars = $(this).data('chars');
        if (count > 0) {
            $('#st-hm-info').html(`<span style="color:#10b981">${date}</span>: 发言 <b>${count}</b> 次, 约 <b>${chars}</b> 字`);
        } else {
            $('#st-hm-info').html(`${date}: 无记录`);
        }
    });
}

// === 5. 注册入口 ===
jQuery(async () => {
    // 延时加载 CSS 文件 (如果存在的话)
    // $('head').append(`<link rel="stylesheet" type="text/css" href="${extensionCss}">`);

    const menuBtn = `
        <div id="st-heatmap-trigger" class="list-group-item" style="cursor:pointer; display:flex; align-items:center;">
            <span style="margin-right:10px; width:20px; text-align:center;">
                <i class="fa-solid fa-calendar-days" style="color: #10b981;"></i>
            </span>
            <span>当前存档热力图 (内存版)</span>
        </div>
    `;

    const intv = setInterval(() => {
        if ($('#extensionsMenu').length > 0) {
            if ($('#st-heatmap-trigger').length === 0) {
                $('#extensionsMenu').append(menuBtn);
                $('#st-heatmap-trigger').on('click', renderHeatmapModal);
            }
            clearInterval(intv);
        }
    }, 500);

    console.log("ST-Heatmap-Memory Loaded");
});