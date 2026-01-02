import { getContext } from "../../../extensions.js";
import { getPastCharacterChats } from '../../../../script.js';

const extensionName = "st-intimacy-heatmap";

// ==========================================
// 1. 工具函数 (直接移植自 Reference.js)
// ==========================================

const monthMap = {
    Jan: '01', January: '01', Feb: '02', February: '02', Mar: '03', March: '03',
    Apr: '04', April: '04', May: '05', Jun: '06', June: '06',
    Jul: '07', July: '07', Aug: '08', August: '08', Sep: '09', September: '09',
    Oct: '10', October: '10', Nov: '11', November: '11', Dec: '12', December: '12'
};

// 解析 ST 各种奇葩的日期格式
function parseSillyTavernDate(dateString) {
    if (!dateString) return null;
    
    // 格式: "Month Day, Year HH:MMam/pm"
    const parts = dateString.match(/(\w+)\s+(\d+),\s+(\d+)\s+(\d+):(\d+)(am|pm)/i);
    if (parts) {
        const monthNumber = monthMap[parts[1]];
        if (!monthNumber) return null;
        let hour = parseInt(parts[4], 10);
        if (parts[6].toLowerCase() === 'pm' && hour !== 12) hour += 12;
        else if (parts[6].toLowerCase() === 'am' && hour === 12) hour = 0;
        const isoLikeString = `${parts[3]}-${monthNumber}-${parts[2].padStart(2, '0')}T${String(hour).padStart(2, '0')}:${parts[5]}:00`;
        return new Date(isoLikeString);
    }
    
    // 备用: 直接尝试 Date 解析
    const d = new Date(dateString);
    return isNaN(d.getTime()) ? null : d;
}

function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}小时 ${m}分钟`;
}

// ==========================================
// 2. 核心逻辑 (Reference.js 移植版)
// ==========================================

async function getStatsSafe() {
    const context = getContext();
    const charId = context.characterId;

    if (charId === undefined || charId === null) {
        return { error: "请先选择一个角色" };
    }

    try {
        // 【关键】直接获取元数据，不进行文件下载！
        const chats = await getPastCharacterChats(charId);
        
        if (!chats || chats.length === 0) {
            return { error: "没有找到历史记录" };
        }

        let totalMessages = 0;
        let totalSizeKB = 0;
        let earliestTime = null;
        let lastTime = null;

        // 遍历元数据列表
        chats.forEach(chat => {
            // 1. 累加消息数 (这是 ST 数据库直接告诉我们的，不用数)
            if (chat.chat_items) {
                totalMessages += chat.chat_items;
            }

            // 2. 累加文件大小 (用于估算字数)
            const sizeMatch = chat.file_size?.match(/([\d.]+)\s*KB/i);
            if (sizeMatch) {
                totalSizeKB += parseFloat(sizeMatch[1]);
            }

            // 3. 找最早和最晚的时间 (基于 last_mes 字段)
            if (chat.last_mes) {
                const date = parseSillyTavernDate(chat.last_mes);
                if (date) {
                    if (!earliestTime || date < earliestTime) earliestTime = date;
                    if (!lastTime || date > lastTime) lastTime = date;
                }
            }
        });

        // 4. 字数估算 (Reference.js 的备用逻辑: 1KB ≈ 30字)
        // 我们先不去做那个复杂的 fetchLargestFile，因为那个容易报错
        // 直接用文件大小估算，虽然不准，但绝对不报错
        const estimatedWords = Math.round(totalSizeKB * 30);

        // 5. 计算相识天数
        let days = 0;
        if (earliestTime) {
            const now = new Date();
            const diff = now - earliestTime;
            days = Math.floor(diff / (1000 * 60 * 60 * 24)) + 1;
        }

        return {
            name: context.characters[charId].name,
            totalMessages,
            estimatedWords,
            earliestTime: earliestTime ? earliestTime.toLocaleString() : "未知",
            lastTime: lastTime ? lastTime.toLocaleString() : "未知",
            days,
            fileCount: chats.length
        };

    } catch (e) {
        console.error(e);
        return { error: "读取数据失败: " + e.message };
    }
}

// ==========================================
// 3. UI 展示
// ==========================================

async function showStatsModal() {
    // 显示加载中
    const loadingId = 'st-loading-toast';
    if (!$(`#${loadingId}`).length) {
        $('body').append(`<div id="${loadingId}" style="position:fixed;top:20px;right:20px;background:#1f2937;color:white;padding:15px;border-radius:8px;z-index:9999;">正在计算数据...</div>`);
    }

    const stats = await getStatsSafe();
    
    $(`#${loadingId}`).remove();

    if (stats.error) {
        alert(stats.error);
        return;
    }

    // 简单的展示弹窗
    const modalHtml = `
    <div id="st-stats-modal" style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:9999;display:flex;justify-content:center;align-items:center;">
        <div style="background:#111827; padding:30px; border-radius:15px; border:1px solid #374151; width:400px; color:#e5e7eb; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
            <h2 style="text-align:center; color:#e91e63; margin-top:0;">${stats.name}</h2>
            <div style="text-align:center; font-size:0.9em; color:#9ca3af; margin-bottom:20px;">
                陪伴统计报告
            </div>
            
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; margin-bottom:20px;">
                <div style="background:#1f2937; padding:15px; border-radius:10px; text-align:center;">
                    <div style="font-size:1.5em; font-weight:bold; color:#60a5fa;">${stats.totalMessages}</div>
                    <div style="font-size:0.8em; color:#9ca3af;">总消息数</div>
                </div>
                <div style="background:#1f2937; padding:15px; border-radius:10px; text-align:center;">
                    <div style="font-size:1.5em; font-weight:bold; color:#34d399;">${stats.days}</div>
                    <div style="font-size:0.8em; color:#9ca3af;">相识天数</div>
                </div>
            </div>

            <ul style="list-style:none; padding:0; margin:0; font-size:0.95em; line-height:1.8;">
                <li>📝 <strong>估算字数：</strong> ${stats.estimatedWords.toLocaleString()} 字</li>
                <li>📂 <strong>存档文件：</strong> ${stats.fileCount} 个</li>
                <li>📅 <strong>初次见面：</strong> <br><span style="color:#9ca3af; font-size:0.9em">${stats.earliestTime}</span></li>
                <li>⌚ <strong>最近互动：</strong> <br><span style="color:#9ca3af; font-size:0.9em">${stats.lastTime}</span></li>
            </ul>

            <button id="st-close-modal" class="menu_button" style="width:100%; margin-top:25px; padding:10px; background:#e91e63; border:none; border-radius:5px; color:white; cursor:pointer;">关闭</button>
        </div>
    </div>
    `;

    $('#st-stats-modal').remove();
    $('body').append(modalHtml);

    $('#st-close-modal').click(() => $('#st-stats-modal').remove());
}

// ==========================================
// 4. 注册按钮
// ==========================================

jQuery(async () => {
    const menuBtn = `
        <div id="st-stats-trigger" class="list-group-item" style="cursor:pointer; display:flex; align-items:center;">
            <span style="margin-right:10px; width:20px; text-align:center;">
                <i class="fa-solid fa-chart-simple" style="color: #e91e63;"></i>
            </span>
            <span>查看陪伴数据</span>
        </div>
    `;

    const intv = setInterval(() => {
        if ($('#extensionsMenu').length > 0) {
            if ($('#st-stats-trigger').length === 0) {
                $('#extensionsMenu').append(menuBtn);
                $('#st-stats-trigger').on('click', showStatsModal);
            }
            clearInterval(intv);
        }
    }, 500);

    console.log("ST-Stats-Base Loaded");
});